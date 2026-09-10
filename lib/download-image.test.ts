import { describe, expect, it } from "vitest";

import { encodeBmp } from "./download-image";

// jsdom/node test env lacks the global ImageData constructor; provide a shim.
class ShimImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = new Uint8ClampedArray(data);
    this.width = width;
    this.height = height;
  }
}

function makeImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return new (globalThis.ImageData ?? ShimImageData)(new Uint8ClampedArray(data), width, height) as ImageData;
}

describe("encodeBmp", () => {
  it("writes a valid BMP header with the right dimensions", async () => {
    // 2x2 RGBA, white with full alpha.
    const data = new Uint8ClampedArray([
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
    const blob = encodeBmp(makeImageData(data, 2, 2));
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    expect(blob.type).toBe("image/bmp");
    expect(new TextDecoder().decode(new Uint8Array(buffer, 0, 2))).toBe("BM");
    expect(view.getUint32(10, true)).toBe(54); // pixel offset
    expect(view.getUint32(14, true)).toBe(40); // DIB header size
    expect(view.getInt32(18, true)).toBe(2); // width
    expect(view.getInt32(22, true)).toBe(2); // height
    expect(view.getUint16(26, true)).toBe(1); // planes
    expect(view.getUint16(28, true)).toBe(32); // bpp
    expect(view.getUint32(30, true)).toBe(0); // BI_RGB
  });

  it("encodes pixels as BGRA and flips rows bottom-up", async () => {
    // 1x2 image: top pixel = opaque red (255,0,0,255), bottom pixel = green (0,255,0,255).
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const blob = encodeBmp(makeImageData(data, 1, 2));
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Pixel data begins at offset 54. Rows are stored bottom-up, so the FIRST
    // stored pixel is the BOTTOM source row = green (B=0, G=255, R=0).
    const offset = 54;
    expect(bytes[offset]).toBe(0); // B (green -> 0)
    expect(bytes[offset + 1]).toBe(255); // G
    expect(bytes[offset + 2]).toBe(0); // R
    expect(bytes[offset + 3]).toBe(255); // A

    // Second stored pixel is the TOP source row = red (B=0, G=0, R=255).
    expect(bytes[offset + 4]).toBe(0); // B
    expect(bytes[offset + 5]).toBe(0); // G
    expect(bytes[offset + 6]).toBe(255); // R
    expect(bytes[offset + 7]).toBe(255); // A
  });

  it("preserves alpha channel", async () => {
    // 1x2: top row alpha 200, bottom row alpha 100. Bottom-up => first stored is bottom.
    const data = new Uint8ClampedArray([10, 20, 30, 200, 40, 50, 60, 100]);
    const blob = encodeBmp(makeImageData(data, 1, 2));
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    expect(bytes[54 + 3]).toBe(100); // bottom row alpha
    expect(bytes[54 + 7]).toBe(200); // top row alpha
  });
});
