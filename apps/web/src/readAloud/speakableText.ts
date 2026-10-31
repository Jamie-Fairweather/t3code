/**
 * Turns streamed assistant markdown into short plain-text chunks a voice can read.
 * Code blocks, tables, and URLs are skipped; links and paths are shortened.
 */

const FENCE = /^ {0,3}(```|~~~)/;
/** Kokoro reads at most ~510 phonemes per call, so long sentences are split further. */
const MAX_CHUNK_CHARS = 280;

export interface SpeakableProgress {
  /** Chunks ready to speak, in order. */
  readonly chunks: ReadonlyArray<string>;
  /** Index in the raw text up to which everything has been consumed. */
  readonly consumedTo: number;
}

/**
 * Consumes complete sentences from `text` starting at `from`. While `final` is false, a trailing
 * partial sentence, or anything inside an unclosed code fence, waits for more text.
 */
export function takeSpeakable(text: string, from: number, final: boolean): SpeakableProgress {
  const end = final ? text.length : lastSafeBoundary(text, from);
  if (end <= from) return { chunks: [], consumedTo: from };
  return { chunks: splitChunks(toSpeakable(text.slice(from, end))), consumedTo: end };
}

/** The last index after a sentence or line end that is outside any code fence. */
function lastSafeBoundary(text: string, from: number): number {
  let inFence = false;
  let fenceStart = -1;
  let boundary = from;
  let lineStart = 0;
  while (lineStart < text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline + 1;
    const line = text.slice(lineStart, newline === -1 ? text.length : newline);
    const complete = newline !== -1;
    if (FENCE.test(line)) {
      if (!complete) break;
      inFence = !inFence;
      fenceStart = lineStart;
      if (!inFence && lineEnd > boundary) boundary = lineEnd;
    } else if (!inFence && lineEnd > from) {
      if (complete) {
        boundary = Math.max(boundary, lineEnd);
      } else {
        const sentenceEnd = lastSentenceEnd(line);
        if (sentenceEnd !== -1) boundary = Math.max(boundary, lineStart + sentenceEnd);
      }
    }
    lineStart = lineEnd;
  }
  return inFence ? Math.min(boundary, Math.max(fenceStart, from)) : boundary;
}

/** Offset just past the last `.`, `!` or `?` that is followed by whitespace. */
function lastSentenceEnd(line: string): number {
  let result = -1;
  for (const match of line.matchAll(/[.!?]["')\]]*\s+/g)) {
    result = match.index + match[0].length;
  }
  return result;
}

/** Plain text for a slice of markdown that never starts or ends inside a code fence. */
export function toSpeakable(markdown: string): string {
  const lines: Array<string> = [];
  let inFence = false;
  for (const rawLine of markdown.split("\n")) {
    if (FENCE.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = speakableLine(rawLine);
    if (line.length === 0) continue;
    lines.push(/[.!?:;,]$/.test(line) ? line : `${line}.`);
  }
  return lines.join(" ");
}

function speakableLine(raw: string): string {
  let line = raw.trim();
  // Tables and horizontal rules read as noise.
  if (line.startsWith("|") || /^([-*_]\s*){3,}$/.test(line)) return "";
  line = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, (_, label: string) => shortenCode(label))
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`([^`]+)`/g, (_, code: string) => shortenCode(code))
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/(^|\s)[*_]([^*_\s][^*_]*)[*_](?=\s|[.,;:!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  return line;
}

/** File paths read as their file name; other code reads as written. */
function shortenCode(code: string): string {
  const trimmed = code.trim().replace(/:\d+(:\d+)?$/, "");
  if (/[\\/]/.test(trimmed) && !/\s/.test(trimmed)) {
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? trimmed;
  }
  return trimmed;
}

/** Splits into sentences, then splits any sentence too long for one synthesis call. */
export function splitChunks(text: string): Array<string> {
  const chunks: Array<string> = [];
  for (const part of text.split(/(?<=[.!?]["')\]]*)\s+/)) {
    let sentence = part.trim();
    while (sentence.length > MAX_CHUNK_CHARS) {
      const cut = breakPoint(sentence);
      chunks.push(sentence.slice(0, cut).trim());
      sentence = sentence.slice(cut).trim();
    }
    if (/[\p{L}\p{N}]/u.test(sentence)) chunks.push(sentence);
  }
  return chunks;
}

function breakPoint(sentence: string): number {
  const window = sentence.slice(0, MAX_CHUNK_CHARS);
  const punctuation = Math.max(
    window.lastIndexOf(", "),
    window.lastIndexOf("; "),
    window.lastIndexOf(": "),
  );
  if (punctuation > MAX_CHUNK_CHARS / 3) return punctuation + 1;
  const space = window.lastIndexOf(" ");
  return space > 0 ? space : MAX_CHUNK_CHARS;
}
