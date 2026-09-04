import { describe, expect, it } from "vitest";

import { compileReferencePrompt } from "@/lib/reference-prompt";

describe("reference prompt compiler", () => {
  it("orders provider images by @mention order and maps aliases explicitly", () => {
    const compiled = compileReferencePrompt("change @sweater texture to @vintage", [
      { kind: "image", alias: "vintage", url: "https://images.example/vintage.png" },
      { kind: "image", alias: "sweater", url: "https://images.example/sweater.png" },
    ]);

    expect(compiled.imageUrls).toEqual([
      "https://images.example/sweater.png",
      "https://images.example/vintage.png",
    ]);
    expect(compiled.prompt).toContain("Provider image 1 is @sweater");
    expect(compiled.prompt).toContain("Provider image 2 is @vintage");
  });

  it("adds a strict texture-transfer constraint", () => {
    const compiled = compileReferencePrompt("change @sweater texture to @vintage", [
      { kind: "image", alias: "sweater", url: "https://images.example/sweater.png" },
      { kind: "image", alias: "vintage", url: "https://images.example/vintage.png" },
    ]);

    expect(compiled.prompt).toContain("Use @sweater as the target/base image");
    expect(compiled.prompt).toContain("Use @vintage only as the source of texture");
    expect(compiled.prompt).toContain("Do not copy people, faces, bodies, poses");
  });

  it("keeps unmentioned references after mentioned references", () => {
    const compiled = compileReferencePrompt("edit @product", [
      { kind: "image", alias: "extra", url: "https://images.example/extra.png" },
      { kind: "image", alias: "product", url: "https://images.example/product.png" },
    ]);

    expect(compiled.imageUrls).toEqual([
      "https://images.example/product.png",
      "https://images.example/extra.png",
    ]);
  });

  it("leaves prompt-only generation unchanged", () => {
    expect(compileReferencePrompt("a red circle", [])).toEqual({
      prompt: "a red circle",
      imageUrls: [],
    });
  });

  it("turns Pantone aliases into ordered swatch image references", () => {
    const compiled = compileReferencePrompt("change @bre color to @Red 032 U", [
      { kind: "pantone", alias: "Red 032 U", label: "Red 032 U", hex: "#f65058" },
      { kind: "image", alias: "bre", url: "https://images.example/bre.png" },
    ]);

    expect(compiled.imageUrls[0]).toBe("https://images.example/bre.png");
    expect(compiled.imageUrls[1]).toMatch(/^data:image\/png;base64/);
    expect(compiled.prompt).toContain("Provider image 1 is @bre");
    expect(compiled.prompt).toContain("Provider image 2 is @Red 032 U");
    expect(compiled.prompt).toContain("solid Pantone color reference for Red 032 U (#F65058)");
    expect(compiled.prompt).toContain("Provider image 1 / @bre is the target/base image");
    expect(compiled.prompt).toContain("Provider image 2 / @Red 032 U is only a color reference");
    expect(compiled.prompt).toContain("Preserve every detail from @bre");
  });

  it("describes the union-mask convention when a mask is attached", () => {
    const compiled = compileReferencePrompt(
      [
        "- @product use collar region change texture to @elastic",
        "- @product use sleeve region change texture to @elastic",
        "- @product use logo region change texture to @elastic",
      ].join("\n"),
      [
        {
          kind: "image",
          alias: "product",
          url: "https://images.example/product.png",
          maskUrl: "https://images.example/combined-product.png",
        },
        { kind: "image", alias: "elastic", url: "https://images.example/elastic.png" },
      ],
    );

    expect(compiled.maskUrl).toBe("https://images.example/combined-product.png");
    expect(compiled.prompt).toContain("MASK GUIDANCE (the attached mask marks the exact edit region)");
    // With a mask attached, the @elastic image is STILL attached as image[1] so
    // the model has real source pixels to paste — it's no longer dropped to a
    // textual-only cue.
    expect(compiled.imageUrls).toEqual([
      "https://images.example/product.png",
      "https://images.example/elastic.png",
    ]);
    // The mask guidance names image[2] / @elastic as the source to place inside
    // the transparent region.
    expect(compiled.prompt).toContain(
      "Provider image 2 / @elastic: this is the SOURCE to place INTO the transparent region of @product.",
    );
    // The old "treat as a textual material/style cue … Do not require an actual
    // image" line is gone now that the image is attached.
    expect(compiled.prompt).not.toContain("Do not require an actual image of @elastic");
    // The stroke is a literal selection, not a hint to recolor a larger object.
    // The model must NOT expand the edit to neighbouring regions or "the whole
    // strap" — only the mask pixels change.
    expect(compiled.prompt).toContain(
      "The user's stroke is a literal selection, not a hint to recolor a larger object",
    );
    expect(compiled.prompt).toContain(
      "Do NOT expand the edit to neighbouring regions",
    );
  });

  it("does not emit a paste-source line when the only other ref is a Pantone swatch (pure recolor)", () => {
    const compiled = compileReferencePrompt(
      "- @product use collar region change color to @Red 032 U",
      [
        {
          kind: "image",
          alias: "product",
          url: "https://images.example/product.png",
          maskUrl: "https://images.example/combined-product.png",
        },
        { kind: "pantone", alias: "Red 032 U", label: "Red 032 U", hex: "#f65058" },
      ],
    );

    expect(compiled.imageUrls).toEqual([
      "https://images.example/product.png",
      expect.stringMatching(/^data:image\/png;base64/),
    ]);
    // No "SOURCE to place INTO" line — there's no second attached image to
    // paste; this is a color-only edit.
    expect(compiled.prompt).not.toContain("this is the SOURCE to place INTO");
    // Mask guidance still fires.
    expect(compiled.prompt).toContain("MASK GUIDANCE");
  });

  it("emits the object/material constraint when the prompt mentions 'object' and a second image", () => {
    const compiled = compileReferencePrompt(
      "- @product use 3 region change object to @elastic",
      [
        {
          kind: "image",
          alias: "product",
          url: "https://images.example/product.png",
          maskUrl: "https://images.example/3-mask.png",
        },
        { kind: "image", alias: "elastic", url: "https://images.example/elastic.png" },
      ],
    );

    expect(compiled.prompt).toContain("Object/material-transfer constraint:");
    expect(compiled.prompt).toContain("Use @product as the target/base image");
    expect(compiled.prompt).toContain("Use @elastic only as the source of the new object");
    expect(compiled.prompt).toContain("Preserve @product's overall silhouette");
    // The @elastic image is attached (image[1]) even with a mask, so the
    // "provided by name only (no attached image)" caveat must NOT appear.
    expect(compiled.prompt).not.toContain("provided by name only (no attached image)");
    expect(compiled.imageUrls).toEqual([
      "https://images.example/product.png",
      "https://images.example/elastic.png",
    ]);
  });

  // Painted node two-image shape: the painted node's OWN image is the base
  // (alias "painted", carries the mask) and the wired supplier is an auxiliary
  // reference (alias "supplier") the "@supplier" mention resolves to. This is
  // the call shape the Painted edit produces when both an override and a wire
  // are present — it must send two images and paste the supplier into the mask.
  it("pastes the supplier into the painted base region (two-image painted shape)", () => {
    const compiled = compileReferencePrompt(
      "@painted: change region-1 color to @supplier (apply to region-1)",
      [
        {
          kind: "image",
          alias: "painted",
          url: "https://images.example/painted.png",
          maskUrl: "https://images.example/painted-mask.png",
        },
        { kind: "image", alias: "supplier", url: "https://images.example/supplier.png" },
      ],
    );

    // Two images are attached: base+mask (image[0]) and supplier (image[1]).
    expect(compiled.imageUrls).toEqual([
      "https://images.example/painted.png",
      "https://images.example/supplier.png",
    ]);
    expect(compiled.maskUrl).toBe("https://images.example/painted-mask.png");
    // The base (mask carrier) is ordered first regardless of array order.
    expect(compiled.prompt).toContain("Provider image 1 is @painted");
    expect(compiled.prompt).toContain("Provider image 2 is @supplier");
    // The object/material constraint fires because "region" is mentioned and
    // both @painted and @supplier are referenced. target = base, source = the
    // thing being pasted from.
    expect(compiled.prompt).toContain("Object/material-transfer constraint:");
    expect(compiled.prompt).toContain("Use @painted as the target/base image");
    expect(compiled.prompt).toContain("Use @supplier only as the source of the new object");
    // The colour-transfer constraint also fires ("color" keyword + two refs).
    expect(compiled.prompt).toContain("Color-transfer constraint:");
    expect(compiled.prompt).toContain("Provider image 2 / @supplier is only a color reference");
    // Paste-source guidance names the supplier as the SOURCE into the base mask.
    expect(compiled.prompt).toContain(
      "Provider image 2 / @supplier: this is the SOURCE to place INTO the transparent region of @painted",
    );
    expect(compiled.prompt).toContain("MASK GUIDANCE");
  });
});
