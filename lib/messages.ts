import type { Settings } from "./settings";
import type { Word } from "./align";

export const PORT_NAME = "reader";

/** Content script -> offscreen document. */
export type ToPlayer =
  | { t: "load"; texts: string[]; index: number; settings: Settings }
  | { t: "seek"; index: number }
  | { t: "settings"; settings: Settings }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "stop" };

/** Offscreen document -> content script. */
export type FromPlayer =
  | { t: "loading"; index: number }
  /**
   * Sentence `index` is sounding; `time` is the position, in seconds, that is audible right
   * now. Slightly negative at the start, by the output latency.
   */
  | { t: "play"; index: number; words: Word[]; time: number }
  | { t: "paused" }
  | { t: "end" }
  | { t: "error"; message: string };

/** Popup / background -> content script. */
export type Command = { cmd: "toggle" | "stop" | "prev" | "next" | "here" | "status" };
export type Status = { active: boolean; playing: boolean };
