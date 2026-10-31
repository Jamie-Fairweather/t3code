export type ReadAloudWorkerRequest =
  | {
      readonly type: "speak";
      readonly id: number;
      readonly epoch: number;
      readonly text: string;
      readonly voice: string;
      readonly speed: number;
    }
  /** Drops queued and in-flight requests older than `epoch`. */
  | { readonly type: "cancel"; readonly epoch: number };

export type ReadAloudWorkerResponse =
  | { readonly type: "ready"; readonly device: "webgpu" | "wasm" }
  | {
      readonly type: "audio";
      readonly id: number;
      readonly epoch: number;
      readonly samples: Float32Array;
      readonly sampleRate: number;
    }
  /** `id` is the failed request, or null when the model itself failed to load. */
  | { readonly type: "error"; readonly id: number | null; readonly message: string };
