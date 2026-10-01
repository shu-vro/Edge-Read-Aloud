import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/** Just enough of a WebSocket for lib/tts.ts, with the service played by `serve`. */
class FakeSocket {
  static all: FakeSocket[] = [];
  static serve: (socket: FakeSocket, message: string) => void = () => {};
  static refuse = false;
  binaryType = "";
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
    setTimeout(() => (FakeSocket.refuse ? this.onerror?.() : this.onopen?.()), 0);
  }
  send(message: string) {
    this.sent.push(message);
    if (message.includes("Path:ssml")) setTimeout(() => FakeSocket.serve(this, message), 0);
  }
  close() {
    this.closed = true;
  }
  say(path: string, body = "") {
    this.onmessage?.({ data: `Path:${path}\r\n\r\n${body}` });
  }
  audio(bytes: number[]) {
    const header = new TextEncoder().encode("Path:audio\r\n");
    const frame = new Uint8Array(2 + header.length + bytes.length);
    new DataView(frame.buffer).setUint16(0, header.length);
    frame.set(header, 2);
    frame.set(bytes, 2 + header.length);
    this.onmessage?.({ data: frame.buffer });
  }
  word(text: string, offset: number, duration: number) {
    this.say("audio.metadata", JSON.stringify({ Metadata: [{ Type: "WordBoundary", Data: { Offset: offset, Duration: duration, text: { Text: text } } }] }));
  }
}

const prosody = { voice: "en-US-TestNeural", rate: "+0%", pitch: "+0Hz", volume: "+0%" };
let n = 0;
/** A fresh module each time, so the pool of idle sockets starts empty. */
const load = () => import(`./tts.ts?fresh=${n++}`) as Promise<typeof import("./tts")>;

function collect() {
  const audio: number[][] = [];
  const words: unknown[] = [];
  return { audio, words, sink: { audio: (c: ArrayBuffer) => audio.push([...new Uint8Array(c)]), boundary: (b: unknown) => words.push(b) } };
}

/** Plays a normal turn: one boundary, two audio chunks, turn.end. */
const happy = (s: FakeSocket) => {
  s.word("Hi", 0, 5e6);
  s.audio([1, 2]);
  s.audio([3]);
  s.say("turn.end");
};

beforeEach(() => {
  FakeSocket.refuse = false;
  FakeSocket.all = [];
  FakeSocket.serve = happy;
  (globalThis as any).WebSocket = FakeSocket;
});

test("a request opens a socket with the Edge token, sends config then SSML, and streams the reply", async () => {
  const { synthesize } = await load();
  const { audio, words, sink } = collect();
  await synthesize("Hi", prosody, sink);

  const [socket] = FakeSocket.all;
  expect(socket.url).toContain("Sec-MS-GEC=TOKEN");
  expect(socket.url).toMatch(/Sec-MS-GEC-Version=1-\d+\./);
  expect(socket.binaryType).toBe("arraybuffer");
  expect(socket.sent[0]).toContain("Path:speech.config");
  expect(socket.sent[0]).toContain('"wordBoundaryEnabled":"true"');
  expect(socket.sent[1]).toContain("<voice name='en-US-TestNeural'>");
  expect(socket.sent[1]).toContain("rate='+0%'");
  expect(audio).toEqual([[1, 2], [3]]); // headers stripped
  expect(words).toEqual([{ offset: 0, duration: 5e6, text: "Hi" }]);
});

test("the socket is reused for the next sentence", async () => {
  const { synthesize } = await load();
  await synthesize("one", prosody, collect().sink);
  await synthesize("two", prosody, collect().sink);
  expect(FakeSocket.all).toHaveLength(1);
  expect(FakeSocket.all[0].sent.filter((m) => m.includes("Path:ssml"))).toHaveLength(2);
});

test("text is XML-escaped and boundaries are unescaped", async () => {
  const { synthesize } = await load();
  const { words, sink } = collect();
  FakeSocket.serve = (s) => {
    s.word("R&amp;D", 0, 1);
    s.audio([1]);
    s.say("turn.end");
  };
  await synthesize("R&D <b> \u0007", prosody, sink);
  const ssml = FakeSocket.all[0].sent[1];
  expect(ssml).toContain("R&amp;D &lt;b&gt;  </prosody>"); // control char became a space
  expect(words).toEqual([{ offset: 0, duration: 1, text: "R&D" }]);
});

test("a turn that ends without audio is an error", async () => {
  const { synthesize } = await load();
  FakeSocket.serve = (s) => s.say("turn.end");
  await expect(synthesize("Hi", prosody, collect().sink)).rejects.toThrow("No audio");
});

test("a connection that never opens fails instead of hanging", async () => {
  const { synthesize } = await load();
  FakeSocket.refuse = true;
  await expect(synthesize("Hi", prosody, collect().sink)).rejects.toThrow("connection failed");
});

test("a stale parked socket is retried once on a fresh one", async () => {
  const { synthesize } = await load();
  await synthesize("one", prosody, collect().sink);
  FakeSocket.serve = (s) => {
    if (s === FakeSocket.all[0]) return s.onclose?.(); // service dropped it while parked
    happy(s);
  };
  const { audio, sink } = collect();
  await synthesize("two", prosody, sink);
  expect(FakeSocket.all).toHaveLength(2);
  expect(audio).toEqual([[1, 2], [3]]);
});

test("a socket that dies after audio began is not retried (it would repeat audio)", async () => {
  const { synthesize } = await load();
  await synthesize("one", prosody, collect().sink);
  FakeSocket.serve = (s) => {
    s.audio([9]);
    s.onclose?.();
  };
  await expect(synthesize("two", prosody, collect().sink)).rejects.toThrow("closed");
  expect(FakeSocket.all).toHaveLength(1);
});

test("warm() opens one connection ahead and synthesize uses it", async () => {
  const { synthesize, warm } = await load();
  warm();
  warm(); // second call before the first parks is harmless, but must not pile up once parked
  await new Promise((r) => setTimeout(r, 10));
  const opened = FakeSocket.all.length;
  await synthesize("Hi", prosody, collect().sink);
  expect(FakeSocket.all).toHaveLength(opened);
});

test("GEC_VERSION agrees with the User-Agent in public/rules.json", () => {
  const gec = readFileSync(new URL("./tts.ts", import.meta.url), "utf8").match(/GEC_VERSION = "1-([\d.]+)"/)![1];
  const rules = readFileSync(new URL("../public/rules.json", import.meta.url), "utf8");
  const major = gec.split(".")[0];
  expect(rules).toContain(`Chrome/${major}.0.0.0`);
  expect(rules).toContain(`Edg/${major}.0.0.0`);
});
