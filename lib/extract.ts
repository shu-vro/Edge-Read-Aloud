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
/**
 * Longer sentences are cut at a clause boundary, so the first audio does not wait on a huge
 * request. Cuts mid-sentence change the voice's intonation, so the limit is generous.
 */
const MAX_CHARS = 300;
/** Punctuation that ends a clause, across scripts: Latin, Arabic, CJK, Devanagari, Ethiopic. */
const CLAUSE = /[,;:\u060C\u061B\u3001\uFF0C\uFF1B\uFF1A\u0964\u1363\u1364\u2013\u2014)\]]/u;
/** "Dr.", "Mr.", "J." look like sentence ends to the segmenter. */
const ABBREVIATION = /(?:^|\s)(?:\p{L}|\p{Lu}\p{Ll}{1,2})\.$/u;

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
      // Only skip inside the root: text the user picked in, say, an <aside> is still read.
      const skip = parent.closest(SKIP);
      const skipped = skip && skip !== root && root.contains(skip);
      blockEl = skipped || !parent.checkVisibility() ? null : blockOf(parent);
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
  // Source line breaks inside a paragraph are not sentence ends, but the segmenter treats them
  // as such. Same length, so its offsets still apply to `text`.
  for (const s of seg.segment(text.replace(/\s/g, " "))) {
    const to = s.index + s.segment.length;
    const piece = text.slice(from, to).trim();
    if (piece.length >= MIN_CHARS && !ABBREVIATION.test(piece)) flush(to);
  }
  flush(text.length);
  return spans.flatMap((span) => limit(text, span));
}

/** Cuts a span longer than MAX_CHARS at its last clause punctuation, else its last space. */
function limit(text: string, { from, to }: { from: number; to: number }): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  while (to - from > MAX_CHARS) {
    let cut = -1;
    let space = -1;
    for (let i = from + MAX_CHARS - 1; i > from + MIN_CHARS && cut < 0; i--) {
      if (CLAUSE.test(text[i])) cut = i + 1;
      else if (space < 0 && /\s/.test(text[i])) space = i;
    }
    // ponytail: hard cut when a script has neither (unpunctuated Thai, CJK); a word Segmenter
    // would find a word boundary there.
    if (cut < 0) cut = space > 0 ? space : from + MAX_CHARS;
    if (/[\uDC00-\uDFFF]/.test(text[cut])) cut--; // keep surrogate pairs whole
    const head = text.slice(from, cut);
    out.push({ from, to: from + head.trimEnd().length });
    from = cut + (text.slice(cut, to).length - text.slice(cut, to).trimStart().length);
  }
  out.push({ from, to });
  return out;
}

/**
 * The sentences to read. `from` is where the user pointed: a selection reads only the sentences
 * it touches; a caret (a tap on text) reads the region around it, which may lie outside the
 * main content, such as a chat sidebar next to `<main>`.
 */
export function extract(from?: Range): Sentence[] {
  const main = readingRoot();
  let root = main;
  if (from) {
    const at = from.commonAncestorContainer;
    root = at instanceof Element ? at : at.parentElement ?? main;
    if (from.collapsed) {
      if (main.contains(root)) root = main;
      // The largest subtree around the caret that is not part of the main content.
      else while (root.parentElement && !root.parentElement.contains(main)) root = root.parentElement;
    }
  }
  const seg = segmenter();
  const sentences = collectBlocks(root).flatMap((block) =>
    splitSentences(block.text, seg).map(({ from, to }) => ({
      // Same length as the source, so word offsets from the speech service still line up.
      text: block.text.slice(from, to).replace(/\s/g, " "),
      block,
      from,
      to,
    })),
  );
  if (!from || from.collapsed) return sentences;
  return sentences.filter((s) => {
    const r = rangeOf(s);
    return (
      r.compareBoundaryPoints(Range.START_TO_END, from) > 0 &&
      r.compareBoundaryPoints(Range.END_TO_START, from) < 0
    );
  });
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
