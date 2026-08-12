import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { compositeOutsideBbox, maskBbox, dilateAlpha, alphaMapBbox, alphaMapFromBuffer, compositeAlphaShape, composeMaterialSwatch } from "@/lib/mask-composite";

/** Build an RGBA PNG buffer of size wxh with a transparent rectangular region. */
async function makeMaskPng(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
    raw[i * 4 + 0] = 255;
    raw[i * 4 + 1] = 255;
    raw[i * 4 + 2] = 255;
    raw[i * 4 + 3] = inside ? 0 : 255;
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** Build a solid-color RGBA PNG. */
async function makeSolidPng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    raw[i * 4 + 0] = r;
    raw[i * 4 + 1] = g;
    raw[i * 4 + 2] = b;
    raw[i * 4 + 3] = 255;
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe("maskBbox", () => {
  it("returns the bounding box of the transparent region", async () => {
    const mask = await makeMaskPng(20, 30, { x: 5, y: 8, w: 6, h: 10 });
    const bbox = await maskBbox(mask, 20, 30);
    expect(bbox).toEqual({
      sourceWidth: 20,
      sourceHeight: 30,
      minX: 5,
      minY: 8,
      maxX: 10,
      maxY: 17,
      width: 6,
      height: 10,
    });
  });

  it("returns null when the mask has no transparent region", async () => {
    const raw = Buffer.alloc(10 * 10 * 4);
    for (let i = 0; i < 10 * 10; i += 1) raw[i * 4 + 3] = 255;
    const mask = await sharp(raw, { raw: { width: 10, height: 10, channels: 4 } }).png().toBuffer();
    const bbox = await maskBbox(mask, 10, 10);
    expect(bbox).toBeNull();
  });
});

describe("compositeOutsideBbox", () => {
  it("keeps base pixels outside the bbox and takes edited pixels inside", async () => {
    const base = await makeSolidPng(20, 20, 0, 0, 0); // black
    const edited = await makeSolidPng(20, 20, 255, 255, 255); // white
    const bbox = {
      sourceWidth: 20,
      sourceHeight: 20,
      minX: 5,
      minY: 5,
      maxX: 14,
      maxY: 14,
      width: 10,
      height: 10,
    };
    const out = await compositeOutsideBbox(base, edited, bbox, 0);

    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    // Pixel at (0, 0) — outside bbox, should be base (black).
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    // Pixel at (10, 10) — inside bbox, should be edited (white).
    const idx = (10 * 20 + 10) * 4;
    expect(data[idx]).toBe(255);
    expect(data[idx + 1]).toBe(255);
    expect(data[idx + 2]).toBe(255);
  });

  it("feathers the boundary when feather > 0", async () => {
    const base = await makeSolidPng(20, 20, 0, 0, 0);
    const edited = await makeSolidPng(20, 20, 255, 255, 255);
    const bbox = {
      sourceWidth: 20,
      sourceHeight: 20,
      minX: 5,
      minY: 5,
      maxX: 14,
      maxY: 14,
      width: 10,
      height: 10,
    };
    const out = await compositeOutsideBbox(base, edited, bbox, 3);
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    // Pixel one step inside the bbox boundary — within feather band, should be partially blended.
    const idx = (6 * 20 + 6) * 4;
    const r = data[idx];
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(255);
    // Pixel at center of bbox — outside feather band, should be fully edited.
    const centerIdx = (10 * 20 + 10) * 4;
    expect(data[centerIdx]).toBe(255);
  });

  it("scales bbox coordinates when base size differs from mask source size", async () => {
    // Base is 40x40 (2x the mask's 20x20 source). Bbox covers (5,5)-(14,14) in
    // mask space → should be (10,10)-(28,28) in base space.
    const base = await makeSolidPng(40, 40, 0, 0, 0);
    const edited = await makeSolidPng(40, 40, 255, 255, 255);
    const bbox = {
      sourceWidth: 20,
      sourceHeight: 20,
      minX: 5,
      minY: 5,
      maxX: 14,
      maxY: 14,
      width: 10,
      height: 10,
    };
    const out = await compositeOutsideBbox(base, edited, bbox, 0);
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    // (5,5) in base space — outside scaled bbox (scaled bbox is 10..28), expect base.
    const outsideIdx = (5 * 40 + 5) * 4;
    expect(data[outsideIdx]).toBe(0);
    // (20,20) in base space — inside scaled bbox, expect edited.
    const insideIdx = (20 * 40 + 20) * 4;
    expect(data[insideIdx]).toBe(255);
  });
});

/**
 * Build an RGBA PNG with a transparent *cross* (plus-sign) editable region,
 * so the shape is clearly NOT a rectangle — its bounding box would cover a
 * large square while the actual transparent area is only two thin strokes.
 */
async function makeCrossMaskPng(
  width: number,
  height: number,
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 4);
  const arm = 2;
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  for (let i = 0; i < width * height; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    const inVertical = x >= cx - arm && x <= cx + arm;
    const inHorizontal = y >= cy - arm && y <= cy + arm;
    const editable = inVertical || inHorizontal;
    raw[i * 4 + 0] = 255;
    raw[i * 4 + 1] = 255;
    raw[i * 4 + 2] = 255;
    raw[i * 4 + 3] = editable ? 0 : 255;
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe("dilateAlpha", () => {
  it("grows a single editable pixel into a small square", () => {
    const width = 11;
    const height = 11;
    const alpha = Buffer.alloc(width * height).fill(255);
    alpha[5 * width + 5] = 0; // one editable pixel at center
    const out = dilateAlpha(alpha, width, height, 2);
    // Center plus the 2-pixel ring around it should be editable.
    expect(out[5 * width + 5]).toBe(0);
    expect(out[3 * width + 5]).toBe(0); // up 2
    expect(out[7 * width + 5]).toBe(0); // down 2
    expect(out[5 * width + 3]).toBe(0); // left 2
    expect(out[5 * width + 7]).toBe(0); // right 2
    // Corner at distance 3 diagonally stays preserved.
    expect(out[2 * width + 2]).toBe(255);
  });

  it("no-op when radius is 0", () => {
    const alpha = Buffer.alloc(9).fill(255);
    alpha[4] = 0;
    const out = dilateAlpha(alpha, 3, 3, 0);
    expect(out).toBe(alpha);
  });
});

describe("alphaMapBbox + compositeAlphaShape (follow mask shape, not bbox)", () => {
  it("alphaMapBbox reports the cross bbox but composite keeps the cross shape", async () => {
    const width = 30;
    const height = 30;
    const mask = await makeCrossMaskPng(width, height);
    const map = await alphaMapFromBuffer(mask, width, height);

    // The cross's bounding box is the full 30x30 square (arms reach the
    // center of each edge), but the actual editable pixels form a plus sign.
    const bbox = alphaMapBbox(map);
    expect(bbox).not.toBeNull();
    expect(bbox!.width).toBe(width);
    expect(bbox!.height).toBe(height);

    // Composite: black base, white edited, no feather, no dilate. The result
    // should be white ONLY along the cross arms and black in the four bbox
    // corners that a rectangle composite would have wrongly filled.
    const base = await makeSolidPng(width, height, 0, 0, 0);
    const edited = await makeSolidPng(width, height, 255, 255, 255);
    const out = await compositeAlphaShape(base, edited, mask, { feather: 0, dilate: 0 });
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });

    // A corner of the cross bounding box (top-left) is preserved (black) — a
    // bbox rectangle would have made it white.
    const cornerIdx = (1 * width + 1) * 4;
    expect(data[cornerIdx]).toBe(0);
    // Center of the cross is editable (white).
    const centerIdx = (15 * width + 15) * 4;
    expect(data[centerIdx]).toBe(255);
    // A mid-edge pixel on the vertical arm is editable (white).
    const armIdx = (8 * width + 15) * 4;
    expect(data[armIdx]).toBe(255);
  });

  it("dilate grows the cross to cover a band, then composite fills the band", async () => {
    const width = 30;
    const height = 30;
    const mask = await makeCrossMaskPng(width, height);
    const base = await makeSolidPng(width, height, 0, 0, 0);
    const edited = await makeSolidPng(width, height, 255, 255, 255);

    const out = await compositeAlphaShape(base, edited, mask, { feather: 0, dilate: 4 });
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });

    // After a 4px dilation the cross grows into a plus-shaped band. A pixel
    // ~3px off the vertical arm (still inside the bounding square) should now
    // be white, but a far corner must stay black.
    const nearArmIdx = (15 * width + 11) * 4; // 4px left of center, within arm+dilate
    expect(data[nearArmIdx]).toBe(255);
    const farCornerIdx = (2 * width + 2) * 4;
    expect(data[farCornerIdx]).toBe(0);
  });
});

describe("mask alpha resampler (regression for thin-stroke vanished/smeared)", () => {
  // These tests guard against regressing to the default bilinear resampler
  // for the mask's alpha channel. The mask's alpha is binary 0/255 on the
  // client (lib/mask-union.ts). Bilinear would smear the boundary into
  // mid-range values, which downstream `< ALPHA_THRESHOLD (128)` would
  // either drop entirely (thin 1px strokes) or bloat into a fat band.

  it("alphaMapFromBuffer keeps a binary stroke intact when downscaled", async () => {
    // 200x200 mask with a 4px-wide transparent vertical band at x=98..101.
    // Downscaled 4x to 50x50, a 4px-wide band in the source is GUARANTEED to
    // cover at least one target column fully (nearest picks source pixels
    // by target center). With NEAREST, alpha values must be only near 0 or
    // near 255 — never mid-range (e.g. 64, 107, 198, 238) which would
    // indicate bilinear smear.
    const w = 200;
    const h = 200;
    const raw = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      const x = i % w;
      const transparent = x >= 98 && x <= 101;
      raw[i * 4 + 0] = 255;
      raw[i * 4 + 1] = 255;
      raw[i * 4 + 2] = 255;
      raw[i * 4 + 3] = transparent ? 0 : 255;
    }
    const mask = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();

    const map = await alphaMapFromBuffer(mask, 50, 50);
    const values = Array.from(map.alpha);
    const distinct = new Set(values);
    expect(distinct.has(0)).toBe(true); // editable band survives
    expect(distinct.has(255)).toBe(true); // keep band survives
    for (const v of values) {
      const isBinary = v < 5 || v > 250;
      if (!isBinary) {
        throw new Error(
          `Expected binary alpha (near 0 or near 255); got mid-range value ${v}. ` +
            `This indicates the bilinear resampler was used instead of nearest.`,
        );
      }
    }
  });

  it("compositeAlphaShape keeps a 1px-thin stroke editable with dilate: 0", async () => {
    // 1px-thin cross — narrower than the existing makeCrossMaskPng (arm=2).
    // Without nearest resampling, the thin arms would smear into keep and the
    // composite would not show the cross shape. With nearest, the arms
    // remain editable and the composite follows the shape.
    const width = 30;
    const height = 30;
    const raw = Buffer.alloc(width * height * 4);
    const arm = 1;
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    for (let i = 0; i < width * height; i += 1) {
      const x = i % width;
      const y = Math.floor(i / width);
      const inVertical = x >= cx - arm && x <= cx + arm;
      const inHorizontal = y >= cy - arm && y <= cy + arm;
      const editable = inVertical || inHorizontal;
      raw[i * 4 + 0] = 255;
      raw[i * 4 + 1] = 255;
      raw[i * 4 + 2] = 255;
      raw[i * 4 + 3] = editable ? 0 : 255;
    }
    const mask = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();

    const base = await makeSolidPng(width, height, 0, 0, 0);
    const edited = await makeSolidPng(width, height, 255, 255, 255);
    const out = await compositeAlphaShape(base, edited, mask, { feather: 0, dilate: 0 });
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });

    // Center of the cross is editable (white).
    const centerIdx = (15 * width + 15) * 4;
    expect(data[centerIdx]).toBe(255);
    // A pixel on the vertical arm (1px off-center) is editable (white).
    const armIdx = (10 * width + 15) * 4;
    expect(data[armIdx]).toBe(255);
    // A corner (outside the cross arms) stays preserved (black).
    const cornerIdx = (1 * width + 1) * 4;
    expect(data[cornerIdx]).toBe(0);
  });
});

describe("alphaMapFromBuffer (skip redundant resize on same-size input)", () => {
  // Guard for the fast path: when the mask's metadata dims already match the
  // requested (width, height), alphaMapFromBuffer should skip the resize and
  // still produce the same binary alpha. Both the skip-resize and the
  // resize-with-nearest branches must agree on a same-size input, and the
  // result must remain binary (no bilinear smear).
  it("returns binary alpha when mask is already at target dims (no resize)", async () => {
    const width = 24;
    const height = 24;
    const raw = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      const x = i % width;
      const y = Math.floor(i / width);
      const editable = x >= 8 && x <= 15 && y >= 8 && y <= 15; // 8x8 transparent square
      raw[i * 4 + 0] = 255;
      raw[i * 4 + 1] = 255;
      raw[i * 4 + 2] = 255;
      raw[i * 4 + 3] = editable ? 0 : 255;
    }
    const mask = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();

    const map = await alphaMapFromBuffer(mask, width, height);
    expect(map.width).toBe(width);
    expect(map.height).toBe(height);
    expect(map.alpha.length).toBe(width * height);

    const distinct = new Set(Array.from(map.alpha));
    // Binary values only — no mid-range smear.
    for (const v of map.alpha) {
      expect(v === 0 || v === 255).toBe(true);
    }
    // Editable square survives.
    let editableCount = 0;
    for (let y = 8; y <= 15; y += 1) {
      for (let x = 8; x <= 15; x += 1) {
        if (map.alpha[y * width + x] === 0) editableCount += 1;
      }
    }
    expect(editableCount).toBe(8 * 8);
    expect(distinct.has(0)).toBe(true);
    expect(distinct.has(255)).toBe(true);
  });
});

describe("compositeAlphaShape preserves mask region across same-aspect rescales", () => {
  // Regression for "edit lands in the wrong spot": when the base image and the
  // mask share an aspect but differ in pixel count, the provider-aligned grid is
  // the MASK's grid. compositeAlphaShape resamples the mask (kernel: nearest)
  // to the base's metadata dims; same-aspect → near-1:1 → the transparent
  // rectangle must map to the same RELATIVE position, not drift toward center
  // as a fit:"fill" aspect deformation would.

  it("keeps the transparent rectangle in the same relative spot after a same-aspect rescale", async () => {
    // Mask: 60x40 (3:2). Transparent rectangle at top-left: x[4..11], y[2..7].
    const maskW = 60;
    const maskH = 40;
    const rect = { x: 4, y: 2, w: 8, h: 6 };
    const mask = await makeMaskPng(maskW, maskH, rect);

    // Base + edited at a DIFFERENT same-aspect size (120x80). compositeAlphaShape
    // derives width/height from the base's metadata (120x80) and resamples the
    // mask (60x40) up to 120x80 with kernel: nearest — a 2x uniform scale.
    const baseW = 120;
    const baseH = 80;
    const base = await makeSolidPng(baseW, baseH, 0, 0, 0);
    const edited = await makeSolidPng(baseW, baseH, 255, 255, 255);

    const out = await compositeAlphaShape(base, edited, mask, { feather: 0, dilate: 0 });
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });

    // After a 2x scale the transparent rectangle maps to x[8..23], y[4..15].
    // A pixel inside that scaled rectangle must be edited (white).
    const insideIdx = (10 * baseW + 16) * 4;
    expect(data[insideIdx]).toBe(255);
    expect(data[insideIdx + 1]).toBe(255);
    expect(data[insideIdx + 2]).toBe(255);

    // A pixel OUTSIDE the rectangle (top-left corner of the image, well clear of
    // the mask) must stay base (black).
    const outsideIdx = (1 * baseW + 1) * 4;
    expect(data[outsideIdx]).toBe(0);
    expect(data[outsideIdx + 1]).toBe(0);
    expect(data[outsideIdx + 2]).toBe(0);

    // The opposite corner — far from the top-left mask — must also stay base.
    const farIdx = ((baseH - 2) * baseW + (baseW - 2)) * 4;
    expect(data[farIdx]).toBe(0);
  });
});

