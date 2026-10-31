export type ReadAloudWorkerRequest =
  | {
      readonly type: "speak";
      readonly id: number;
      readonly epoch: number;
      readonly text: string;
      readonly voice: string;
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
  | { readonly type: "error"; readonly message: string };
