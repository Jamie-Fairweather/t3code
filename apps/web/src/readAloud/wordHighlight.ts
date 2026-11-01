/**
 * Marks the word being read aloud in its reply, using CSS highlights so the rendered markdown is
 * never touched. Runs outside React: it repaints on every word without re-rendering anything.
 */
import type { ReadAloudWordStyle } from "@t3tools/contracts";

import { getClientSettings, subscribeClientSettings } from "~/hooks/useSettings";

import { type SpokenWord, subscribeSpokenWord } from "./readAloudEngine";
import { parseReadAloudKey } from "./readProgress";
import { type TextSpan, locateWords } from "./wordLocate";
import { splitWords } from "./wordTiming";

const HIGHLIGHT_NAMES: Record<ReadAloudWordStyle, string> = {
  underline: "t3-read-aloud-underline",
  highlight: "t3-read-aloud-highlight",
  both: "t3-read-aloud-both",
};
/** Never spoken, so never searched: matching inside them would pull the underline ahead. */
const UNSPOKEN = "pre, table";

/** Per reply, where the next sentence's search starts in its on-screen text. */
const cursors = new Map<string, number>();
let placed: { readonly chunkId: number; readonly spans: ReadonlyArray<TextSpan | null> } | null =
  null;
let current: SpokenWord | null = null;

function supported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/** The reply's readable text and where each text node starts in it. */
function readableText(root: HTMLElement) {
  const nodes: Array<{ readonly node: Text; readonly start: number }> = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(UNSPOKEN) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: text.length });
    text += node.textContent ?? "";
  }
  return { text, nodes };
}

function toRange(
  nodes: ReadonlyArray<{ readonly node: Text; readonly start: number }>,
  [start, end]: TextSpan,
): Range | null {
  const first = nodes.findLast((entry) => entry.start <= start);
  const last = nodes.findLast((entry) => entry.start < end);
  if (first === undefined || last === undefined) return null;
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

function clear(): void {
  for (const name of Object.values(HIGHLIGHT_NAMES)) CSS.highlights.delete(name);
}

function replyRoot(key: string): HTMLElement | null {
  const reply = parseReadAloudKey(key);
  return reply === null
    ? null
    : document.querySelector<HTMLElement>(`[data-read-aloud-item="${CSS.escape(reply.itemId)}"]`);
}

/** Starts matching `key`'s spoken words at `range`, so a read-aloud selection lights up there. */
export function startWordsAt(key: string, range: Range): void {
  const root = replyRoot(key);
  const entry = root
    ? readableText(root).nodes.find(({ node }) => node === range.startContainer)
    : undefined;
  cursors.set(key, entry ? entry.start + range.startOffset : 0);
}

function paint(word: SpokenWord | null): void {
  current = word;
  clear();
  const settings = getClientSettings();
  if (word === null || !settings.readAloudWordHighlight) return;
  const root = replyRoot(word.key);
  // Scrolled out of view, or not a reply (the voice preview).
  if (root === null) return;
  const { text, nodes } = readableText(root);
  if (placed?.chunkId !== word.chunkId) {
    const located = locateWords(text, splitWords(word.text), cursors.get(word.key) ?? 0);
    cursors.set(word.key, located.end);
    placed = { chunkId: word.chunkId, spans: located.spans };
  }
  const span = placed.spans[word.index];
  const range = span ? toRange(nodes, span) : null;
  if (range === null) return;
  document.documentElement.dataset.readAloudWordColor = settings.readAloudWordColor;
  CSS.highlights.set(HIGHLIGHT_NAMES[settings.readAloudWordStyle], new Highlight(range));
}

/** Starts following spoken words; returns the function that stops it. */
export function startWordHighlighting(): () => void {
  if (!supported()) return () => {};
  const stopWords = subscribeSpokenWord(paint);
  const stopSettings = subscribeClientSettings(() => paint(current));
  return () => {
    stopWords();
    stopSettings();
    clear();
  };
}
