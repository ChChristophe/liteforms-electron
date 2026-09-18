/**
 * Ambient type declarations for "onnxruntime-web" v1.21.
 *
 * The package's `exports` map has no "types" condition, so TypeScript cannot
 * resolve its own `types.d.ts` (TS7016). We declare the minimal surface used
 * by this bundle. Remove this file once upstream ships exports-compatible
 * typings.
 */

declare module "onnxruntime-web" {
  export class Tensor {
    constructor(
      type: "float32" | "int32" | "int64" | (string & {}),
      data: ArrayLike<number> | Uint8Array,
      dims?: readonly number[],
    );
    readonly type: string;
    readonly data: ArrayLike<number>;
    readonly dims: readonly number[];
  }

  export type ExecutionProviderOption =
    | "wasm"
    | "webgl"
    | "webgpu"
    | string;

  export interface InferenceSessionRunOptions {
    executionProviders?: readonly ExecutionProviderOption[];
    graphOptimizationLevel?: string;
  }

  export interface InferenceSession {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    run(
      feeds: Record<string, Tensor>,
      options?: Record<string, unknown>,
    ): Promise<Record<string, Tensor>>;
    release?(): Promise<void>;
  }

  export interface InferenceSessionStatic {
    create(
      uri: string | URL | Uint8Array | ArrayBuffer,
      options?: InferenceSessionRunOptions,
    ): Promise<InferenceSession>;
  }

  export const InferenceSession: InferenceSessionStatic;
  export const env: {
    wasm: {
      wasmPaths?: string;
      numThreads?: number;
      simd?: boolean;
      proxy?: boolean;
    };
  };
}

declare module "onnxruntime-web/wasm" {
  export * from "onnxruntime-web";
}
