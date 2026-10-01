/**
 * One sentence in, MP3 chunks and word boundaries out, over Edge's Read Aloud WebSocket.
 *
 * The handshake costs about twice what synthesizing a sentence does, so sockets are kept and
 * reused: the service accepts one request after another on the same connection.
 *
 * edge-tts-universal's browser client opens a socket per request, never settles when the
 * handshake is refused and polls for messages every 50 ms. Only its token generator is reused.
 */

import { DRM } from "edge-tts-universal/browser";
import type { Boundary } from "./align";

const ENDPOINT =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
  "?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
/** Must match the Edge version the token generator and public/rules.json claim to be. */
const GEC_VERSION = "1-143.0.3650.75";
const CONNECT_TIMEOUT_MS = 8000;

const CONFIG =
  "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
  JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "true" },
          outputFormat: "audio-24khz-48kbitrate-mono-mp3",
        },
      },
    },
  });

export type Prosody = { voice: string; rate: string; pitch: string; volume: string };

const id = () => crypto.randomUUID().replaceAll("-", "");

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
// Control characters are not legal in XML at all, escaped or not.
const escapeXml = (text: string) =>
  text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/[&<>]/g, (c) => ENTITIES[c]);
const unescapeXml = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name as "amp"]);

/** Called as data arrives, in order. Audio chunks are consecutive pieces of one MP3 stream. */
export type Sink = { audio(chunk: ArrayBuffer): void; boundary(boundary: Boundary): void };

/** Open sockets with no request in flight. */
const idle = new Set<WebSocket>();

async function open(): Promise<WebSocket> {
  const url = `${ENDPOINT}&Sec-MS-GEC=${await DRM.generateSecMsGec()}&Sec-MS-GEC-Version=${GEC_VERSION}&ConnectionId=${id()}`;
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Speech service did not answer"));
    }, CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      clearTimeout(timer);
      socket.send(CONFIG);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Speech service connection failed"));
    };
  });
  return socket;
}

function park(socket: WebSocket) {
  socket.onmessage = socket.onerror = null;
  socket.onclose = () => idle.delete(socket); // the service drops quiet connections
  idle.add(socket);
}

/** Open a connection ahead of the first request. */
export function warm() {
  if (!idle.size) open().then(park, () => {});
}

function turn(socket: WebSocket, text: string, { voice, rate, pitch, volume }: Prosody, sink: Sink) {
  let received = false;

  return new Promise<void>((resolve, reject) => {
    socket.onmessage = ({ data }) => {
      if (typeof data !== "string") {
        // Binary frame: 2-byte big-endian header length, headers, then MP3 bytes.
        const headerLength = new DataView(data).getUint16(0);
        if (data.byteLength > 2 + headerLength) {
          received = true;
          sink.audio(data.slice(2 + headerLength));
        }
        return;
      }
      const split = data.indexOf("\r\n\r\n");
      const headers = data.slice(0, split);
      if (headers.includes("Path:audio.metadata")) {
        for (const item of JSON.parse(data.slice(split + 4)).Metadata) {
          if (item.Type !== "WordBoundary") continue;
          sink.boundary({
            offset: item.Data.Offset,
            duration: item.Data.Duration,
            text: unescapeXml(item.Data.text.Text),
          });
        }
      } else if (headers.includes("Path:turn.end")) {
        park(socket);
        if (received) resolve();
        else reject(new Error("No audio received from the speech service"));
      }
    };
    socket.onerror = socket.onclose = () =>
      reject(new Error("Speech service closed the connection"));

    socket.send(
      `X-RequestId:${id()}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>` +
        `${escapeXml(text)}</prosody></voice></speak>`,
    );
  });
}

/** Resolves when the sentence is complete; everything it produced has gone to `sink` by then. */
export async function synthesize(text: string, prosody: Prosody, sink: Sink): Promise<void> {
  const [reused] = idle;
  if (!reused) return turn(await open(), text, prosody, sink);
  idle.delete(reused);
  let started = false;
  try {
    return await turn(reused, text, prosody, {
      audio: (chunk) => ((started = true), sink.audio(chunk)),
      boundary: sink.boundary,
    });
  } catch (error) {
    if (started) throw error;
    // It had gone stale while parked. Try once more on a fresh connection.
    return turn(await open(), text, prosody, sink);
  }
}
