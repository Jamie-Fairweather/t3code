/**
 * Plays text through the Kokoro worker; the next chunk synthesizes while the current one plays.
 * While read aloud is on the model stays loaded (see setKeepLoaded). While it is off, a one-off
 * read loads the model and releases it once the last chunk has played.
 */
import { useSyncExternalStore } from "react";

import type { ReadAloudWorkerRequest, ReadAloudWorkerResponse } from "./workerProtocol";
import type { WordTime } from "./wordTiming";

/** `idle` means nothing is loaded; `loading` and `ready` mean the model is in memory. */
export type ReadAloudStatus = "idle" | "loading" | "ready" | "error";

export interface ReadAloudState {
  readonly status: ReadAloudStatus;
  /** Key of the chunk playing now, or next to play. Null when nothing is queued. */
  readonly activeKey: string | null;
  readonly device: "webgpu" | "wasm" | null;
  readonly error: string | null;
  /** Bumped by every stop, so readers know queued chunks were dropped. */
  readonly epoch: number;
}

export interface SpeakOptions {
  readonly voice: string;
  readonly speed: number;
  /** Groups chunks, e.g. by message, for `activeKey` and `stopSpeaking`'s result. */
  readonly key: string;
  /** Runs once this chunk has played to the end. Not called for dropped chunks. */
  readonly onHeard?: () => void;
}

/** The word being said now: index `index` of `splitWords(text)` for the chunk `chunkId`. */
export interface SpokenWord {
  readonly key: string;
  readonly chunkId: number;
  readonly text: string;
  readonly index: number;
}

interface QueuedChunk {
  readonly id: number;
  readonly key: string;
  readonly text: string;
  readonly onHeard: (() => void) | undefined;
  source: AudioBufferSourceNode | null;
  wordTimers: Array<ReturnType<typeof setTimeout>>;
}

const IDLE: ReadAloudState = {
  status: "idle",
  activeKey: null,
  device: null,
  error: null,
  epoch: 0,
};

let state = IDLE;
const listeners = new Set<() => void>();

function setState(patch: Partial<ReadAloudState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

let worker: Worker | null = null;
let audio: AudioContext | null = null;
let keepLoaded = false;
let nextId = 0;
let playhead = 0;
/** Chunks sent in the current epoch, in play order, until they finish playing. */
let queue: Array<QueuedChunk> = [];
let spokenWord: SpokenWord | null = null;
const wordListeners = new Set<(word: SpokenWord | null) => void>();

function setSpokenWord(next: SpokenWord | null): void {
  if (next === spokenWord) return;
  spokenWord = next;
  for (const listener of wordListeners) listener(next);
}

/** Calls `listener` as each word starts, without going through React. */
export function subscribeSpokenWord(listener: (word: SpokenWord | null) => void): () => void {
  wordListeners.add(listener);
  return () => wordListeners.delete(listener);
}

function clearWords(chunk: QueuedChunk): void {
  for (const timer of chunk.wordTimers) clearTimeout(timer);
  chunk.wordTimers = [];
  if (spokenWord?.chunkId === chunk.id) setSpokenWord(null);
}

/** Drops every queued chunk, returning the sources still scheduled to play. */
function clearQueue(): Array<AudioBufferSourceNode> {
  const sources = queue.flatMap((chunk) => (chunk.source === null ? [] : [chunk.source]));
  for (const chunk of queue) clearWords(chunk);
  queue = [];
  syncActiveKey();
  return sources;
}

function post(request: ReadAloudWorkerRequest): void {
  worker?.postMessage(request);
}

function syncActiveKey(): void {
  const activeKey = queue[0]?.key ?? null;
  if (activeKey !== state.activeKey) setState({ activeKey });
}

function remove(chunk: QueuedChunk): void {
  clearWords(chunk);
  queue = queue.filter((queued) => queued !== chunk);
  syncActiveKey();
  unloadIfUnused();
}

function onWorkerMessage(event: MessageEvent<ReadAloudWorkerResponse>): void {
  const message = event.data;
  switch (message.type) {
    case "ready":
      setState({ status: "ready", device: message.device, error: null });
      return;
    case "error": {
      if (message.id === null) {
        setState({ status: "error", error: message.message });
        clearQueue();
        unloadIfUnused();
        return;
      }
      // One sentence failed; skip it and keep going.
      const failed = queue.find((chunk) => chunk.id === message.id);
      if (failed !== undefined) remove(failed);
      return;
    }
    case "audio": {
      if (message.epoch !== state.epoch) return;
      const chunk = queue.find((queued) => queued.id === message.id);
      if (chunk !== undefined) play(chunk, message.samples, message.sampleRate, message.words);
      return;
    }
  }
}

function play(
  chunk: QueuedChunk,
  samples: Float32Array,
  sampleRate: number,
  words: ReadonlyArray<WordTime>,
): void {
  if (audio === null) return;
  const buffer = audio.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  const startAt = Math.max(audio.currentTime + 0.02, playhead);
  source.start(startAt);
  playhead = startAt + buffer.duration;
  chunk.source = source;
  const context = audio;
  chunk.wordTimers = words.map((word, index) =>
    setTimeout(
      () => setSpokenWord({ key: chunk.key, chunkId: chunk.id, text: chunk.text, index }),
      Math.max(0, (startAt + word.start - context.currentTime) * 1000),
    ),
  );
  source.addEventListener("ended", () => {
    // A stop also fires `ended`; a stopped chunk has already left the queue.
    if (!queue.includes(chunk)) return;
    chunk.onHeard?.();
    remove(chunk);
  });
}

function unload(): void {
  worker?.terminate();
  worker = null;
  void audio?.close();
  audio = null;
  playhead = 0;
  // Keep a load error visible after releasing the broken worker.
  if (state.status !== "error") setState({ status: "idle", device: null, error: null });
}

function unloadIfUnused(): void {
  if (!keepLoaded && queue.length === 0 && worker !== null) unload();
}

function ensureWorker(): void {
  if (worker !== null) return;
  worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", onWorkerMessage);
  worker.addEventListener("error", (event) => {
    setState({ status: "error", error: event.message || "The voice failed to load." });
    clearQueue();
    unloadIfUnused();
  });
  setState({ status: "loading", error: null });
}

/** While true the model loads now and stays loaded; turning it off stops speech and unloads. */
export function setKeepLoaded(next: boolean): void {
  keepLoaded = next;
  if (next) {
    ensureWorker();
    return;
  }
  stopSpeaking();
  if (worker !== null) unload();
  if (state.status === "error") setState({ status: "idle", device: null, error: null });
}

export function speak(text: string, options: SpeakOptions): void {
  ensureWorker();
  audio ??= new AudioContext();
  void audio.resume();
  const id = nextId++;
  queue.push({
    id,
    key: options.key,
    text,
    onHeard: options.onHeard,
    source: null,
    wordTimers: [],
  });
  syncActiveKey();
  post({
    type: "speak",
    id,
    epoch: state.epoch,
    text,
    voice: options.voice,
    speed: options.speed,
  });
}

/** Silences current speech and drops everything queued. Returns the keys that were dropped. */
export function stopSpeaking(): ReadonlySet<string> {
  const dropped = new Set(queue.map((chunk) => chunk.key));
  const sources = clearQueue();
  playhead = 0;
  setState({ epoch: state.epoch + 1, activeKey: null });
  post({ type: "cancel", epoch: state.epoch });
  for (const source of sources) source.stop();
  unloadIfUnused();
  return dropped;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadAloudState(): ReadAloudState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => IDLE,
  );
}

/** Whether chunks for `key` are playing or queued; re-renders only when that changes. */
export function useIsReadingAloud(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.activeKey === key,
    () => false,
  );
}

export function readAloudEpoch(): number {
  return state.epoch;
}

export function useReadAloudEpoch(): number {
  return useSyncExternalStore(
    subscribe,
    () => state.epoch,
    () => 0,
  );
}
