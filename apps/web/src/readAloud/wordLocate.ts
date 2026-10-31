/**
 * Finds spoken words in a reply's on-screen text. The spoken text is a cleaned-up copy of the
 * markdown (paths shortened, punctuation added), so words are matched by their letters and
 * digits only, and a match grows to the whole on-screen word around it, e.g. a full file path.
 */

export type TextSpan = readonly [start: number, end: number];

/** How far past the last match a word may be before it counts as not on screen. */
const LOOKAHEAD = 300;
/** How many leading words must match in a row to place a sentence. */
const ANCHOR_WORDS = 3;
const LEADING_PUNCTUATION = /^[("'“‘[«*_]+/;
const TRAILING_PUNCTUATION = /[.,;:!?)"'”’\]»*_]+$/;
const ALNUM = /[\p{L}\p{N}]/u;

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

interface IndexedText {
  readonly text: string;
  /** The text's letters and digits, lowercased. */
  readonly letters: string;
  /** Index in `text` of each character of `letters`. */
  readonly positions: ReadonlyArray<number>;
}

function indexText(text: string): IndexedText {
  let letters = "";
  const positions: Array<number> = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (!ALNUM.test(char)) continue;
    const lower = char.toLowerCase();
    // Keep one stream character per text character so positions stay aligned.
    letters += lower.length === 1 ? lower : char;
    positions.push(index);
  }
  return { text, letters, positions };
}

/** The first match of `needle` at or after text offset `from` that starts and ends on a word edge. */
function findWord(
  indexed: IndexedText,
  needle: string,
  from: number,
  until: number,
): TextSpan | null {
  const { text, letters, positions } = indexed;
  let streamFrom = lowerBound(positions, from);
  while (streamFrom < letters.length) {
    const found = letters.indexOf(needle, streamFrom);
    if (found === -1) return null;
    const start = positions[found]!;
    if (start > until) return null;
    const end = positions[found + needle.length - 1]! + 1;
    const startsWord = start === 0 || !ALNUM.test(text[start - 1]!);
    const endsWord = end >= text.length || !ALNUM.test(text[end]!);
    if (startsWord && endsWord) return [start, end];
    streamFrom = found + 1;
  }
  return null;
}

function lowerBound(values: ReadonlyArray<number>, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid]! < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Grows a match to the whitespace-separated word around it, minus surrounding punctuation. */
function wholeWord(text: string, [start, end]: TextSpan): TextSpan {
  let left = start;
  while (left > 0 && !/\s/.test(text[left - 1]!)) left -= 1;
  let right = end;
  while (right < text.length && !/\s/.test(text[right]!)) right += 1;
  const token = text.slice(left, right);
  const leading = LEADING_PUNCTUATION.exec(token)?.[0].length ?? 0;
  const trailing = TRAILING_PUNCTUATION.exec(token)?.[0].length ?? 0;
  return [Math.min(start, left + leading), Math.max(end, right - trailing)];
}

/** Where the sentence starts: its first few words in a row, at or after `from` if possible. */
function anchor(indexed: IndexedText, needles: ReadonlyArray<string>, from: number): number | null {
  const lead = needles.filter((needle) => needle.length > 0).slice(0, ANCHOR_WORDS);
  if (lead.length === 0) return null;
  for (const searchFrom of from > 0 ? [from, 0] : [0]) {
    let start = searchFrom;
    for (;;) {
      const first = findWord(indexed, lead[0]!, start, Infinity);
      if (first === null) break;
      let cursor = first[1];
      const inRow = lead.slice(1).every((needle) => {
        const next = findWord(indexed, needle, cursor, cursor + 40);
        if (next !== null) cursor = next[1];
        return next !== null;
      });
      if (inRow) return first[0];
      start = first[0] + 1;
    }
  }
  return null;
}

/**
 * Places each spoken word of one sentence in `text`, reading on from offset `from`.
 * Words not found nearby get null. `end` is where the next sentence should search from.
 */
export function locateWords(
  text: string,
  words: ReadonlyArray<string>,
  from: number,
): { readonly spans: ReadonlyArray<TextSpan | null>; readonly end: number } {
  const indexed = indexText(text);
  const needles = words.map(normalize);
  let cursor = anchor(indexed, needles, from) ?? from;
  let end = from;
  const spans = needles.map((needle) => {
    if (needle.length === 0) return null;
    const found = findWord(indexed, needle, cursor, cursor + LOOKAHEAD);
    if (found === null) return null;
    cursor = found[1];
    end = found[1];
    return wholeWord(text, found);
  });
  return { spans, end };
}
