/** Edge reports time in 100-nanosecond units. */
const HNS_PER_SECOND = 1e7;

/** A boundary found further ahead than this is a false match, not the next word. */
const MAX_SKIP = 60;

export type Boundary = { offset: number; duration: number; text: string };

export type Word = {
  /** Seconds from the start of the sentence's audio. */
  start: number;
  end: number;
  /** Character span in the sentence text, or -1/-1 when the spoken word could not be located. */
  from: number;
  to: number;
};

/**
 * Lines the service's word boundaries up with character offsets in the text that was sent.
 * Boundaries carry the word but not where it came from, so each one is searched for forward
 * from the end of the previous match.
 */
export function align(text: string, boundaries: Boundary[]): Word[] {
  const haystack = text.toLowerCase();
  let cursor = 0;
  return boundaries.map((b) => {
    const start = b.offset / HNS_PER_SECOND;
    const end = (b.offset + b.duration) / HNS_PER_SECOND;
    const at = haystack.indexOf(b.text.toLowerCase(), cursor);
    if (at < 0 || at - cursor > MAX_SKIP) return { start, end, from: -1, to: -1 };
    cursor = at + b.text.length;
    return { start, end, from: at, to: cursor };
  });
}

/** Index of the word being spoken at `time`, or -1 before the first one. */
export function wordAt(words: Word[], time: number): number {
  let i = -1;
  while (i + 1 < words.length && words[i + 1].start <= time) i++;
  return i;
}
