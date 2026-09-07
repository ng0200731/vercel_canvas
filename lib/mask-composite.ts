import "server-only";

import { loadSharp } from "@/lib/sharp";

export interface MaskBbox {
  /** Bbox coordinate space (the mask PNG's native size). */
  sourceWidth: number;
  sourceHeight: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Compute the bounding box of the transparent (alpha < 128) region of a mask.
 * Returns null if the mask has no transparent region.
 *
 * Mask convention (same as OpenAI images.edit):
 *   alpha = 0   → pixel is in the edit region
 *   alpha = 255 → pixel is preserved
 */
export async function maskBbox(
  maskBuffer: Buffer,
  width: number,
  height: number,
): Promise<MaskBbox | null> {
  const sharp = await loadSharp();
  // ensureAlpha() before resize so the alpha plane being resampled is the
  // real mask channel 3. kernel: "nearest" preserves the binary 0/255
  // boundary — bilinear would smear it into mid-range values that the
  // < 128 threshold below could either miss or bloat.
  const maskAlpha = await sharp(maskBuffer)
    .ensureAlpha()
    .resize(width, height, { fit: "fill", kernel: "nearest" })
    .extractChannel(3)
    .toFormat(sharp.format.raw)
    .toBuffer();

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = maskAlpha[y * width + x];
      if (a < 128) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    sourceWidth: width,
    sourceHeight: height,
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Composite the model's output onto the original base, preserving the base
 * outside the mask's bounding box and taking the model's pixels inside the
 * bbox (with a soft feather at the boundary).
 *
 * Unlike `compositeMaskedEdit` (pixel-mask-scoped), this lets the model
 * refine the edit shape inside the bbox — the mask is treated as semantic
 * guidance for the model, not as a pixel-exact selection.
 */
export async function compositeOutsideBbox(
  baseBuffer: Buffer,
  editedBuffer: Buffer,
  bbox: MaskBbox,
  feather = 4,
): Promise<Buffer> {
  const sharp = await loadSharp();
  const baseMeta = await sharp(baseBuffer).metadata();
  const width = baseMeta.width ?? 0;
  const height = baseMeta.height ?? 0;
  if (!width || !height) throw new Error("compositeOutsideBbox: base has no dimensions.");

  const bboxScaled: MaskBbox = {
    sourceWidth: width,
    sourceHeight: height,
    minX: Math.round((bbox.minX * width) / bbox.sourceWidth),
    minY: Math.round((bbox.minY * height) / bbox.sourceHeight),
    maxX: Math.round((bbox.maxX * width) / bbox.sourceWidth),
    maxY: Math.round((bbox.maxY * height) / bbox.sourceHeight),
    width: 0,
    height: 0,
  };
  bboxScaled.width = bboxScaled.maxX - bboxScaled.minX + 1;
  bboxScaled.height = bboxScaled.maxY - bboxScaled.minY + 1;

  // Resize model output to match base dims.
  const editedResized = await sharp(editedBuffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const baseRaw = await sharp(baseBuffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Build a weight map: 1.0 inside bbox (minus feather), 0.0 outside bbox
  // (plus feather), linear ramp across the feather band.
  const channels = 4;
  const out = Buffer.from(baseRaw);
  const featherClamped = Math.max(0, Math.min(feather, Math.floor(Math.min(bboxScaled.width, bboxScaled.height) / 4)));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Distance to bbox edge (positive = inside).
      const distInside = Math.min(
        x - bboxScaled.minX,
        bboxScaled.maxX - x,
        y - bboxScaled.minY,
        bboxScaled.maxY - y,
      );
      let weight: number;
      if (distInside < 0) {
        weight = 0;
      } else if (distInside >= featherClamped) {
        weight = 1;
      } else if (featherClamped === 0) {
        weight = 1;
      } else {
        weight = distInside / featherClamped;
      }
      if (weight === 0) continue;
      const idx = (y * width + x) * channels;
      for (let c = 0; c < channels - 1; c += 1) {
        out[idx + c] = Math.round(
          weight * editedResized[idx + c] + (1 - weight) * baseRaw[idx + c],
        );
      }
      // Alpha: keep base alpha.
      out[idx + 3] = baseRaw[idx + 3];
    }
  }

  return sharp(out, {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();
}

export async function compositeMaskedEdit(
  baseBuffer: Buffer,
  editedBuffer: Buffer,
  maskBuffer: Buffer,
): Promise<Buffer> {
  const sharp = await loadSharp();
  const baseMeta = await sharp(baseBuffer).metadata();

  const width = baseMeta.width ?? 0;
  const height = baseMeta.height ?? 0;
  if (!width || !height) throw new Error("Composite: base image has no dimensions.");

  // The provider may return a different size than requested (e.g. 1024x1024
  // regardless of `size`). Resize the edited image to match the base dims.
  const editedResized = await sharp(editedBuffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Mask alpha: nearest resample so the binary 0/255 boundary stays binary.
  // Bilinear would smear the boundary into mid-range values that the
  // < 128 threshold below could either miss or bloat.
  const maskAlpha = await sharp(maskBuffer)
    .ensureAlpha()
    .resize(width, height, { fit: "fill", kernel: "nearest" })
    .extractChannel(3)
    .toFormat(sharp.format.raw)
    .toBuffer();

  const takeFromEdited = Buffer.alloc(maskAlpha.length);
  for (let i = 0; i < maskAlpha.length; i += 1) {
    takeFromEdited[i] = maskAlpha[i] < 128 ? 255 : 0;
  }

  const baseRaw = await sharp(baseBuffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const out = Buffer.alloc(baseRaw.length);
  const channels = 4;
  for (let i = 0; i < takeFromEdited.length; i += 1) {
    const take = takeFromEdited[i] === 255;
    for (let c = 0; c < channels; c += 1) {
      const idx = i * channels + c;
      out[idx] = take ? editedResized[idx] : baseRaw[idx];
    }
  }

  return sharp(out, {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();
}

// ── Shape-aware utilities ────────────────────────────────────────────────
// The bbox-based composites above reduce the mask to its bounding rectangle,
// so the edit covers a hard box regardless of the brush shape. The helpers
// below keep the mask's real silhouette so edits follow it.

const ALPHA_THRESHOLD = 128;

/** 1 byte per pixel in the mask's native resolution: 0 = edit, 255 = keep. */
export interface AlphaMap {
  width: number;
  height: number;
  alpha: Buffer;
}

/** Decode a mask PNG to an {@link AlphaMap} scaled to width×height. */
export async function alphaMapFromBuffer(
  maskBuffer: Buffer,
  width: number,
  height: number,
): Promise<AlphaMap> {
  const sharp = await loadSharp();
  // ensureAlpha() before resize so the alpha plane being resampled is the
  // real mask channel 3. kernel: "nearest" preserves the binary 0/255
  // boundary — the default bilinear resampler would smear it into
  // mid-range values, and ALPHA_THRESHOLD (128) downstream would either
  // drop a thin stroke entirely or bloat it into a fat band.
  //
  // Fast path: if the mask's metadata dims already match the target, skip
  // the resize entirely. On the generate path the mask has already been
  // base-aligned in xiangsu.ts (kernel: "nearest") before reaching here,
  // so this skip removes a redundant full-image nearest resample pass
  // without changing pixel output. Read dims from metadata — no pixel
  // decode — so this branch is cheap.
  const meta = await sharp(maskBuffer).metadata();
  const matchesTarget =
    meta.width === width && meta.height === height && width > 0 && height > 0;

  const raw = matchesTarget
    ? await sharp(maskBuffer)
        .ensureAlpha()
        .extractChannel(3)
        .toFormat(sharp.format.raw)
        .toBuffer()
    : await sharp(maskBuffer)
        .ensureAlpha()
        .resize(width, height, { fit: "fill", kernel: "nearest" })
        .extractChannel(3)
        .toFormat(sharp.format.raw)
        .toBuffer();
  return { width, height, alpha: raw };
}

/**
 * Morphologically dilate the editable (alpha < threshold) region of an alpha
 * map outwards by `radius` pixels using an integral-image so the per-pixel
 * cost stays cheap. A thin brush stroke grows this way to cover the whole
 * object it touches — the user's highlight is intent, not a pixel boundary.
 */
export function dilateAlpha(
  alpha: Buffer,
  width: number,
  height: number,
  radius: number,
): Buffer {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0 || width * height === 0) return alpha;

  // 2D prefix sum of editable pixels (alpha < threshold ⇒ 1).
  const integral = new Int32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const editable = alpha[y * width + x] < ALPHA_THRESHOLD ? 1 : 0;
      rowSum += editable;
      const above = y > 0 ? integral[(y - 1) * width + x] : 0;
      integral[y * width + x] = rowSum + above;
    }
  }

  const out = Buffer.from(alpha);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < ALPHA_THRESHOLD) continue; // already editable
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      const total =
        integral[y1 * width + x1] -
        (y0 > 0 ? integral[(y0 - 1) * width + x1] : 0) -
        (x0 > 0 ? integral[y1 * width + x0 - 1] : 0) +
        (y0 > 0 && x0 > 0 ? integral[(y0 - 1) * width + x0 - 1] : 0);
      if (total > 0) out[y * width + x] = 0;
    }
  }
  return out;
}

/**
 * Bounding box of the editable region in an alpha map's native coordinates.
 * Mirrors {@link maskBbox} but operates on a decoded (possibly dilated) map.
 */
export function alphaMapBbox(map: AlphaMap): MaskBbox | null {
  const { width, height, alpha } = map;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    sourceWidth: width,
    sourceHeight: height,
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Composite the model's output onto the original base following the mask's
 * actual silhouette — editable pixels take the model's repaint, preserved
 * pixels keep the base, and a smooth feather is sampled by dilating the
 * editable region outwards by `feather` pixels (linear ramp from the edge).
 *
 * Unlike {@link compositeOutsideBbox} (a bounding rectangle), the edit shape
 * is the mask shape itself (optionally dilated first to cover the whole
 * touched object), so angled strokes, rounded forms, and curves keep their
 * real outline instead of collapsing to a rectangle.
 */
export async function compositeAlphaShape(
  baseBuffer: Buffer,
  editedBuffer: Buffer,
  maskBuffer: Buffer,
  options: { feather?: number; dilate?: number } = {},
): Promise<Buffer> {
  const sharp = await loadSharp();
  const feather = Math.max(0, options.feather ?? 3);
  const dilate = Math.max(0, options.dilate ?? 0);

  const baseMeta = await sharp(baseBuffer).metadata();
  const width = baseMeta.width ?? 0;
  const height = baseMeta.height ?? 0;
  if (!width || !height) throw new Error("compositeAlphaShape: base has no dimensions.");

  let alpha = (await alphaMapFromBuffer(maskBuffer, width, height)).alpha;
  if (dilate > 0) alpha = dilateAlpha(alpha, width, height, dilate);

  const editedResized = await sharp(editedBuffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const baseRaw = await sharp(baseBuffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // BFS distance from the editable set; cap depth at `feather` for a linear
  // weight ramp. Pixels beyond the ramp (outside the feather band) keep the
  // base pixel-for-pixel, so the edit never leaks past the shape + halo.
  const channels = 4;
  const out = Buffer.from(baseRaw);
  const dist = new Int32Array(width * height).fill(-1);
  // Index queue sized to the pixel count (BFS only enqueues each pixel once).
  const ring = new Int32Array(width * height);
  let queueHead = 0;
  let queueTail = 0;
  for (let idx = 0; idx < width * height; idx += 1) {
    if (alpha[idx] < ALPHA_THRESHOLD) {
      dist[idx] = 0;
      ring[queueTail++] = idx;
      const off = idx * channels;
      out[off] = editedResized[off];
      out[off + 1] = editedResized[off + 1];
      out[off + 2] = editedResized[off + 2];
    }
  }

  while (queueHead < queueTail) {
    const idx = ring[queueHead++];
    const d = dist[idx];
    if (d >= feather) continue; // past the band; spread stops here
    const x = idx % width;
    const y = (idx / width) | 0;
    for (let n = 0; n < 4; n += 1) {
      const nx = x + NEIGHBORS[n * 2];
      const ny = y + NEIGHBORS[n * 2 + 1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nidx = ny * width + nx;
      if (dist[nidx] !== -1) continue; // visited or editable (dist 0)
      dist[nidx] = d + 1;
      ring[queueTail++] = nidx;
      const weight = feather > 0 ? (feather - (d + 1)) / feather : 1;
      const off = nidx * channels;
      for (let c = 0; c < channels - 1; c += 1) {
        out[off + c] = Math.round(
          weight * editedResized[off + c] + (1 - weight) * baseRaw[off + c],
        );
      }
    }
  }

  return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

const NEIGHBORS = [-1, 0, 1, 0, 0, -1, 0, 1];

// ── Material swatch compositor ────────────────────────────────────────────
// For a mask-attached material/image transfer (e.g. "@elastic"), the model
// can only see `image[0]`. To give it real texture pixels to sample from we
// bake a downsized copy of the material image as a visible swatch OUTSIDE
// the mask's bbox. The swatch itself is outside the mask so the provider
// keeps it as "input reference" — and the local composite uses the ORIGINAL
// baseBuffer, so the swatch never reaches the final output.

export interface SwatchRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SwatchResult {
  buffer: Buffer;
  rect: SwatchRect | null;
}

interface AvoidBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function rectsDisjoint(
  aLeft: number,
  aTop: number,
  aRight: number,
  aBottom: number,
  bbox: AvoidBbox,
): boolean {
  // Treat the bbox as inclusive of minX/minY and inclusive of maxX/maxY
  // (matching alphaMapBbox which records the last editable pixel index).
  // Two rects are disjoint if one lies entirely to one side of the other.
  return (
    aRight <= bbox.minX ||
    aLeft >= bbox.maxX + 1 ||
    aBottom <= bbox.minY ||
    aTop >= bbox.maxY + 1
  );
}

function pickSwatchPlacement(
  baseWidth: number,
  baseHeight: number,
  swatchSize: number,
  margin: number,
  avoidBbox: AvoidBbox | null,
): SwatchRect | null {
  if (swatchSize <= 0 || baseWidth <= 0 || baseHeight <= 0) return null;
  if (swatchSize > baseWidth || swatchSize > baseHeight) return null;

  const candidates: Array<{ left: number; top: number }> = [];
  if (avoidBbox) {
    // Right of bbox.
    candidates.push({ left: avoidBbox.maxX + 1 + margin, top: avoidBbox.minY });
    // Left of bbox.
    candidates.push({
      left: avoidBbox.minX - margin - 1 - swatchSize,
      top: avoidBbox.minY,
    });
    // Below bbox.
    candidates.push({ left: avoidBbox.minX, top: avoidBbox.maxY + 1 + margin });
    // Above bbox.
    candidates.push({
      left: avoidBbox.minX,
      top: avoidBbox.minY - margin - 1 - swatchSize,
    });
  }
  // Corner fallbacks (always tried; useful when bbox is null or the side
  // placements above already failed because the bbox hugs an edge).
  candidates.push({
    left: baseWidth - margin - swatchSize,
    top: margin,
  });
  candidates.push({
    left: baseWidth - margin - swatchSize,
    top: baseHeight - margin - swatchSize,
  });

  for (const candidate of candidates) {
    const left = Math.round(candidate.left);
    const top = Math.round(candidate.top);
    const right = left + swatchSize;
    const bottom = top + swatchSize;
    const within =
      left >= margin && top >= margin && right <= baseWidth - margin && bottom <= baseHeight - margin;
    if (!within) continue;
    if (avoidBbox && !rectsDisjoint(left, top, right, bottom, avoidBbox)) continue;
    return { left, top, width: swatchSize, height: swatchSize };
  }
  return null;
}

/**
 * Bake a downsized copy of `materialBuffer` onto `baseBuffer` as a visible
 * swatch placed OUTSIDE `avoidBbox` (the mask's editable bbox, in base-pixel
 * space). The provider sees the real material texture as input pixels and
 * can paint it into the masked region; the swatch itself is outside the
 * mask so it survives the provider's mask clipping as visible reference.
 *
 * Returns the composited buffer and the swatch's rectangle (or null if no
 * placement fits outside the bbox — the caller should fall back to a
 * textual cue). The returned buffer is a fresh PNG; `baseBuffer` is not
 * mutated.
 */
export async function composeMaterialSwatch(
  baseBuffer: Buffer,
  materialBuffer: Buffer,
  avoidBbox: AvoidBbox | null,
  baseWidth: number,
  baseHeight: number,
  options: { swatchSize?: number; margin?: number } = {},
): Promise<SwatchResult> {
  const sharp = await loadSharp();
  // Defaults: ~1/4 of the smaller base dimension, floored at 64px, capped
  // at 1/3 of the smaller dimension so the swatch never dominates the photo.
  const minDim = Math.max(1, Math.min(baseWidth, baseHeight));
  const defaultSize = Math.max(64, Math.round(minDim * 0.25));
  const maxSize = Math.max(64, Math.floor(minDim / 3));
  const swatchSize = Math.max(
    64,
    Math.min(maxSize, Math.round(options.swatchSize ?? defaultSize)),
  );
  const margin = Math.max(8, Math.round(options.margin ?? minDim * 0.02));

  const rect = pickSwatchPlacement(baseWidth, baseHeight, swatchSize, margin, avoidBbox);
  if (!rect) {
    // No room outside the bbox — caller falls back to a textual cue.
    // Return a clean re-encode of the base (dimensions preserved) so the
    // caller can still wire the buffer through without branching.
    const fallback = await sharp(baseBuffer)
      .resize(baseWidth, baseHeight, { fit: "fill" })
      .png()
      .toBuffer();
    return { buffer: fallback, rect: null };
  }

  // Square swatch via cover-crop: a material sample is best shown as a full
  // square of texture (no letterbox with transparent borders).
  const swatch = await sharp(materialBuffer)
    .resize(rect.width, rect.height, { fit: "cover" })
    .png()
    .toBuffer();

  const composited = await sharp(baseBuffer)
    .resize(baseWidth, baseHeight, { fit: "fill" })
    .composite([{ input: swatch, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();

  return { buffer: composited, rect };
}
