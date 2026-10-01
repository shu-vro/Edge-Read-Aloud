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

test("matching is case-insensitive and tolerates an empty boundary list", () => {
  expect(align("Hello World", ["hello", "WORLD"].map(b)).map((w) => w.from)).toEqual([0, 6]);
  expect(align("anything", [])).toEqual([]);
  expect(wordAt([], 3)).toBe(-1);
});

test("times convert from 100 ns units to seconds", () => {
  const [w] = align("hi", [{ text: "hi", offset: 12_500_000, duration: 2_500_000 }]);
  expect(w).toMatchObject({ start: 1.25, end: 1.5 });
});
