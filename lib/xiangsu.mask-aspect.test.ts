import { describe, expect, it } from "vitest";

import { assertMaskAspectCompatible } from "@/lib/xiangsu";

describe("assertMaskAspectCompatible", () => {
  it("accepts identical dimensions", () => {
    expect(() => assertMaskAspectCompatible({ width: 1280, height: 960 }, { width: 1280, height: 960 })).not.toThrow();
  });

  it("accepts same aspect, different scale (the benign scaled-upload case)", () => {
    // 4:3 at two different resolutions — must NOT throw; we resample instead.
    expect(() => assertMaskAspectCompatible({ width: 1280, height: 960 }, { width: 320, height: 240 })).not.toThrow();
    expect(() => assertMaskAspectCompatible({ width: 320, height: 240 }, { width: 1280, height: 960 })).not.toThrow();
  });

  it("rejects a stale mask drawn on a different-aspect image", () => {
    // 4:3 base vs 1:1 mask — the mask was drawn on a different variant.
    expect(() =>
      assertMaskAspectCompatible({ width: 1280, height: 960 }, { width: 1024, height: 1024 }),
    ).toThrow(/doesn't match the source image/);
  });

  it("rejects a vertical-vs-horizontal flip", () => {
    expect(() =>
      assertMaskAspectCompatible({ width: 1280, height: 960 }, { width: 960, height: 1280 }),
    ).toThrow(/doesn't match the source image/);
  });

  it("tolerates tiny aspect differences below the epsilon (~0.1%)", () => {
    // 1280x960 (1.3333) vs 1280x961 (1.3319) — diff ~0.00138, over epsilon.
    // Use a much closer pair: 1280x960 vs 1281x961 — diff ~0.00013, well under 1e-3.
    expect(() => assertMaskAspectCompatible({ width: 1280, height: 960 }, { width: 1281, height: 961 })).not.toThrow();
  });

  it("is a no-op when either side has zero height", () => {
    expect(() => assertMaskAspectCompatible({ width: 0, height: 0 }, { width: 1280, height: 960 })).not.toThrow();
    expect(() => assertMaskAspectCompatible({ width: 1280, height: 960 }, { width: 0, height: 0 })).not.toThrow();
  });
});
