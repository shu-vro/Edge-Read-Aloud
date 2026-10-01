import { browser } from "wxt/browser";

export const defaults = {
  voice: "en-US-EmmaMultilingualNeural",
  /** Percent relative to the voice's normal speed, as edge-tts takes it. */
  rate: 0,
  /** Hz relative to the voice's normal pitch. */
  pitch: 0,
  /** Percent relative to normal loudness. */
  volume: 0,
  wordHighlight: true,
  autoScroll: true,
  clickToRead: true,
};

export type Settings = typeof defaults;

export const getSettings = () =>
  browser.storage.sync.get(defaults) as Promise<Settings>;

export const setSettings = (patch: Partial<Settings>) =>
  browser.storage.sync.set(patch);

export function onSettings(callback: (settings: Settings) => void) {
  browser.storage.onChanged.addListener(async (_changes, area) => {
    if (area === "sync") callback(await getSettings());
  });
}
