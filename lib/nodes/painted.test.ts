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
