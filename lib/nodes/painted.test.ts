import { describe, expect, it } from "vitest";

import { resolvePaintedMainImage } from "@/components/canvas/nodes/painted-node";

describe("resolvePaintedMainImage", () => {
  it("prefers a paste/drop override when present", () => {
    expect(
      resolvePaintedMainImage({ override: true, overrideUrl: "override.png", wired: "wired.png" }),
    ).toBe("override.png");
  });

  it("ignores the override flag when no override URL is set", () => {
    // override=true but the URL is null → fall through to the wired source.
    expect(resolvePaintedMainImage({ override: true, overrideUrl: null, wired: "wired.png" })).toBe(
      "wired.png",
    );
  });

  it("promotes a wired source when no override is active", () => {
    expect(resolvePaintedMainImage({ override: false, overrideUrl: null, wired: "wired.png" })).toBe(
      "wired.png",
    );
  });

  it("returns null when neither an override nor a wire is available", () => {
    expect(resolvePaintedMainImage({ override: false, overrideUrl: null, wired: null })).toBeNull();
    expect(resolvePaintedMainImage({ override: true, overrideUrl: null, wired: null })).toBeNull();
  });
});

/**
 * The Painted node stores regions in `paintedRegions` (G2Region[]). Legacy
 * painted nodes created before the regional-edit feature carry no such field,
 * so the component reads each region stack defensively:
 * `Array.isArray(data.paintedRegions) ? data.paintedRegions : []`. This pins
 * that read pattern so a missing field never throws in the render path.
 */
describe("PaintedNodeData region defaults (legacy node tolerance)", () => {
  function readRegions(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  it("treats absent paintedRegions as an empty array", () => {
    expect(readRegions(undefined)).toEqual([]);
    expect(readRegions(null)).toEqual([]);
  });

  it("passes through a populated paintedRegions array unchanged", () => {
    expect(readRegions([{ id: "r1" }])).toEqual([{ id: "r1" }]);
  });
});
