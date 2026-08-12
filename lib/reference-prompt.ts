import { deflateSync } from "node:zlib";

import type { ImageGenerationReference } from "@/lib/image-generation-models";

export interface ProviderImageReference {
  alias: string;
  url: string;
  maskUrl?: string;
  description: string;
  source: "image" | "pantone";
}

export interface CompiledReferencePrompt {
  prompt: string;
  imageUrls: string[];
  maskUrl?: string;
}

const PNG_SWATCH_SIZE = 512;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function normalizedAlias(alias: string): string {
  return alias.trim().replace(/^@+/, "");
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function rgbFromHex(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function solidColorPngDataUrl(hex: string): string {
  const [red, green, blue] = rgbFromHex(hex);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(PNG_SWATCH_SIZE, 0);
  ihdr.writeUInt32BE(PNG_SWATCH_SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLength = 1 + PNG_SWATCH_SIZE * 3;
  const raw = Buffer.alloc(rowLength * PNG_SWATCH_SIZE);
  for (let y = 0; y < PNG_SWATCH_SIZE; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < PNG_SWATCH_SIZE; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 3;
      raw[pixelOffset] = red;
      raw[pixelOffset + 1] = green;
      raw[pixelOffset + 2] = blue;
    }
  }

  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

export function referencesForProvider(
  references: readonly ImageGenerationReference[],
): ProviderImageReference[] {
  return references.map((reference, index) => {
    const alias = normalizedAlias(reference.alias) || `reference-${index + 1}`;
    if (reference.kind === "image") {
      return {
        alias,
        url: reference.url,
        maskUrl: reference.maskUrl,
        source: "image",
        description: `@${alias} is a user-provided image reference.`,
      };
    }

    const label = reference.label.trim() || alias;
    const hex = reference.hex.toUpperCase();
    return {
      alias,
      url: solidColorPngDataUrl(hex),
      source: "pantone",
      description: `@${alias} is a solid Pantone color reference for ${label} (${hex}). It is color-only guidance, not a subject image.`,
    };
  });
}

function mentionIndex(prompt: string, alias: string): number {
  return prompt.toLocaleLowerCase().indexOf(`@${alias.toLocaleLowerCase()}`);
}

export function orderedReferences(
  prompt: string,
  references: readonly ProviderImageReference[],
): ProviderImageReference[] {
  return references
    .map((reference, index) => ({
      reference: {
        ...reference,
        alias: normalizedAlias(reference.alias) || `reference-${index + 1}`,
        url: reference.url,
      },
      index,
    }))
    .sort((left, right) => {
      const leftMention = mentionIndex(prompt, left.reference.alias);
      const rightMention = mentionIndex(prompt, right.reference.alias);
      const leftRank = leftMention < 0 ? Number.POSITIVE_INFINITY : leftMention;
      const rightRank = rightMention < 0 ? Number.POSITIVE_INFINITY : rightMention;
      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ reference }) => reference);
}

function mentionedReferences(
  prompt: string,
  references: readonly ProviderImageReference[],
): ProviderImageReference[] {
  return references.filter((reference) => mentionIndex(prompt, reference.alias) >= 0);
}

function textureTransferConstraint(
  prompt: string,
  references: readonly ProviderImageReference[],
): string | null {
  if (!/\b(texture|fabric|material|knit|pattern)\b/i.test(prompt)) return null;

  const mentioned = mentionedReferences(prompt, references);
  if (mentioned.length < 2) return null;

  const [target, source] = mentioned;
  return [
    "Texture-transfer constraint:",
    `- Use @${target.alias} as the target/base image.`,
    `- Use @${source.alias} only as the source of texture, fabric, knit, pattern, color treatment, and material character.`,
    `- Preserve @${target.alias}'s garment silhouette, construction, proportions, layout, framing, and background.`,
    `- Do not copy people, faces, bodies, poses, scenery, or unrelated objects from @${source.alias}.`,
  ].join("\n");
}

function colorTransferConstraint(
  prompt: string,
  references: readonly ProviderImageReference[],
): string | null {
  if (!/\b(colou?r|hue|shade|pantone)\b/i.test(prompt)) return null;

  const mentioned = mentionedReferences(prompt, references);
  if (mentioned.length < 2) return null;

  const [target, source] = mentioned;
  const hasMask = references.some((reference) => reference.maskUrl);
  // Strict mask clause: the attached mask IS the edit region. No "expand to
  // the whole object" — that caused the model to recolor the dominant region
  // of the subject (e.g. the whole shoe body) instead of the user's thin
  // brush stroke. When a mask is present, the recolor is confined to the
  // mask's pixels; the rest of the subject must be preserved exactly.
  const maskClause = hasMask
    ? `- Only recolor the pixels inside the attached alpha mask on @${target.alias}. Transparent pixels (alpha 0) = recolor; opaque pixels = preserve exactly as in @${target.alias}. Do NOT recolor any area outside the mask, even if it appears to be the same object, fabric, or panel — the user's stroke is the edit, not a hint.`
    : `- Recolor every visible surface of the subject in @${target.alias}.`;
  return [
    "Color-transfer constraint:",
    `- Provider image 1 / @${target.alias} is the target/base image and must remain the subject.`,
    `- Provider image 2 / @${source.alias} is only a color reference.`,
    `- Recolor the existing subject in @${target.alias} to match @${source.alias} (use its hue/saturation/value; preserve the original shading, folds, and material response to light).`,
    `- Preserve every detail from @${target.alias} outside the recolored region: garment type, silhouette, collar, cuffs, hem, folds, knit/fabric texture, lighting, shadows, camera angle, framing, background, and all visible construction details.`,
    `- Do not replace @${target.alias} with a different product, sweatshirt, logo, pose, layout, or composition.`,
    `- Do not generate a standalone color card, Pantone label, or literal text for @${source.alias}.`,
    maskClause,
  ].join("\n");
}

function objectOrMaterialConstraint(
  prompt: string,
  references: readonly ProviderImageReference[],
  droppedForMask: readonly ProviderImageReference[] = [],
): string | null {
  if (!/\b(object|material|part|piece|handle|strap|button|zipper|panel|region)\b/i.test(prompt)) {
    return null;
  }
  // Include dropped references in the mention search so constraints still
  // fire when a texture image was dropped due to a mask being attached.
  const pool = [...references, ...droppedForMask];
  const mentioned = mentionedReferences(prompt, pool);
  if (mentioned.length < 2) return null;

  const [target, source] = mentioned;
  const maskClause = `Only the pixels inside an attached alpha mask (transparent = edit) may change. If no mask is attached, do not edit @${target.alias} at all — refuse rather than drifting.`;
  const sourceNote =
    droppedForMask.length > 0 && droppedForMask.some((reference) => reference.alias === source.alias)
      ? `\n- @${source.alias} is provided by name only (no attached image). Infer the material/style from the alias name and apply it inside the mask region.`
      : null;
  return [
    "Object/material-transfer constraint:",
    `- Use @${target.alias} as the target/base image (the object you are editing).`,
    `- Use @${source.alias} only as the source of the new object, material, or part shape — not as a replacement for the whole product.`,
    `- Preserve @${target.alias}'s overall silhouette, construction, proportions, framing, lighting, background, and surrounding context.`,
    `- Match @${target.alias}'s original light direction, highlights, and shadows inside the masked region. Do not introduce new lighting.`,
    `- ${maskClause}`,
    `- Do not replace @${target.alias} with an unrelated product, do not relight the unmasked area, and do not alter letters, logos, or shapes outside the masked region.`,
    sourceNote,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function compileReferencePrompt(
  userPrompt: string,
  references: readonly ImageGenerationReference[],
): CompiledReferencePrompt {
  let ordered = orderedReferences(userPrompt, referencesForProvider(references));
  if (ordered.length === 0) {
    return { prompt: userPrompt, imageUrls: [] };
  }

  // When a mask is attached we STILL send every image reference to the
  // provider, not just the base. Historically this code dropped additional
  // images because "OpenAI images.edit applies the mask only to image[0]" —
  // but that only constrains WHICH image the mask clips, not how many we may
  // send. Dropping the @product image forced the model to guess the product
  // from its alias name, so a "paste @product in this region" prompt came
  // back as a vague repaint rather than a real placement. Now: mask-base is
  // image[0] (so the mask clips it), and every other image reference is
  // attached as image[1..] so the model has real pixels to draw from. The
  // `maskConstraint` below tells the model those later images are the source
  // to place INSIDE the transparent region. Non-image references (pantone
  // swatches) are always attached as before.
  const maskCarrier = ordered.find((reference) => reference.maskUrl);
  const droppedForMask: ProviderImageReference[] = [];
  if (maskCarrier) {
    ordered = [maskCarrier, ...ordered.filter((reference) => reference !== maskCarrier)];
  }

  const mapping = ordered
    .map(
      (reference, index) =>
        `- Provider image ${index + 1} is @${reference.alias}: ${reference.description}`,
    )
    .join("\n");
  // When we drop image references because a mask is attached, surface their
  // names in the prompt so the model still has context for those @aliases
  // (e.g. "@elastic" becomes a textual material cue rather than an image).
  const droppedNote =
    maskCarrier && droppedForMask.length > 0
      ? [
          "Additional reference images not attached to this edit (known by name only):",
          ...droppedForMask.map(
            (reference) =>
              `- @${reference.alias}: treat as a textual material/style cue. Infer its meaning from the alias name and apply that material or style inside the mask region. Do not require an actual image of @${reference.alias} to be attached.`,
          ),
        ].join("\n")
      : null;
  const constraints = [
    textureTransferConstraint(userPrompt, ordered),
    colorTransferConstraint(userPrompt, ordered),
    objectOrMaterialConstraint(userPrompt, ordered, droppedForMask),
  ].filter((constraint): constraint is string => Boolean(constraint));
  // Auxiliary attached image references (image[1..]) that the model should
  // draw from when filling the transparent region. Empty for a pure recolor
  // (only the base + a pantone swatch).
  const auxiliaryImages = maskCarrier
    ? ordered.filter((reference) => reference !== maskCarrier && reference.source === "image")
    : [];
  const auxiliaryPasteLines = auxiliaryImages.map(
    (reference, index) =>
      `- Provider image ${index + 2} / @${reference.alias}: this is the SOURCE to place INTO the transparent region of @${maskCarrier!.alias}. Paste this image's actual content (subject, product, texture, colour) into the masked area, fitted to the region. Respect @${maskCarrier!.alias}'s light direction and blend only the boundary seam — do not recolour or stylise the pasted content.`,
  );
  const maskConstraint = maskCarrier
    ? [
        "MASK GUIDANCE (the attached mask marks the exact edit region):",
        `- @${maskCarrier.alias} is the base image the user wants to edit (provider image 1).`,
        ...(auxiliaryPasteLines.length > 0
          ? [
              "The additional attached image(s) are real source pixels to place INSIDE the mask — not textual cues:",
              ...auxiliaryPasteLines,
            ]
          : []),
        `- An alpha mask is attached: transparent (alpha 0) = the region to edit, opaque = keep unchanged. Regenerate the pixels inside the transparent region ONLY. Every opaque pixel must be preserved exactly as in @${maskCarrier.alias} — no recoloring outside the mask, no matter how visually similar the surrounding area looks.`,
        `- The user's stroke is a literal selection, not a hint to recolor a larger object. Do NOT expand the edit to neighbouring regions, panels, seams, straps, or fabric of the same material. The edit shape is the mask shape — nothing more.`,
        `- Keep every part of @${maskCarrier.alias} unchanged outside the mask: silhouette, background, framing, print, logos, lighting, shadows, and every other visible detail.`,
      ].join("\n")
    : null;

  return {
    prompt: [
      "Reference image mapping:",
      mapping,
      "",
      "User instruction:",
      userPrompt,
      "",
      "Resolve every @alias using the mapping above and the attached provider images in the same order. Do not interpret an @alias as unrelated text.",
      "When the instruction asks to change color, edit provider image 1 as the base image. Later provider images are references only.",
      droppedNote,
      ...constraints,
      maskConstraint,
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n"),
    imageUrls: ordered.map((reference) => reference.url),
    maskUrl: maskCarrier?.maskUrl,
  };
}
