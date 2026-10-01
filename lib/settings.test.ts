import { expect, test } from "bun:test";
import { fakes } from "../test/fakes";
import { defaults, getSettings, setSettings, onSettings } from "./settings";

test("unset settings come back as defaults, saved ones override", async () => {
  expect(await getSettings()).toEqual(defaults);
  await setSettings({ rate: 25, wordHighlight: false });
  expect(await getSettings()).toEqual({ ...defaults, rate: 25, wordHighlight: false });
});

test("onSettings fires with fresh settings for sync changes only", async () => {
  const seen: number[] = [];
  onSettings((s) => seen.push(s.rate));
  await fakes.onChanged({}, "local");
  expect(seen).toEqual([]);
  await fakes.onChanged({}, "sync");
  expect(seen).toEqual([25]);
});

test("defaults stay within the ranges the UI allows", () => {
  expect(defaults.rate).toBeGreaterThanOrEqual(-50);
  expect(defaults.rate).toBeLessThanOrEqual(100);
  expect(defaults.voice).toMatch(/^[a-z]{2,3}-[A-Z]{2}-\w+Neural$/);
});
