/**
 * Page -> sentences, each of which can be turned back into a DOM Range.
 *
 * Text nodes are grouped by their nearest block-level ancestor. A block's text is the plain
 * concatenation of its nodes (whitespace is replaced one-for-one, never collapsed), so a
 * character offset in the text maps straight back to a node and an offset inside it.
 */

const SKIP =
  "script,style,noscript,template,nav,aside,footer,button,select,textarea,input,pre,svg,math,sup," +
  "figure,[aria-hidden=true],[contenteditable=''],[contenteditable=true],[role=navigation]," +
  "[role=note],[role=status],.noprint,.sr-only,.visually-hidden,[data-edge-tts]," +
  // Wikipedia chrome that sits inside the article body.
  ".mw-editsection,.mw-indicators,.infobox,.navbox,.thumb";

/** Sentences shorter than this are read together with the next one, to save round trips. */
const MIN_CHARS = 40;

type Block = { nodes: { node: Text; start: number }[]; text: string };

export type Sentence = { text: string; block: Block; from: number; to: number };

const owners = new WeakMap<Node, { block: Block; start: number }>();

function readingRoot(): Element {
  const articles = document.querySelectorAll("article");
  return (
    document.querySelector("main, [role=main]") ??
    (articles.length === 1 ? articles[0] : document.body)
  );
}

function blockOf(el: Element): Element {
  while (el.parentElement && /^(inline|contents|ruby)/.test(getComputedStyle(el).display)) {
    el = el.parentElement;
  }
  return el;
}

function collectBlocks(root: Element): Block[] {
  const blocks: Block[] = [];
  // Per parent element: its block ancestor, or null when its text should not be read.
  const parents = new Map<Element, Element | null>();
  let current: Block | undefined;
  let currentEl: Element | undefined;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (!parent) continue;
    let blockEl = parents.get(parent);
    if (blockEl === undefined) {
      blockEl = parent.closest(SKIP) || !parent.checkVisibility() ? null : blockOf(parent);
      parents.set(parent, blockEl);
    }
    if (!blockEl) continue;
    if (blockEl !== currentEl) {
      if (!node.data.trim()) continue; // whitespace between blocks
      current = { nodes: [], text: "" };
      currentEl = blockEl;
      blocks.push(current);
    }
    owners.set(node, { block: current!, start: current!.text.length });
    current!.nodes.push({ node, start: current!.text.length });
    current!.text += node.data;
  }
  return blocks;
}

function segmenter(): Intl.Segmenter {
  try {
    return new Intl.Segmenter(document.documentElement.lang || undefined, { granularity: "sentence" });
  } catch {
    return new Intl.Segmenter(undefined, { granularity: "sentence" });
  }
}

export function splitSentences(text: string, seg: Intl.Segmenter): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let from = 0;
  const flush = (to: number) => {
    const piece = text.slice(from, to);
    if (/[\p{L}\p{N}]/u.test(piece)) {
      const lead = piece.length - piece.trimStart().length;
      spans.push({ from: from + lead, to: from + piece.trimEnd().length });
    }
    from = to;
  };
  for (const s of seg.segment(text)) {
    const to = s.index + s.segment.length;
    if (text.slice(from, to).trim().length >= MIN_CHARS) flush(to);
  }
  flush(text.length);
  return spans;
}

export function extract(): Sentence[] {
  const seg = segmenter();
  return collectBlocks(readingRoot()).flatMap((block) =>
    splitSentences(block.text, seg).map(({ from, to }) => ({
      // Same length as the source, so word offsets from the speech service still line up.
      text: block.text.slice(from, to).replace(/\s/g, " "),
      block,
      from,
      to,
    })),
  );
}

function point(block: Block, offset: number): [Text, number] {
  const entry = block.nodes.findLast((n) => n.start <= offset)!;
  return [entry.node, Math.min(offset - entry.start, entry.node.length)];
}

/** Range for characters [from, to) of the sentence's text; the whole sentence by default. */
export function rangeOf(s: Sentence, from = 0, to = s.text.length): Range {
  const range = document.createRange();
  range.setStart(...point(s.block, s.from + from));
  range.setEnd(...point(s.block, s.from + to));
  return range;
}

/** Index of the sentence containing this DOM position, or -1. */
export function locate(sentences: Sentence[], node: Node | null | undefined, offset: number): number {
  const owner = node && owners.get(node);
  if (!owner) return -1;
  const at = owner.start + offset;
  return sentences.findIndex((s) => s.block === owner.block && at >= s.from && at <= s.to);
}
