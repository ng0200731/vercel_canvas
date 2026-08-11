import { describe, expect, it } from "vitest";

import type { GeneratePromptSourceReference } from "@/lib/generate-prompt";
import {
  resolveMaskAttachmentByAlias,
  selectedMaskUrlsForReferences,
} from "@/lib/generate-node-mask-resolver";

const productSource: GeneratePromptSourceReference = {
  nodeId: "product-node",
  alias: "product",
  masks: [
    { id: "mask-34-id", name: "34", maskUrl: "https://cdn.example/34.png" },
    { id: "mask-collar-id", name: "collar", maskUrl: "https://cdn.example/collar.png" },
  ],
};

describe("selectedMaskUrlsForReferences", () => {
  it("auto-attaches a mask when its name is mentioned alongside the @alias in the prompt", () => {
    const map = selectedMaskUrlsForReferences({
      prompt: "@product use the 34 mask to place the @logo inside it",
      references: [productSource],
    });
    expect(map.get("product-node")).toBe("https://cdn.example/34.png");
  });

  it("prefers an explicit row maskId over the freeform alias scan", () => {
    const map = selectedMaskUrlsForReferences({
      prompt: "@product use the collar mask",
      references: [productSource],
      // Explicit row says "use mask 34" even though the prompt mentions "collar".
      rowSelections: [{ sourceNodeId: "product-node", maskId: "mask-34-id" }],
    });
    expect(map.get("product-node")).toBe("https://cdn.example/34.png");
  });

  it("ignores a mask mention when its source @alias is absent from the prompt", () => {
    const map = selectedMaskUrlsForReferences({
      prompt: "place the 34 mask on the bag",
      references: [productSource],
    });
    expect(map.has("product-node")).toBe(false);
  });

  it("skips masks without a saved maskUrl even when the name appears", () => {
    const noUrlSource: GeneratePromptSourceReference = {
      ...productSource,
      masks: [{ id: "mask-34-id", name: "34" }],
    };
    const map = selectedMaskUrlsForReferences({
      prompt: "@product use the 34 mask",
      references: [noUrlSource],
    });
    expect(map.has("product-node")).toBe(false);
  });

  it("ignores null/undefined/non-object row selections instead of throwing", () => {
    // The Generate node maps persisted rows to { sourceNodeId, maskId }; a
    // malformed persisted row (null, undefined, missing fields) must not crash
    // the resolver with "Cannot read properties of undefined (reading 'sourceNodeId')".
    const map = selectedMaskUrlsForReferences({
      prompt: "@product use the 34 mask",
      references: [productSource],
      // @ts-expect-error intentional malformed input from a bad persisted row
      rowSelections: [null, undefined, { maskId: "mask-34-id" }, "nope", { sourceNodeId: "product-node", maskId: "mask-34-id" }],
    });
    // The one well-formed selection still resolves; the rest are skipped.
    expect(map.get("product-node")).toBe("https://cdn.example/34.png");
  });
});

describe("resolveMaskAttachmentByAlias", () => {
  it("returns the mask URL when the alias and mask name co-occur in the prompt", () => {
    const url = resolveMaskAttachmentByAlias({
      prompt: "@product use the 34 mask to add @logo",
      source: productSource,
    });
    expect(url).toBe("https://cdn.example/34.png");
  });

  it("returns undefined when the source alias is missing from the prompt", () => {
    const url = resolveMaskAttachmentByAlias({
      prompt: "use the 34 mask",
      source: productSource,
    });
    expect(url).toBeUndefined();
  });
});
