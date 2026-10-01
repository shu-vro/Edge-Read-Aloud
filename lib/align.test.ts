import { expect, test } from "bun:test";
import { align, wordAt } from "./align";

const b = (text: string, i: number) => ({ text, offset: i * 1e7, duration: 5e6 });

test("maps boundaries to character spans, forward only", () => {
  const text = "The cat saw the other cat.";
  const words = align(text, ["The", "cat", "saw", "the", "other", "cat"].map(b));
  expect(words.map((w) => text.slice(w.from, w.to))).toEqual([
    "The", "cat", "saw", "the", "other", "cat",
  ]);
  expect(words[5].from).toBe(22); // the second "cat", not the first
  expect(words[1]).toMatchObject({ start: 1, end: 1.5 });
});

test("a word that is not in the text does not derail the rest", () => {
  const text = "It cost $5 today.";
  const words = align(text, ["It", "cost", "five dollars", "today"].map(b));
  expect(words[2].from).toBe(-1);
  expect(text.slice(words[3].from, words[3].to)).toBe("today");
});

test("a far-away match is rejected", () => {
  const text = "a " + "x".repeat(100) + " zebra";
  expect(align(text, [b("zebra", 0)])[0].from).toBe(-1);
});

test("wordAt picks the word in progress", () => {
  const words = align("one two three", ["one", "two", "three"].map(b));
  expect(wordAt(words, -0.1)).toBe(-1);
  expect(wordAt(words, 0)).toBe(0);
  expect(wordAt(words, 1.7)).toBe(1);
  expect(wordAt(words, 99)).toBe(2);
});

test("sentence spans cover the text, trimmed, with short ones merged", async () => {
  const { splitSentences } = await import("./extract");
  const seg = new Intl.Segmenter("en", { granularity: "sentence" });
  const text = "  Hi. This is the first real sentence of the block, long enough. And here is a second one that is long too.  — ";
  const spans = splitSentences(text, seg).map((s) => text.slice(s.from, s.to));
  expect(spans).toEqual([
    "Hi. This is the first real sentence of the block, long enough.",
    "And here is a second one that is long too.  —",
  ]);
  expect(splitSentences(" — … ", seg)).toEqual([]);
});
