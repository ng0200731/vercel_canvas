import "server-only";

import type SharpImport from "sharp";

export type Sharp = typeof SharpImport;

let sharpPromise: Promise<Sharp> | null = null;

/**
 * Load sharp only when an image-processing operation is actually needed.
 * Basic image generation does not use sharp, so keeping this import lazy lets
 * the generation route start even if a platform-native binary is unavailable.
 */
export function loadSharp(): Promise<Sharp> {
  if (!sharpPromise) {
    sharpPromise = import("sharp").then(
      (module) => module.default,
      (error: unknown) => {
        sharpPromise = null;
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Image processing (sharp) is unavailable: ${detail}`);
      },
    );
  }
  return sharpPromise;
}
