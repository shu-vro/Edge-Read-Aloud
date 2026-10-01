import { listVoices, type Voice } from "edge-tts-universal/browser";
import { browser } from "wxt/browser";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The full voice list, cached locally so the popup opens without a network round trip. */
export async function getVoices(): Promise<Voice[]> {
  const { voices, voicesAt } = (await browser.storage.local.get(["voices", "voicesAt"])) as {
    voices?: Voice[];
    voicesAt?: number;
  };
  if (voices && Date.now() - (voicesAt ?? 0) < WEEK_MS) return voices;
  try {
    const fresh = await listVoices();
    await browser.storage.local.set({ voices: fresh, voicesAt: Date.now() });
    return fresh;
  } catch (error) {
    if (voices) return voices; // stale beats nothing
    throw error;
  }
}

const languageNames = new Intl.DisplayNames(undefined, { type: "language" });

/** "en-US" -> "English (United States)". */
export function localeName(locale: string): string {
  try {
    return languageNames.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

/** "en-US-EmmaMultilingualNeural" -> "Emma Multilingual". */
export function voiceName(voice: Voice): string {
  return voice.ShortName.slice(voice.Locale.length + 1)
    .replace(/Neural$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Voices grouped by locale, groups sorted by display name. */
export function groupVoices(voices: Voice[]): [string, Voice[]][] {
  const groups = Map.groupBy(voices, (v) => localeName(v.Locale));
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}
