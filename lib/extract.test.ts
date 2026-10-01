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
