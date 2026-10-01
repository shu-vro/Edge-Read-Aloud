import { beforeEach, expect, test } from "bun:test";
import { fakes } from "../test/fakes";
import { getVoices, groupVoices, localeName, voiceName } from "./voices";

const store = fakes.local.store;

const voice = (ShortName: string, Locale: string) => ({ ShortName, Locale }) as any;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  fakes.listVoicesCalls = 0;
  fakes.listVoices = async () => [voice("en-US-AriaNeural", "en-US")];
});

test("voiceName strips the locale and Neural, and splits camel case", () => {
  expect(voiceName(voice("en-US-EmmaMultilingualNeural", "en-US"))).toBe("Emma Multilingual");
  expect(voiceName(voice("en-GB-SoniaNeural", "en-GB"))).toBe("Sonia");
});

test("localeName gives a readable name and falls back to the code", () => {
  expect(localeName("en-US")).toContain("English");
  expect(localeName("not a locale!!")).toBe("not a locale!!");
});

test("groupVoices groups by locale and sorts groups by display name", () => {
  const groups = groupVoices([voice("fr-FR-A", "fr-FR"), voice("en-US-B", "en-US"), voice("en-US-C", "en-US")]);
  expect(groups.map(([, v]) => v.length)).toEqual([2, 1]); // English before French
  expect(groups[0][0]).toContain("English");
});

test("getVoices fetches once, then serves the cache", async () => {
  expect(await getVoices()).toHaveLength(1);
  await getVoices();
  expect(fakes.listVoicesCalls).toBe(1);
});

test("a cache older than a week is refreshed", async () => {
  store.voices = [voice("old", "en-US")];
  store.voicesAt = Date.now() - 8 * DAY;
  expect(((await getVoices()) as any)[0].ShortName).toBe("en-US-AriaNeural");
});

test("when refresh fails, stale voices beat nothing; with no cache the error surfaces", async () => {
  fakes.listVoices = async () => {
    throw new Error("offline");
  };
  store.voices = [voice("old", "en-US")];
  store.voicesAt = Date.now() - 8 * DAY;
  expect(((await getVoices()) as any)[0].ShortName).toBe("old");
  delete store.voices;
  await expect(getVoices()).rejects.toThrow("offline");
});
