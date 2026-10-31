/// <reference lib="webworker" />
/**
 * Runs the Kokoro voice model off the main thread. Uses the GPU through WebGPU when the browser
 * offers it, otherwise a quantized model on the CPU. Requests run one at a time, in order.
 */
import { KokoroTTS, env } from "kokoro-js";
// onnxruntime-web defaults to loading its runtime from a CDN, which the desktop CSP blocks.
import ortWasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";

import type { ReadAloudWorkerRequest, ReadAloudWorkerResponse } from "./workerProtocol";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

(env as { wasmPaths: unknown }).wasmPaths = { wasm: ortWasmUrl };

declare const self: DedicatedWorkerGlobalScope;

let epoch = 0;
let queue: Promise<void> = Promise.resolve();
const modelPromise = loadModel();

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
    post({ type: "ready", device: webgpu ? "webgpu" : "wasm" });
    return tts;
  } catch (error) {
    post({ type: "error", message: errorMessage(error) });
    throw error;
  }
}

async function speak(request: Extract<ReadAloudWorkerRequest, { type: "speak" }>): Promise<void> {
  if (request.epoch < epoch) return;
  const tts = await modelPromise;
  if (request.epoch < epoch) return;
  const result = await tts.generate(request.text, {
    voice: (request.voice in tts.voices ? request.voice : "af_heart") as keyof typeof tts.voices,
  });
  if (request.epoch < epoch) return;
  const samples = result.audio;
  post(
    {
      type: "audio",
      id: request.id,
      epoch: request.epoch,
      samples,
      sampleRate: result.sampling_rate,
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
    .catch((error: unknown) => post({ type: "error", message: errorMessage(error) }));
});
