import { z } from "zod";

import { IMAGE_VECTOR_EMBEDDING_MODEL } from "@/lib/image-vector-search";
import { supplierProductTypes } from "@/lib/workspace-records";

export const MAX_SUPPLIER_MATCH_CATALOG_IMAGES = 100;
/** Local histogram/structure embedding used as the offline fallback. */
export const SUPPLIER_MATCH_LOCAL_MODEL = IMAGE_VECTOR_EMBEDDING_MODEL;
/** CLIP vision model used by the Picture Sherlock sidecar. */
export const SUPPLIER_MATCH_PICTURE_SHERLOCK_MODEL =
  "picture-sherlock-clip-vit-base-patch32" as const;
/** CLIP + Milvus Lite vector search used by the Milvus match sidecar. */
export const SUPPLIER_MATCH_MILVUS_MODEL = "milvus-clip-vit-base-patch32" as const;
/** LabelStash-style search: same local visual embedding as the `local` engine,
 *  branded separately so the dialog reads as a distinct (LabelStash-style)
 *  affordance. Runs entirely on this server — no external call, no eland API key. */
export const SUPPLIER_MATCH_LABELSTASH_MODEL = "labelstash-local-visual-v1" as const;
/** the-eland.co LabelStash Partner Search API. Calls POST /api/portal/v1/search
 *  with the X-API-Key header. Searches your org's previously-uploaded portal
 *  catalog — there is no upload API and no per-supplier filter. */
export const SUPPLIER_MATCH_ELAND_MODEL = "eland-portal-v1" as const;
/** Google Gemini multi-modal image embedding (gemini-embedding-2, 768-dim).
 *  Embeds the reference + each selected-supplier catalog image server-side and
 *  cosine-ranks them in process — no Python sidecar, no external catalog. */
export const SUPPLIER_MATCH_GEMINI_MODEL = "gemini-embedding-2" as const;
export const SUPPLIER_MATCH_ENGINES = [
  "picture-sherlock",
  "milvus",
  "local",
  "labelstash",
  "eland",
  "gemini",
] as const;
export type SupplierMatchEngine = (typeof SUPPLIER_MATCH_ENGINES)[number];
export const SUPPLIER_MATCH_MODELS = [
  SUPPLIER_MATCH_LOCAL_MODEL,
  SUPPLIER_MATCH_PICTURE_SHERLOCK_MODEL,
  SUPPLIER_MATCH_MILVUS_MODEL,
  SUPPLIER_MATCH_LABELSTASH_MODEL,
  SUPPLIER_MATCH_ELAND_MODEL,
  SUPPLIER_MATCH_GEMINI_MODEL,
] as const;
/** @deprecated Prefer SUPPLIER_MATCH_LOCAL_MODEL / SUPPLIER_MATCH_MODELS. */
export const SUPPLIER_MATCH_MODEL = SUPPLIER_MATCH_LOCAL_MODEL;

const MAX_IMAGE_SOURCE_LENGTH = 8_000_000;

export const supplierMatchImageSourceSchema = z
  .string()
  .min(1, "Image URL is required.")
  .max(MAX_IMAGE_SOURCE_LENGTH, "Image data is too large.")
  .refine(
    (value) => {
      if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value)) return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Image must be an HTTP(S) URL or a supported image data URL." },
  );

export const supplierMatchQueryImageSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    url: supplierMatchImageSourceSchema,
  })
  .strict();

export const supplierMatchCatalogItemSchema = z
  .object({
    catalogItemId: z.string().trim().min(1).max(240),
    supplierId: z.string().trim().min(1).max(120),
    supplierName: z.string().trim().min(1).max(240),
    productId: z.string().trim().min(1).max(120),
    productSubject: z.string().trim().min(1).max(300),
    productType: z.enum(supplierProductTypes),
    variantId: z.string().trim().min(1).max(120),
    imageName: z.string().trim().min(1).max(300),
    imageUrl: supplierMatchImageSourceSchema,
    detail: z.string().trim().max(1_500),
    material: z.string().trim().max(300),
    colorNotes: z.string().trim().max(300),
    parameters: z.record(z.string().trim().min(1).max(100), z.string().trim().max(300)),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.parameters).length > 30) {
      context.addIssue({
        code: "custom",
        path: ["parameters"],
        message: "A catalog item can include at most 30 parameters.",
      });
    }
  });

export const supplierImageMatchRequestSchema = z
  .object({
    queryImage: supplierMatchQueryImageSchema,
    catalog: z
      .array(supplierMatchCatalogItemSchema)
      .min(1, "Add at least one supplier product image before searching.")
      .max(
        MAX_SUPPLIER_MATCH_CATALOG_IMAGES,
        `Image search supports up to ${MAX_SUPPLIER_MATCH_CATALOG_IMAGES} supplier images at once.`,
      ),
    currentSupplierId: z.string().trim().min(1).max(120),
    /** Which reverse-image engine to use. Defaults to Picture Sherlock. */
    engine: z.enum(SUPPLIER_MATCH_ENGINES).default("picture-sherlock"),
    /** Free-text query for the eland engine — matched against the name,
     *  description and tags written at portal upload time. Ignored by the
     *  local/sidecar engines. Optional. */
    query: z.string().trim().max(2_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const [index, item] of value.catalog.entries()) {
      if (item.supplierId !== value.currentSupplierId) {
        context.addIssue({
          code: "custom",
          path: ["catalog", index, "supplierId"],
          message: "Catalog images must belong to the selected supplier.",
        });
      }
      if (ids.has(item.catalogItemId)) {
        context.addIssue({
          code: "custom",
          path: ["catalog", index, "catalogItemId"],
          message: "Catalog image identifiers must be unique.",
        });
      }
      ids.add(item.catalogItemId);
    }
  });

export const supplierImageMatchCandidateSchema = z
  .object({
    catalogItemId: z.string().trim().min(1).max(240),
    /** Comparative similarity score 0–100 (higher is closer). */
    similarity: z.number().finite().min(0).max(100),
    /** Cosine similarity in [-1, 1]. */
    cosine: z.number().finite().min(-1).max(1),
    /** eland-portal result name. Present only for the eland engine. */
    remoteName: z.string().trim().max(300).optional(),
    /** eland-portal original image URL. May be null in the eland response. */
    remoteImageUrl: z.string().trim().max(2_000).nullable().optional(),
    /** eland-portal thumbnail URL. May be null in the eland response. */
    remoteThumbnailUrl: z.string().trim().max(2_000).nullable().optional(),
    /** eland-portal description (≤2000 chars). */
    remoteDescription: z.string().trim().max(2_000).nullable().optional(),
    /** eland-portal tags. */
    remoteTags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    /** eland-portal opaque image id, used to build /portal/uploads/<id> links. */
    remoteId: z.string().trim().max(240).optional(),
  })
  .strict();

export const supplierImageMatchResponseSchema = z
  .object({
    // eland legitimately returns an empty results array (nothing matched, or
    // the catalog is not uploaded/indexed yet) — that is a success, not an
    // error. The local/sidecar engines always return ≥1 match.
    matches: z
      .array(supplierImageMatchCandidateSchema)
      .min(0)
      .max(MAX_SUPPLIER_MATCH_CATALOG_IMAGES),
    searchedCount: z.number().int().min(0).max(MAX_SUPPLIER_MATCH_CATALOG_IMAGES),
    model: z.enum(SUPPLIER_MATCH_MODELS),
    /** Portal upload link prefix for eland results, e.g. "https://the-eland.co".
     *  Absent for the local/sidecar engines. */
    portalUploadUrl: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const supplierImageMatchErrorSchema = z
  .object({ error: z.string().trim().min(1).max(1_000) })
  .strict();

export const supplierMatchUploadMetadataSchema = z
  .object({
    name: z.string().trim().min(1, "Choose an image file.").max(240),
    size: z
      .number()
      .int()
      .positive("The image file is empty.")
      .max(12 * 1024 * 1024, {
        message: "Choose an image smaller than 12 MB.",
      }),
    type: z.enum(["image/jpeg", "image/png", "image/webp"], {
      message: "Choose a JPG, PNG, or WebP image.",
    }),
  })
  .strict();

export type SupplierMatchQueryImage = z.infer<typeof supplierMatchQueryImageSchema>;
export type SupplierMatchCatalogItem = z.infer<typeof supplierMatchCatalogItemSchema>;
export type SupplierImageMatchRequest = z.infer<typeof supplierImageMatchRequestSchema>;
export type SupplierImageMatchCandidate = z.infer<typeof supplierImageMatchCandidateSchema>;
export type SupplierImageMatchResponse = z.infer<typeof supplierImageMatchResponseSchema>;
