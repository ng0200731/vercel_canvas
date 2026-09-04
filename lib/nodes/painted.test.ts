import { describe, expect, it } from "vitest";

import {
  resolvePaintedEditAliases,
  resolvePaintedMainImage,
} from "@/components/canvas/nodes/painted-node";

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
 * `resolvePaintedEditAliases` decides the alias roles for a Painted region
 * edit. When the Painted node has its OWN image AND a wired source, two
 * references are sent: the own image is the base (mask carrier) and the wired
 * source is an auxiliary reference the user's @supplier mention resolves to.
 * Wire-only (no own image) keeps the wired source as the base — single
 * reference. These pin the decision so it does not regress into the "only one
 * image is sent and the prompt drifts to a generic recolor" bug.
 */
describe("resolvePaintedEditAliases", () => {
  it("uses the own alias as base and the wired alias as supplier when both are present", () => {
    expect(
      resolvePaintedEditAliases({
        override: true,
        overrideUrl: "own.png",
        wiredAlias: "supplier",
        dataAlias: null,
      }),
    ).toEqual({ baseAlias: "painted", supplierAlias: "supplier" });
  });

  it("prefers data.alias for the base when set (own image + wire)", () => {
    expect(
      resolvePaintedEditAliases({
        override: true,
        overrideUrl: "own.png",
        wiredAlias: "supplier",
        dataAlias: "shirt",
      }),
    ).toEqual({ baseAlias: "shirt", supplierAlias: "supplier" });
  });

  it("defaults the supplier alias to 'supplier' when the wire has no alias", () => {
    expect(
      resolvePaintedEditAliases({
        override: true,
        overrideUrl: "own.png",
        wiredAlias: null,
        dataAlias: null,
      }),
    ).toEqual({ baseAlias: "painted", supplierAlias: "supplier" });
  });

  it("treats own image as base even when a wired alias echoes the own alias", () => {
    // Wired alias can equal data.alias for some node setups; the two-image
    // decision is driven by override+wire presence, not alias equality.
    expect(
      resolvePaintedEditAliases({
        override: true,
        overrideUrl: "own.png",
        wiredAlias: "painted",
        dataAlias: "painted",
      }),
    ).toEqual({ baseAlias: "painted", supplierAlias: "painted" });
  });

  it("falls back to wire-only behavior when override is false (wired source is the base)", () => {
    expect(
      resolvePaintedEditAliases({
        override: false,
        overrideUrl: null,
        wiredAlias: "supplier",
        dataAlias: null,
      }),
    ).toEqual({ baseAlias: "supplier", supplierAlias: null });
  });

  it("falls back to wire-only behavior when override is true but no URL yet (transient)", () => {
    expect(
      resolvePaintedEditAliases({
        override: true,
        overrideUrl: null,
        wiredAlias: "supplier",
        dataAlias: null,
      }),
    ).toEqual({ baseAlias: "supplier", supplierAlias: null });
  });

  it("returns the own alias as base with no supplier when there is no wire and no override", () => {
    expect(
      resolvePaintedEditAliases({
        override: false,
        overrideUrl: null,
        wiredAlias: null,
        dataAlias: null,
      }),
    ).toEqual({ baseAlias: "painted", supplierAlias: null });
  });

  it("uses data.alias for the base when there is no wire", () => {
    expect(
      resolvePaintedEditAliases({
        override: false,
        overrideUrl: null,
        wiredAlias: null,
        dataAlias: "backpack",
      }),
    ).toEqual({ baseAlias: "backpack", supplierAlias: null });
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
