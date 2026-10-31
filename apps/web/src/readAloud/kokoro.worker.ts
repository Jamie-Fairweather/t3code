/// <reference lib="webworker" />
/**
 * Runs the Kokoro voice model off the main thread. Uses the GPU through WebGPU when the browser
 * offers it, otherwise a quantized model on the CPU. Requests run one at a time, in order.
 * The timestamped export also reports how long each phoneme lasts, which gives word timings.
 */
import { KokoroTTS, env } from "kokoro-js";
// onnxruntime-web defaults to loading its runtime from a CDN, which the desktop CSP blocks.
import ortWasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";

import type { ReadAloudWorkerRequest, ReadAloudWorkerResponse } from "./workerProtocol";
import { alignWordTimes, estimateWordTimes, splitWords, spokenWords } from "./wordTiming";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
/** The untimed model read aloud used before; its cached files are deleted once. */
const OLD_MODEL_PATH = "/onnx-community/Kokoro-82M-v1.0-ONNX/";

(env as { wasmPaths: unknown }).wasmPaths = { wasm: ortWasmUrl };

declare const self: DedicatedWorkerGlobalScope;

interface ModelOutput {
  readonly durations?: { readonly data: ArrayLike<number> };
}
type Model = (inputs: {
  readonly input_ids: { readonly data: ArrayLike<number | bigint> };
}) => Promise<ModelOutput>;

let epoch = 0;
let queue: Promise<void> = Promise.resolve();
/** Token ids and phoneme frame counts from the most recent generation. */
let lastRun: {
  readonly ids: ReadonlyArray<number>;
  readonly frames: ReadonlyArray<number>;
} | null = null;
const tokenTexts = new Map<number, string>();
const modelPromise = loadModel();
void deleteOldModel();

function post(message: ReadAloudWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu === undefined) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

async function loadModel(): Promise<KokoroTTS> {
  const webgpu = await hasWebGpu();
  try {
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      // Kokoro's quantized weights produce noise on WebGPU, so the GPU path uses fp32.
      dtype: webgpu ? "fp32" : "q8",
      device: webgpu ? "webgpu" : "wasm",
    });
    captureTimings(tts);
    // The first generation compiles GPU shaders; doing it now keeps the first real sentence fast.
    await tts.generate("Ready.");
    post({ type: "ready", device: webgpu ? "webgpu" : "wasm" });
    return tts;
  } catch (error) {
    post({ type: "error", id: null, message: errorMessage(error) });
    throw error;
  }
}

/** kokoro-js keeps only the audio, so wrap the model to also keep the phoneme durations. */
function captureTimings(tts: KokoroTTS): void {
  const model = tts.model as unknown as Model;
  const timed: Model = async (inputs) => {
    const output = await model(inputs);
    lastRun = {
      ids: Array.from(inputs.input_ids.data, Number),
      frames: output.durations ? Array.from(output.durations.data, Number) : [],
    };
    return output;
  };
  (tts as unknown as { model: Model }).model = timed;
}

/** The timings the model wrapper stored during the last generation. */
function takeLastRun(): typeof lastRun {
  const run = lastRun;
  lastRun = null;
  return run;
}

function tokenText(tts: KokoroTTS, id: number): string {
  let text = tokenTexts.get(id);
  if (text === undefined) {
    text = tts.tokenizer.decode([id]);
    tokenTexts.set(id, text);
  }
  return text;
}

async function deleteOldModel(): Promise<void> {
  try {
    const cache = await caches.open("transformers-cache");
    for (const request of await cache.keys()) {
      if (request.url.includes(OLD_MODEL_PATH)) await cache.delete(request);
    }
  } catch {
    // Only frees disk space; nothing depends on it.
  }
}

async function speak(request: Extract<ReadAloudWorkerRequest, { type: "speak" }>): Promise<void> {
  if (request.epoch < epoch) return;
  const tts = await modelPromise;
  if (request.epoch < epoch) return;
  lastRun = null;
  const result = await tts.generate(request.text, {
    voice: (request.voice in tts.voices ? request.voice : "af_heart") as keyof typeof tts.voices,
    speed: request.speed,
  });
  if (request.epoch < epoch) return;
  const samples = result.audio;
  const seconds = samples.length / result.sampling_rate;
  const textWords = splitWords(request.text);
  const run = takeLastRun();
  const words =
    run === null || run.frames.length !== run.ids.length
      ? estimateWordTimes(textWords, seconds)
      : alignWordTimes(
          textWords,
          spokenWords(
            run.ids.map((id) => tokenText(tts, id)),
            run.frames,
            seconds,
          ),
          seconds,
        );
  post(
    {
      type: "audio",
      id: request.id,
      epoch: request.epoch,
      samples,
      sampleRate: result.sampling_rate,
      words,
    },
    [samples.buffer],
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

self.addEventListener("message", (event: MessageEvent<ReadAloudWorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    epoch = Math.max(epoch, request.epoch);
    return;
  }
  queue = queue
    .then(() => speak(request))
    .catch((error: unknown) =>
      post({ type: "error", id: request.id, message: errorMessage(error) }),
    );
});
