import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { extract, locate, rangeOf, splitSentences } from "./extract";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const LONG_A = "This is the first sentence and it is comfortably long enough.";
const LONG_B = "Here is a second sentence, also long enough to stand alone.";

// happy-dom reports an empty `display` for inline elements, where a browser says "inline".
const page = (html: string) => {
  document.body.innerHTML = html;
  return extract();
};

test("splitSentences: spans are trimmed, short ones merge, punctuation-only is dropped", () => {
  const seg = new Intl.Segmenter("en", { granularity: "sentence" });
  const text = `  Hi. ${LONG_A} ${LONG_B}  — `;
  expect(splitSentences(text, seg).map((s) => text.slice(s.from, s.to))).toEqual([
    `Hi. ${LONG_A}`,
    `${LONG_B}  —`,
  ]);
  expect(splitSentences(" — … ", seg)).toEqual([]);
  expect(splitSentences("", seg)).toEqual([]);
});

test("splitSentences: line breaks and abbreviations do not end a sentence", () => {
  const seg = new Intl.Segmenter("en", { granularity: "sentence" });
  const text = `This sentence was wrapped in the page source\nright in the middle. ${LONG_A} It was written by Dr. Smith, who is long enough.`;
  expect(splitSentences(text, seg).map((s) => text.slice(s.from, s.to))).toEqual([
    "This sentence was wrapped in the page source\nright in the middle.",
    LONG_A,
    "It was written by Dr. Smith, who is long enough.",
  ]);
});

test("splitSentences: long sentences are cut at a clause, then a space, in any script", () => {
  const seg = new Intl.Segmenter("en", { granularity: "sentence" });
  const clause = "word ".repeat(40) + "end of clause, " + "more ".repeat(40) + "done.";
  const parts = splitSentences(clause, seg).map((s) => clause.slice(s.from, s.to));
  expect(parts[0].endsWith("clause,")).toBe(true);
  expect(parts.join(" ")).toBe(clause);

  const words = "word ".repeat(100).trim() + ".";
  for (const s of splitSentences(words, seg)) expect(s.to - s.from).toBeLessThanOrEqual(300);
  expect(splitSentences(words, seg).map((s) => words.slice(s.from, s.to)).join(" ")).toBe(words);

  const zh = "这是一个很长的句子".repeat(30) + "，" + "后面还有更多的内容".repeat(10) + "。";
  const zhParts = splitSentences(zh, new Intl.Segmenter("zh", { granularity: "sentence" }));
  expect(zh.slice(zhParts[0].from, zhParts[0].to).endsWith("，")).toBe(true);
  expect(zhParts.map((s) => zh.slice(s.from, s.to)).join("")).toBe(zh);
});

test("extract: one sentence per long sentence, text length equals source length", () => {
  const s = page(`<p>${LONG_A}\n${LONG_B}</p>`);
  expect(s.map((x) => x.text)).toEqual([LONG_A, LONG_B]);
  // whitespace is replaced one-for-one, never collapsed
  const t = page(`<p>${LONG_A.replace(" is ", "\n\n  is ")}</p>`);
  expect(t[0].text.length).toBe(t[0].to - t[0].from);
  expect(t[0].text).not.toMatch(/\n/);
});

test("extract: skips navigation, scripts, hidden and aria-hidden content", () => {
  const s = page(`
    <nav>${LONG_A}</nav>
    <script>${LONG_A}</script>
    <div style="display:none">${LONG_A}</div>
    <div aria-hidden="true">${LONG_A}</div>
    <p>${LONG_B}</p>`);
  expect(s.map((x) => x.text)).toEqual([LONG_B]);
});

test("extract: inline elements stay in one block, blocks stay apart", () => {
  const s = page(`<p>${LONG_A.slice(0, 20)}<b style="display:inline">${LONG_A.slice(20)}</b></p><p>${LONG_B}</p>`);
  expect(s.map((x) => x.text)).toEqual([LONG_A, LONG_B]);
});

test("extract: prefers <main> over the rest of the body", () => {
  const s = page(`<p>${LONG_A}</p><main><p>${LONG_B}</p></main>`);
  expect(s.map((x) => x.text)).toEqual([LONG_B]);
});

test("rangeOf maps a sentence, or a word in it, back to the page text", () => {
  const s = page(`<p>${LONG_A.slice(0, 20)}<b style="display:inline">${LONG_A.slice(20)}</b></p>`);
  expect(rangeOf(s[0]).toString()).toBe(LONG_A);
  const from = LONG_A.indexOf("comfortably");
  expect(rangeOf(s[0], from, from + 11).toString()).toBe("comfortably"); // spans a node boundary
});

test("locate finds the sentence under a DOM position", () => {
  const s = page(`<p>${LONG_A} ${LONG_B}</p>`);
  const node = document.querySelector("p")!.firstChild!;
  expect(locate(s, node, 5)).toBe(0);
  expect(locate(s, node, LONG_A.length + 10)).toBe(1);
  expect(locate(s, document.body, 0)).toBe(-1);
  expect(locate(s, null, 0)).toBe(-1);
});

test("extract: a selection reads only the sentences it touches, even in skipped regions", () => {
  document.body.innerHTML = `<main><p>${LONG_A} ${LONG_B}</p></main><aside><p id="x">${LONG_B} ${LONG_A}</p></aside>`;
  const node = document.querySelector("#x")!.firstChild!;
  const range = document.createRange();
  range.setStart(node, 5);
  range.setEnd(node, 10);
  expect(extract(range).map((x) => x.text)).toEqual([LONG_B]);
});

test("extract: a caret outside <main> reads the region around it", () => {
  document.body.innerHTML = `<main><p>${LONG_A}</p></main><div id="chat"><p>${LONG_B}</p><p>${LONG_A}</p></div>`;
  const range = document.createRange();
  range.setStart(document.querySelector("#chat p")!.firstChild!, 3);
  expect(extract(range).map((x) => x.text)).toEqual([LONG_B, LONG_A]);
  range.setStart(document.querySelector("main p")!.firstChild!, 3);
  range.collapse(true); // moving only the start back would select from main to the chat
  expect(extract(range).map((x) => x.text)).toEqual([LONG_A]);
});
