/**
 * The player. Holds the queue of sentences for whichever tab is reading, synthesizes them a
 * little ahead of playback, and tells the tab which words are being spoken.
 *
 * Sound goes through one AudioContext that keeps running between sentences. Starting and
 * stopping a media element per sentence swallowed the first sounds of each clip while the
 * output started up, and its clock was too loose to cut the trailing silence without also
 * cutting the last word. Here every clip starts and ends on the sample.
 *
 * Only `chrome.runtime` exists in an offscreen document, so settings arrive over the port.
 */

import { browser, type Browser } from "wxt/browser";
import { align, type Boundary, type Word } from "@/lib/align";
import { PORT_NAME, type FromPlayer, type ToPlayer } from "@/lib/messages";
import { defaults, type Settings } from "@/lib/settings";
import { synthesize, warm } from "@/lib/tts";

/**
 * Sentences synthesized ahead of the one playing, one request at a time. The service queues
 * clients that send bursts, which costs far more than a deeper buffer would save.
 */
const PREFETCH = 2;
const CACHE_SIZE = 40;
/**
 * Pause between sentences, in seconds after the last word. The service pads every clip with
 * close to a second of silence, so the clip's own end is not used.
 */
const SENTENCE_GAP = 0.35;

type Clip = {
  buffer: AudioBuffer;
  words: Word[];
  /** Seconds of the buffer worth playing: up to the last word plus the gap. */
  length: number;
};

const context = new AudioContext();
const cache = new Map<string, Promise<Clip>>();

let port: Browser.runtime.Port | undefined;
let texts: string[] = [];
let index = 0;
let settings: Settings = defaults;
/** Bumped on every seek, so work started for an earlier position knows it is stale. */
let generation = 0;

let current: Clip | undefined;
/** The clip while it is sounding; undefined when paused, loading or stopped. */
let node: AudioBufferSourceNode | undefined;
/** Context time at which the current clip's zero falls. */
let startedAt = 0;
/** Position in the current clip to resume from. */
let offset = 0;
let paused = false;

warm();

const post = (message: FromPlayer) => port?.postMessage(message);
const signed = (n: number, unit: string) => `${n >= 0 ? "+" : ""}${n}${unit}`;

async function make(text: string, { voice, rate, pitch, volume }: Settings): Promise<Clip> {
  const chunks: ArrayBuffer[] = [];
  const boundaries: Boundary[] = [];
  await synthesize(
    text,
    { voice, rate: signed(rate, "%"), pitch: signed(pitch, "Hz"), volume: signed(volume, "%") },
    { audio: (chunk) => chunks.push(chunk), boundary: (boundary) => boundaries.push(boundary) },
  );
  const buffer = await context.decodeAudioData(await new Blob(chunks).arrayBuffer());
  const words = align(text, boundaries);
  const last = words.at(-1);
  const length = last ? Math.min(buffer.duration, last.end + SENTENCE_GAP) : buffer.duration;
  return { buffer, words, length };
}

function clip(i: number): Promise<Clip> {
  const { voice, rate, pitch, volume } = settings;
  const key = [voice, rate, pitch, volume, texts[i]].join("|");
  let pending = cache.get(key);
  cache.delete(key);
  if (!pending) {
    pending = make(texts[i], settings);
    pending.catch(() => cache.delete(key));
  }
  cache.set(key, pending); // re-inserted last: most recently used
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return pending;
}

async function prefetch(from: number, mine: number) {
  for (let i = from + 1; i <= from + PREFETCH && i < texts.length; i++) {
    if (mine !== generation) return;
    await clip(i).catch(() => {});
  }
}

function silence() {
  if (!node) return;
  node.onended = null;
  node.stop();
  node = undefined;
}

/** Sound the current clip from `offset`. */
function sound() {
  const clip = current!;
  const source = (node = context.createBufferSource());
  source.buffer = clip.buffer;
  source.connect(context.destination);
  source.onended = () => {
    if (node === source) play(index + 1);
  };
  startedAt = context.currentTime - offset;
  source.start(0, offset, Math.max(0, clip.length - offset));
  // What is heard trails the context clock by the output latency; the highlight should too.
  post({ t: "play", index, words: clip.words, time: offset - (context.outputLatency || 0) });
}

async function play(i: number) {
  const mine = ++generation;
  index = i;
  paused = false;
  current = undefined;
  silence();
  if (i >= texts.length) return post({ t: "end" });
  post({ t: "loading", index: i });
  try {
    const ready = await clip(i);
    if (mine !== generation) return;
    current = ready;
    offset = 0;
    sound();
    prefetch(i, mine);
  } catch (error) {
    if (mine === generation) post({ t: "error", message: String((error as Error).message ?? error) });
  }
}

function stop() {
  generation++;
  current = undefined;
  silence();
  texts = [];
  context.suspend(); // nothing to play: let the output device go
}

function handle(message: ToPlayer) {
  switch (message.t) {
    case "load":
      texts = message.texts;
      settings = message.settings;
      context.resume();
      return play(message.index);
    case "seek":
      return play(message.index);
    case "settings": {
      const { voice, rate, pitch, volume } = settings;
      settings = message.settings;
      const same =
        voice === settings.voice && rate === settings.rate &&
        pitch === settings.pitch && volume === settings.volume;
      // New voice or prosody: restart the current sentence so the change is heard at once.
      if (!same && texts.length && !paused) play(index);
      return;
    }
    case "pause":
      paused = true;
      if (!node) return void generation++; // still loading: just don't start
      offset = context.currentTime - startedAt;
      silence();
      return post({ t: "paused" });
    case "resume":
      paused = false;
      return current ? sound() : play(index);
    case "stop":
      return stop();
  }
}

browser.runtime.onConnect.addListener((incoming) => {
  if (incoming.name !== PORT_NAME) return;
  incoming.onMessage.addListener((message: ToPlayer) => {
    if (message.t === "load" && port !== incoming) {
      post({ t: "end" }); // another tab takes over
      port = incoming;
    }
    if (port === incoming) handle(message);
  });
  incoming.onDisconnect.addListener(() => {
    if (port !== incoming) return;
    port = undefined;
    stop();
  });
});
