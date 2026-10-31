/**
 * Remembers, per thread, how much of each reply has been read aloud, across restarts.
 * A reply is due for reading only when it comes after the user's latest message, was not
 * already finished before read aloud was turned on (`since`), and has sentences left unheard.
 */
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { DateTime } from "effect";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "t3:read-aloud-progress:v1";
const MAX_THREADS = 500;
/** Heard count meaning the whole reply counts as read. */
export const HEARD_ALL = -1;

/** Item id to the number of chunks heard, or HEARD_ALL. */
export type HeardByItem = Readonly<Record<string, number>>;

interface Progress {
  /** Epoch ms when read aloud was last turned on. Replies finished earlier count as read. */
  since: number | null;
  /** Insertion order is recency order, oldest first. */
  threads: Record<string, HeardByItem>;
}

const EMPTY_HEARD: HeardByItem = {};
let progress: Progress | null = null;
const listeners = new Set<() => void>();

function load(): Progress {
  if (progress !== null) return progress;
  progress = { since: null, threads: {} };
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof stored === "object" && stored !== null) {
      const { since, threads } = stored as Partial<Progress>;
      if (typeof since === "number") progress.since = since;
      if (typeof threads === "object" && threads !== null) progress.threads = threads;
    }
  } catch {
    // Unreadable progress only means old replies count as read from now on.
  }
  return progress;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(load()));
  } catch {
    // Storage full or unavailable: progress still holds for this session.
  }
  for (const listener of listeners) listener();
}

function writeThread(threadKey: string, heard: HeardByItem): void {
  const { threads } = load();
  delete threads[threadKey];
  if (Object.keys(heard).length > 0) threads[threadKey] = heard;
  const keys = Object.keys(threads);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_THREADS))) delete threads[stale];
  save();
}

/** When read aloud was turned on, starting the clock now if it never was. */
export function readAloudSince(): number {
  const state = load();
  if (state.since === null) {
    state.since = Date.now();
    save();
  }
  return state.since;
}

/** Called when the user turns read aloud on: anything finished before now counts as read. */
export function restartReadAloudSince(): void {
  load().since = Date.now();
  save();
}

export function recordHeard(threadKey: string, itemId: string, heard: number): void {
  const current = load().threads[threadKey] ?? EMPTY_HEARD;
  const previous = current[itemId];
  if (
    previous === HEARD_ALL ||
    (previous !== undefined && heard !== HEARD_ALL && previous >= heard)
  ) {
    return;
  }
  writeThread(threadKey, { ...current, [itemId]: heard });
}

/** Keeps only the listed items, dropping replies the rules already treat as read. */
export function keepHeard(threadKey: string, itemIds: ReadonlySet<string>): void {
  const current = load().threads[threadKey];
  if (current === undefined) return;
  if (Object.keys(current).every((itemId) => itemIds.has(itemId))) return;
  writeThread(
    threadKey,
    Object.fromEntries(Object.entries(current).filter(([itemId]) => itemIds.has(itemId))),
  );
}

export function useThreadHeard(threadKey: string): HeardByItem {
  return useSyncExternalStore(
    subscribe,
    () => load().threads[threadKey] ?? EMPTY_HEARD,
    () => EMPTY_HEARD,
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface PlannedRead {
  readonly itemId: string;
  readonly text: string;
  /** False while the reply is still streaming. */
  readonly final: boolean;
  /** Chunks already heard; reading resumes after them. */
  readonly heard: number;
}

export interface ThreadReadPlan {
  /** Replies with something left to read, oldest first. */
  readonly reads: ReadonlyArray<PlannedRead>;
  /** Replies after the user's latest message; progress for any other reply can be dropped. */
  readonly current: ReadonlySet<string>;
}

type TurnItemType = OrchestrationV2ProjectedTurnItem["item"]["type"];

/** The parts of a projected turn item the plan reads. */
export interface PlannableItem {
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
  readonly item:
    | {
        readonly type: "assistant_message";
        readonly id: string;
        readonly text: string;
        readonly streaming: boolean;
        readonly completedAt: DateTime.Utc | null;
      }
    | { readonly type: Exclude<TurnItemType, "assistant_message">; readonly id: string };
}

export function planThreadReads(
  items: ReadonlyArray<PlannableItem>,
  heardByItem: HeardByItem,
  since: number,
): ThreadReadPlan {
  let start = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]!.item.type === "user_message") {
      start = index + 1;
      break;
    }
  }
  const reads: Array<PlannedRead> = [];
  const current = new Set<string>();
  for (const { item, visibility } of items.slice(start)) {
    if (item.type !== "assistant_message" || visibility !== "local") continue;
    current.add(item.id);
    const heard = heardByItem[item.id] ?? 0;
    if (heard === HEARD_ALL) continue;
    if (item.completedAt !== null && DateTime.toEpochMillis(item.completedAt) < since) continue;
    reads.push({ itemId: item.id, text: item.text, final: !item.streaming, heard });
  }
  return { reads, current };
}

/** Engine key for a reply, shared by the auto reader and the reply's read button. */
export function readAloudKey(threadKey: string, itemId: string): string {
  return JSON.stringify([threadKey, itemId]);
}

export function parseReadAloudKey(key: string): { threadKey: string; itemId: string } | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
      return { threadKey: parsed[0], itemId: parsed[1] };
    }
  } catch {
    // Not a reply key.
  }
  return null;
}
