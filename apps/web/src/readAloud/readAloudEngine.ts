/**
 * Plays text through the Kokoro worker; the next chunk synthesizes while the current one plays.
 * Nothing stays loaded while there is nothing to say: the worker, model, and audio device start
 * on the first chunk and are released after IDLE_UNLOAD_MS of quiet.
 */
import { useSyncExternalStore } from "react";

import type { ReadAloudWorkerRequest, ReadAloudWorkerResponse } from "./workerProtocol";

const IDLE_UNLOAD_MS = 30_000;

/** `idle` means nothing is loaded; `loading` and `ready` mean the model is in memory. */
export type ReadAloudStatus = "idle" | "loading" | "ready" | "error";

export interface ReadAloudState {
  readonly status: ReadAloudStatus;
  readonly speaking: boolean;
  readonly device: "webgpu" | "wasm" | null;
  readonly error: string | null;
}

const IDLE: ReadAloudState = { status: "idle", speaking: false, device: null, error: null };

let state = IDLE;
const listeners = new Set<() => void>();

function setState(patch: Partial<ReadAloudState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

let worker: Worker | null = null;
let audio: AudioContext | null = null;
let epoch = 0;
let nextId = 0;
/** Chunks sent to the worker in the current epoch whose audio has not arrived yet. */
let pending = 0;
let playhead = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const playing = new Set<AudioBufferSourceNode>();

function post(request: ReadAloudWorkerRequest): void {
  worker?.postMessage(request);
}

function onWorkerMessage(event: MessageEvent<ReadAloudWorkerResponse>): void {
  const message = event.data;
  switch (message.type) {
    case "ready":
      setState({ status: "ready", device: message.device, error: null });
      return;
    case "error":
      pending = 0;
      setState({ status: "error", error: message.message });
      scheduleUnloadWhenQuiet();
      return;
    case "audio":
      if (message.epoch !== epoch) return;
      pending = Math.max(0, pending - 1);
      play(message.samples, message.sampleRate);
      return;
  }
}

function play(samples: Float32Array, sampleRate: number): void {
  if (audio === null) return;
  const buffer = audio.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  const startAt = Math.max(audio.currentTime + 0.02, playhead);
  source.start(startAt);
  playhead = startAt + buffer.duration;
  playing.add(source);
  setState({ speaking: true });
  source.addEventListener("ended", () => {
    playing.delete(source);
    if (playing.size === 0) setState({ speaking: false });
    scheduleUnloadWhenQuiet();
  });
}

function cancelUnload(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleUnloadWhenQuiet(): void {
  if (pending > 0 || playing.size > 0 || worker === null) return;
  cancelUnload();
  idleTimer = setTimeout(unload, IDLE_UNLOAD_MS);
}

function unload(): void {
  cancelUnload();
  worker?.terminate();
  worker = null;
  void audio?.close();
  audio = null;
  playhead = 0;
  pending = 0;
  playing.clear();
  if (state !== IDLE) setState(IDLE);
}

function ensureRunning(): void {
  cancelUnload();
  if (audio === null) audio = new AudioContext();
  void audio.resume();
  if (worker !== null) return;
  worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", onWorkerMessage);
  worker.addEventListener("error", (event) => {
    pending = 0;
    setState({ status: "error", error: event.message || "The voice failed to load." });
    scheduleUnloadWhenQuiet();
  });
  setState({ status: "loading", error: null });
}

export function speak(text: string, voice: string): void {
  ensureRunning();
  pending += 1;
  post({ type: "speak", id: nextId++, epoch, text, voice });
}

/** Silences current speech and drops anything still queued. */
export function stopSpeaking(): void {
  epoch += 1;
  pending = 0;
  post({ type: "cancel", epoch });
  for (const source of playing) source.stop();
  playing.clear();
  playhead = 0;
  if (state.speaking) setState({ speaking: false });
  scheduleUnloadWhenQuiet();
}

/** Stops speech and releases everything immediately, e.g. when read aloud is turned off. */
export function shutdownReadAloud(): void {
  stopSpeaking();
  unload();
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
