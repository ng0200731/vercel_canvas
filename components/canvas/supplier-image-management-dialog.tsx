"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactElement,
} from "react";
import {
  AlertCircle,
  Check,
  Eye,
  Images,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupplierImageMatch } from "@/lib/hooks/use-supplier-image-match";
import {
  getProductImageGalleryItems,
  type ProductImageGalleryItem,
} from "@/lib/product-image-gallery";
import {
  MAX_SUPPLIER_MATCH_CATALOG_IMAGES,
  SUPPLIER_MATCH_ELAND_MODEL,
  SUPPLIER_MATCH_LOCAL_MODEL,
  SUPPLIER_MATCH_LABELSTASH_MODEL,
  SUPPLIER_MATCH_MILVUS_MODEL,
  SUPPLIER_MATCH_PICTURE_SHERLOCK_MODEL,
  supplierMatchUploadMetadataSchema,
  type SupplierImageMatchCandidate,
  type SupplierMatchCatalogItem,
  type SupplierMatchEngine,
  type SupplierMatchQueryImage,
} from "@/lib/supplier-image-match";
import { persistGeneratedImage, uploadImage } from "@/lib/upload";
import { cn } from "@/lib/utils";
import {
  getWorkspaceProductTypeLabel,
  isSupplierProductType,
  type ProductImageInput,
  type ProductRecord,
  type ProductVariantRecord,
  type SupplierProductType,
  type SupplierRecord,
} from "@/lib/workspace-records";

interface SupplierImageManagementDialogProps {
  products: readonly ProductRecord[];
  suppliers: readonly SupplierRecord[];
  isCatalogLoading?: boolean;
  catalogError?: string | null;
  currentSupplierId?: string | null;
  selectedItemId?: string | null;
  /** Reverse-image engine: Picture Sherlock (Eye) or Milvus vector search (Database). */
  engine?: SupplierMatchEngine;
  trigger: ReactElement;
  onSelect: (item: ProductImageGalleryItem) => void;
}

interface RankedMatch {
  match: SupplierImageMatchCandidate;
  item: ProductImageGalleryItem | null;
  supplier: SupplierRecord | null;
}

interface ComparisonField {
  label: string;
  value: string;
}

/** Build a synthetic `ProductImageGalleryItem` for a the-eland.co remote match.
 *  The supplier node's `selectProductImage()` only reads a handful of fields
 *  (`product.productType/supplierId/subject/id`, `variant.id/image/material/
 *  colorNotes/parameters`), so we populate those and default the rest. The
 *  image URL is the *persisted* app URL (already durably stored in Supabase /
 *  local Postgres / data-URL), not the eland URL — eland URLs are opaque and
 *  may change, so the canvas must survive eland storage migrations. */
function buildElandGalleryItem(
  match: SupplierImageMatchCandidate,
  persisted: { url: string; storagePath: string | null },
  supplierId: string,
  productType: SupplierProductType,
): ProductImageGalleryItem {
  const remoteRef = match.remoteId ?? match.catalogItemId;
  const image: ProductImageInput = {
    name: match.remoteName ?? "the-eland.co image",
    url: persisted.url,
    storagePath: persisted.storagePath,
  };
  const variant: ProductVariantRecord = {
    id: `eland-variant:${remoteRef}`,
    sortIndex: 0,
    material: match.remoteTags?.[0] ?? "",
    colorNotes: "",
    parameters: {},
    unitPrice: "",
    priceUnit: "",
    image,
  } as ProductVariantRecord;
  const product: ProductRecord = {
    id: `eland:${remoteRef}`,
    ownerKind: "supplier",
    supplierId,
    customerId: null,
    projectId: null,
    productType,
    subject: match.remoteName ?? "the-eland.co match",
    detail: match.remoteDescription ?? "",
    variants: [variant],
    createdAt: "",
    updatedAt: "",
  } as ProductRecord;
  return { id: match.catalogItemId, product, variant: { ...variant, image }, variantIndex: 0 };
}

/** Comparison fields for a the-eland.co remote result (no local gallery item). */
function buildElandComparisonFields(match: SupplierImageMatchCandidate): ComparisonField[] {
  const tags = (match.remoteTags ?? []).slice(0, 4).join(", ") || "None";
  return [
    { label: "Name", value: match.remoteName ?? "Unnamed" },
    {
      label: "Description",
      value: normalizeComparisonValue(match.remoteDescription),
    },
    { label: "Tags", value: tags },
    { label: "Image ID", value: normalizeComparisonValue(match.remoteId) },
  ];
}

function normalizeComparisonValue(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : "Not specified";
}

function lookupComparisonValue(
  parameters: Readonly<Record<string, string>>,
  patterns: readonly RegExp[],
  fallback: string,
): string {
  for (const [key, value] of Object.entries(parameters)) {
    if (!value.trim()) continue;
    if (patterns.some((pattern) => pattern.test(key))) return value.trim();
  }
  return fallback;
}

function buildComparisonFields(item: ProductImageGalleryItem): ComparisonField[] {
  return [
    {
      label: "Shape",
      value: getWorkspaceProductTypeLabel(item.product.productType),
    },
    {
      label: "Color",
      value: normalizeComparisonValue(item.variant.colorNotes),
    },
    {
      label: "Pattern",
      value: lookupComparisonValue(
        item.variant.parameters,
        [/pattern/i, /print/i, /texture/i, /weave/i, /knit/i],
        normalizeComparisonValue(item.variant.material),
      ),
    },
    {
      label: "Design",
      value: lookupComparisonValue(
        item.variant.parameters,
        [/design/i, /style/i, /layout/i, /finish/i, /artwork/i],
        normalizeComparisonValue(item.product.detail),
      ),
    },
  ];
}

function SimilarityMeter({ value }: { value: number }) {
  const filledSegments = Math.max(0, Math.min(5, Math.round(value / 20)));
  return (
    <div
      className="flex items-center gap-1"
      aria-label={`${Math.round(value)} percent similarity`}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-1.5 w-5 rounded-full",
            index < filledSegments ? "bg-amber-500 dark:bg-amber-400" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function matchEngineLabel(model: string): string {
  if (model === SUPPLIER_MATCH_PICTURE_SHERLOCK_MODEL) {
    return "CLIP + local features (Picture Sherlock)";
  }
  if (model === SUPPLIER_MATCH_MILVUS_MODEL) {
    return "CLIP + Milvus vector search";
  }
  if (model === SUPPLIER_MATCH_LOCAL_MODEL) {
    return "Local histogram fallback";
  }
  if (model === SUPPLIER_MATCH_LABELSTASH_MODEL) {
    return "Local visual embeddings (LabelStash-style)";
  }
  if (model === SUPPLIER_MATCH_ELAND_MODEL) {
    return "the-eland.co Partner Search API";
  }
  return model;
}

function confidenceLabel(cosine: number): { label: string; className: string } {
  if (cosine >= 0.72) {
    return {
      label: "Strong",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
    };
  }
  if (cosine >= 0.5) {
    return {
      label: "Moderate",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    };
  }
  return {
    label: "Weak",
    className: "border-border bg-muted text-muted-foreground",
  };
}

function SearchLoading({ imageCount }: { imageCount: number }) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 rounded-xl border border-dashed p-8 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="relative grid size-20 place-items-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
        <Eye className="size-8" />
        <span className="absolute inset-[-0.45rem] animate-spin rounded-full border border-transparent border-t-amber-500 motion-reduce:animate-none" />
      </div>
      <div className="max-w-md space-y-2">
        <p className="font-heading text-lg font-semibold">Searching this supplier catalog</p>
        <p className="text-muted-foreground text-sm leading-6">
          Embedding your reference and {imageCount} supplier image
          {imageCount === 1 ? "" : "s"}, then ranking by cosine similarity.
        </p>
      </div>
      <div className="grid w-full max-w-md grid-cols-3 gap-3" aria-hidden="true">
        <Skeleton className="aspect-square" />
        <Skeleton className="aspect-square [animation-delay:150ms]" />
        <Skeleton className="aspect-square [animation-delay:300ms]" />
      </div>
      <p className="text-muted-foreground text-xs">
        Large catalogs can take a moment. Keep this dialog open while search runs.
      </p>
    </div>
  );
}

function CatalogUnavailable({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div
        className="grid min-h-72 place-items-center rounded-xl border border-dashed"
        role="status"
      >
        <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          Loading supplier catalog…
        </span>
      </div>
    );
  }
  return (
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-8 text-center">
      <div className="max-w-sm space-y-3">
        {error ? (
          <AlertCircle className="text-destructive mx-auto size-8" />
        ) : (
          <Images className="text-muted-foreground mx-auto size-8" />
        )}
        <p className="font-heading font-semibold">
          {error ? "Supplier catalog unavailable" : "No supplier images yet"}
        </p>
        <p className="text-muted-foreground text-sm leading-6">
          {error ??
            "Add product images to your supplier records first. Image search needs at least one catalog image to compare."}
        </p>
      </div>
    </div>
  );
}

/** the-eland.co returns an empty `results` array when nothing is indexed yet
 *  (a freshly uploaded image, or no upload at all). That is a 200 success, not
 *  an error — surface it honestly with the next steps. */
function ElandEmptyResults({ portalUploadUrl }: { portalUploadUrl?: string }) {
  const uploadHref = portalUploadUrl
    ? new URL("/portal/upload", portalUploadUrl).toString()
    : "https://the-eland.co/portal/upload";
  const keysHref = portalUploadUrl
    ? new URL("/portal/keys", portalUploadUrl).toString()
    : "https://the-eland.co/portal/keys";
  return (
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-8 text-center">
      <div className="max-w-md space-y-3">
        <Images className="text-muted-foreground mx-auto size-9" />
        <p className="font-heading font-semibold">No matches on the-eland.co yet</p>
        <p className="text-muted-foreground text-sm leading-6">
          the-eland.co returned no results. The portal searches only images your organization
          previously uploaded at{" "}
          <a
            href={uploadHref}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            /portal/upload
          </a>{" "}
          and indexed. A freshly uploaded image returns nothing until indexing completes (no status
          field — just wait, then retry). Also confirm{" "}
          <a
            href={keysHref}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            /portal/keys
          </a>{" "}
          has an Active key and <code>ELAND_PORTAL_API_KEY</code> is set in <code>.env.local</code>.
        </p>
      </div>
    </div>
  );
}

/** State for the optional eland free-text query, lifted out of the local
 *  ElandQueryBox so the dialog can attach it to the mutation call. */
const elandQueryStore: { current: string } = { current: "" };

/** Free-text query box for the eland engine. The portal matches this against
 *  the name, description, and tags written at upload time — there is no
 *  per-supplier filter, so this is the only way to narrow toward a supplier. */
function ElandQueryBox({ disabled }: { disabled: boolean }) {
  const [value, setValue] = useState(elandQueryStore.current);
  return (
    <div className="space-y-1.5">
      <label htmlFor="eland-query" className="text-muted-foreground text-xs font-medium">
        Optional text query (matches name / description / tags on the-eland.co)
      </label>
      <Input
        id="eland-query"
        type="text"
        value={value}
        disabled={disabled}
        maxLength={200}
        placeholder="e.g. woven navy elastic"
        onChange={(event) => {
          setValue(event.target.value);
          elandQueryStore.current = event.target.value;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
    </div>
  );
}

function RankedMatchCard({
  rankedMatch,
  rank,
  selected,
  onCompare,
}: {
  rankedMatch: RankedMatch;
  rank: number;
  selected: boolean;
  onCompare: () => void;
}) {
  const { item, match, supplier } = rankedMatch;
  const confidence = confidenceLabel(match.cosine);
  const isRemote = Boolean(match.remoteImageUrl ?? match.remoteThumbnailUrl ?? match.remoteName);
  const cardImageSrc =
    match.remoteThumbnailUrl ?? match.remoteImageUrl ?? item?.variant.image.url ?? "";
  const cardImageAlt = match.remoteName ?? item?.variant.image.name ?? "Match image";
  const cardTitle = match.remoteName ?? item?.product.subject ?? "Match";
  const cardSubtitle = isRemote
    ? `Score ${match.cosine.toFixed(3)} · ranked #${rank} on the-eland.co${
        match.cosine < 0.5 ? " · weak overall — top rank may still not be a true match" : ""
      }`
    : `Score ${match.cosine.toFixed(3)} · ranked #${rank} for this supplier${
        match.cosine < 0.5 ? " · weak overall — top rank may still not be a true match" : ""
      }`;
  const cardTags: string[] = isRemote
    ? (match.remoteTags ?? []).slice(0, 6)
    : [item?.variant.image.name, item?.variant.material, item?.variant.colorNotes].filter(
        (value): value is string => Boolean(value),
      );
  return (
    <article
      className={cn(
        "bg-card grid gap-4 rounded-xl border p-3 shadow-sm transition-shadow hover:shadow-md md:grid-cols-[8rem_minmax(0,1fr)_auto]",
        rank === 1 && "border-amber-500/45 ring-1 ring-amber-500/15",
      )}
    >
      <div className="bg-muted relative aspect-square overflow-hidden rounded-lg border">
        {cardImageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cardImageSrc} alt={cardImageAlt} className="size-full object-contain" />
        ) : (
          <div className="text-muted-foreground grid size-full place-items-center p-2 text-center text-[0.65rem]">
            No image
          </div>
        )}
        <span className="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-black/75 text-xs font-bold text-white ring-1 ring-white/25">
          {rank}
        </span>
      </div>

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {rank === 1 ? (
            <Badge className="bg-amber-500 text-black hover:bg-amber-500">
              <Sparkles /> Best match
            </Badge>
          ) : null}
          <Badge variant="outline" className={confidence.className}>
            {confidence.label}
          </Badge>
          {supplier ? <Badge variant="secondary">{supplier.company.companyName}</Badge> : null}
          {item ? (
            <Badge variant="outline">
              {getWorkspaceProductTypeLabel(item.product.productType)}
            </Badge>
          ) : null}
          {isRemote ? <Badge variant="outline">the-eland.co</Badge> : null}
        </div>
        <div>
          <p className="truncate font-semibold">{cardTitle}</p>
          <p className="text-muted-foreground line-clamp-2 text-sm leading-5">{cardSubtitle}</p>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-1 text-[0.68rem]">
          {cardTags.map((tag) => (
            <span key={tag} className="bg-muted rounded-md px-2 py-1">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="flex min-w-32 flex-row items-center justify-between gap-3 md:flex-col md:items-end">
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {Math.round(match.similarity)}
            <span className="text-muted-foreground text-xs">%</span>
          </p>
          <SimilarityMeter value={match.similarity} />
        </div>
        <Button type="button" variant={rank === 1 ? "default" : "outline"} onClick={onCompare}>
          {selected ? <Check /> : <Eye />}
          {selected ? "Selected" : "Compare"}
        </Button>
      </div>
    </article>
  );
}

export function SupplierImageManagementDialog({
  products,
  suppliers,
  isCatalogLoading = false,
  catalogError = null,
  currentSupplierId = null,
  selectedItemId = null,
  engine = "picture-sherlock",
  trigger,
  onSelect,
}: SupplierImageManagementDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [queryImage, setQueryImage] = useState<SupplierMatchQueryImage | null>(null);
  const [comparisonMatchId, setComparisonMatchId] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const matchMutation = useSupplierImageMatch();

  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  );
  const galleryItems = useMemo(
    () =>
      getProductImageGalleryItems(products).filter(
        (item) =>
          item.product.ownerKind === "supplier" &&
          item.product.supplierId !== null &&
          supplierById.has(item.product.supplierId) &&
          isSupplierProductType(item.product.productType),
      ),
    [products, supplierById],
  );
  const catalog = useMemo<SupplierMatchCatalogItem[]>(
    () =>
      galleryItems.flatMap((item) => {
        const supplierId = item.product.supplierId;
        const supplier = supplierId ? supplierById.get(supplierId) : undefined;
        if (!supplier || !isSupplierProductType(item.product.productType)) return [];
        return [
          {
            catalogItemId: item.id,
            supplierId: supplier.id,
            supplierName: supplier.company.companyName,
            productId: item.product.id,
            productSubject: item.product.subject,
            productType: item.product.productType,
            variantId: item.variant.id,
            imageName: item.variant.image.name,
            imageUrl: item.variant.image.url,
            detail: item.product.detail,
            material: item.variant.material,
            colorNotes: item.variant.colorNotes,
            parameters: item.variant.parameters,
          },
        ];
      }),
    [galleryItems, supplierById],
  );
  const galleryById = useMemo(
    () => new Map(galleryItems.map((item) => [item.id, item])),
    [galleryItems],
  );
  const selectedSupplierName = suppliers[0]?.company.companyName ?? null;
  const catalogLimitError =
    catalog.length > MAX_SUPPLIER_MATCH_CATALOG_IMAGES
      ? `This catalog has ${catalog.length} images. Narrow it to ${MAX_SUPPLIER_MATCH_CATALOG_IMAGES} or fewer before image search.`
      : null;
  const blockingCatalogError = catalogError ?? catalogLimitError;

  const rankedMatches = useMemo<RankedMatch[]>(() => {
    if (!matchMutation.data) return [];
    if (engine === "eland") {
      // eland returns its own opaque ids (not local catalog ids), so there is
      // no gallery join — render each match straight from the remote fields.
      return matchMutation.data.matches.map((match) => ({ match, item: null, supplier: null }));
    }
    const raw = matchMutation.data.matches.flatMap((match) => {
      const item = galleryById.get(match.catalogItemId);
      const supplierId = item?.product.supplierId;
      const supplier = supplierId ? supplierById.get(supplierId) : undefined;
      return item && supplier ? [{ match, item, supplier }] : [];
    });
    if ((engine !== "local" && engine !== "labelstash") || raw.length < 2) return raw;

    // The local embedding's cosine sits in a narrow band near 1.0 for any two
    // natural photos, so the raw percentage reads as ~99% for everything. For
    // the local engine only, rescale each search's cosines onto a [50, 98]%
    // band so the best match surfaces at the top and weak matches read weak.
    // The footer still shows the raw cosine so the underlying score is honest.
    const cosines = raw.map((entry) => entry.match.cosine);
    const min = Math.min(...cosines);
    const max = Math.max(...cosines);
    const span = max - min;
    if (span <= 1e-6) return raw;
    const TARGET_TOP = 98;
    const TARGET_BOTTOM = 50;
    return raw.map((entry) => {
      const t = (entry.match.cosine - min) / span;
      const rescaled = TARGET_BOTTOM + t * (TARGET_TOP - TARGET_BOTTOM);
      return { ...entry, match: { ...entry.match, similarity: Math.round(rescaled * 100) / 100 } };
    });
  }, [galleryById, matchMutation.data, supplierById, engine]);
  const comparisonMatch = useMemo(
    () =>
      rankedMatches.find((entry) => entry.match.catalogItemId === comparisonMatchId) ?? null,
    [comparisonMatchId, rankedMatches],
  );

  async function runMatch(nextQueryImage: SupplierMatchQueryImage) {
    setUploadError(null);
    if (engine === "eland") {
      if (!currentSupplierId || isCatalogLoading || Boolean(blockingCatalogError)) {
        setUploadError(
          blockingCatalogError ??
            (!currentSupplierId
              ? "Select a supplier before searching the-eland.co."
              : isCatalogLoading
                ? "Wait for the supplier catalog to finish loading."
                : "Resolve the catalog error before searching."),
        );
        return;
      }
    } else if (!currentSupplierId || isCatalogLoading || blockingCatalogError || catalog.length === 0) {
      setUploadError(
        blockingCatalogError ??
          (!currentSupplierId
            ? "Select a supplier before searching its product images."
            : isCatalogLoading
              ? "Wait for the supplier catalog to finish loading."
              : "Add a supplier product image before searching."),
      );
      return;
    }
    await matchMutation.mutateAsync({
      queryImage: nextQueryImage,
      catalog,
      currentSupplierId,
      engine,
      query: engine === "eland" ? elandQueryStore.current.trim() || undefined : undefined,
    });
  }

  async function chooseFile(file: File) {
    if (busy) {
      setUploadError("Wait for the current image search to finish before replacing it.");
      return;
    }
    const metadata = supplierMatchUploadMetadataSchema.safeParse({
      name: file.name,
      size: file.size,
      type: file.type,
    });
    if (!metadata.success) {
      setUploadError(metadata.error.issues[0]?.message ?? "Choose a valid image.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    matchMutation.reset();
    setComparisonMatchId(null);
    try {
      const uploaded = await uploadImage(file);
      const nextQueryImage = { name: metadata.data.name, url: uploaded.url };
      setQueryImage(nextQueryImage);
      setIsUploading(false);
      await runMatch(nextQueryImage);
    } catch (error) {
      if (!matchMutation.isError) {
        setUploadError(error instanceof Error ? error.message : "Image upload failed.");
      }
    } finally {
      setIsUploading(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void chooseFile(file);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const imageItem = Array.from(event.clipboardData.items).find(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
    const imageFile = imageItem?.getAsFile();
    if (!imageFile) return;
    event.preventDefault();
    void chooseFile(imageFile);
  }

  function applyMatch(rankedMatch: RankedMatch): Promise<void> {
    setApplyError(null);
    // Local match → same fast path as before: no download, no persistence.
    if (rankedMatch.item) {
      onSelect(rankedMatch.item);
      setComparisonMatchId(null);
      setOpen(false);
      return Promise.resolve();
    }
    // Eland remote match → download the eland image, persist it into the app's
    // own storage (Supabase / local Postgres / data-URL), then hand a synthetic
    // gallery item (carrying the persisted URL) to onSelect. eland URLs are
    // opaque and may change, so we never leave an eland URL on the node.
    if (!rankedMatch.match.remoteImageUrl) {
      setApplyError("This the-eland.co entry has no downloadable image.");
      return Promise.resolve();
    }
    if (!currentSupplierId) {
      setApplyError("Select a supplier before applying an the-eland.co image.");
      return Promise.resolve();
    }
    // Default to the small thumbnail when present to keep the download cheap;
    // fall back to the original if the thumbnail is missing (may be null).
    const downloadUrl =
      rankedMatch.match.remoteThumbnailUrl ?? rankedMatch.match.remoteImageUrl;
    // Derive a sensible product type for the synthetic item: prefer the
    // supplier's first catalog type for the current supplier; fall back to a
    // known default so the field is non-null.
    const fallbackProductType: SupplierProductType =
      (galleryItems.find((g) => g.product.supplierId === currentSupplierId)?.product
        .productType as SupplierProductType | undefined) ?? "woven-label";

    setIsApplying(true);
    return persistGeneratedImage(downloadUrl)
      .then((persisted) => {
        const synthetic = buildElandGalleryItem(
          rankedMatch.match,
          persisted,
          currentSupplierId,
          fallbackProductType,
        );
        onSelect(synthetic);
        setComparisonMatchId(null);
        setOpen(false);
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? `Could not download the image from the-eland.co: ${error.message}`
            : "Could not download the image from the-eland.co.";
        setApplyError(message);
      })
      .finally(() => setIsApplying(false));
  }

  function openComparison(rankedMatch: RankedMatch) {
    setComparisonMatchId(rankedMatch.match.catalogItemId);
  }

  const searchError =
    uploadError ?? (matchMutation.error instanceof Error ? matchMutation.error.message : null);
  const busy = isUploading || matchMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Block dismissal while a download/persist is in flight so the user
        // can't walk away mid-apply on an eland match.
        if (!nextOpen && isApplying) return;
        setOpen(nextOpen);
        if (!nextOpen) {
          setComparisonMatchId(null);
          setApplyError(null);
        }
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent
        className="h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_1fr] overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)]"
        onPaste={handlePaste}
      >
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={
                engine === "milvus"
                  ? "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200"
                  : engine === "local"
                    ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-800 dark:text-yellow-200"
                    : engine === "labelstash"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                      : engine === "eland"
                        ? "border-violet-500/30 bg-violet-500/10 text-violet-800 dark:text-violet-200"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
              }
              variant="outline"
            >
              <Eye />{" "}
              {engine === "milvus"
                ? "Milvus vector search"
                : engine === "local"
                  ? "Local image search"
                  : engine === "labelstash"
                    ? "LabelStash-style search"
                    : engine === "eland"
                      ? "the-eland.co portal search"
                      : "Image search"}
            </Badge>
            {catalog.length ? (
              <span className="text-muted-foreground text-xs">
                {catalog.length} image{catalog.length === 1 ? "" : "s"}
                {selectedSupplierName ? ` - ${selectedSupplierName}` : ""}
              </span>
            ) : null}
          </div>
          <DialogTitle className="text-xl">
            {engine === "milvus"
              ? "Search similar images with Milvus"
              : engine === "local"
                ? "Search similar supplier product images (local)"
                : engine === "labelstash"
                  ? "Search this supplier by reference image"
                  : engine === "eland"
                    ? "Search the-eland.co by reference image"
                    : "Search similar supplier images"}
          </DialogTitle>
          <DialogDescription>
            {engine === "milvus"
              ? "Upload a reference image. CLIP embeddings are indexed in Milvus Lite and ranked by cosine similarity within this supplier's catalog."
              : engine === "local"
                ? "Upload a reference image. Runs entirely on this server using local embeddings — no Python sidecar required. Matches are ranked best-similarity-first within the selected supplier's catalog."
                : engine === "labelstash"
                  ? "Upload a reference image. It is compared against the selected supplier's local product images and ranked highest-to-lowest similarity. No image leaves your machine — this runs locally."
                  : engine === "eland"
                    ? "Upload a reference image. It is sent to the-eland.co with your portal API key and matched against images your organization previously uploaded at /portal/upload (then indexed). Add a text query to narrow by name, description or tags. Empty results mean nothing is indexed yet — that is normal after a fresh upload."
                    : "Upload a reference image. Search only the selected supplier's product images and rank matches from highest to lowest similarity."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative grid min-h-0 lg:grid-cols-[minmax(19rem,0.34fr)_minmax(0,1fr)]">
          <aside className="bg-muted/25 flex min-h-0 flex-col gap-4 overflow-y-auto border-b p-5 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-muted-foreground font-mono text-[0.65rem] tracking-[0.18em] uppercase">
                  Reference / 01
                </p>
                <p className="font-heading font-semibold">Target image</p>
              </div>
              {queryImage ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                >
                  <RefreshCw /> Replace
                </Button>
              ) : null}
            </div>

            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void chooseFile(file);
              }}
            />

            {queryImage ? (
              <div
                className={cn(
                  "bg-card relative overflow-hidden rounded-xl border shadow-sm transition-colors",
                  isDragging && "border-amber-500 ring-2 ring-amber-500/20",
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%)] bg-size-[16px_16px] p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={queryImage.url}
                    alt={`Uploaded reference: ${queryImage.name}`}
                    className="mx-auto aspect-square max-h-80 w-full rounded-lg object-contain"
                  />
                </div>
                <div className="flex items-center gap-2 border-t px-3 py-2">
                  <Check className="size-4 text-emerald-600" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {queryImage.name}
                  </span>
                </div>
                {isDragging ? (
                  <div className="absolute inset-0 grid place-items-center bg-amber-500/15 p-4 backdrop-blur-sm">
                    <div className="rounded-lg bg-black/80 px-4 py-3 text-center text-sm font-semibold text-white shadow-xl">
                      Drop to replace target image
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className={cn(
                  "bg-card flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border border-dashed p-6 text-center transition-colors",
                  isDragging && "border-amber-500 bg-amber-500/5",
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="grid size-14 place-items-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  <Upload className="size-6" />
                </div>
                <div className="space-y-1">
                  <p className="font-heading font-semibold">Drop a product reference</p>
                  <p className="text-muted-foreground text-xs leading-5">
                    JPG, PNG, or WebP · up to 12 MB · or paste with Ctrl/Cmd+V
                  </p>
                </div>
                <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
                  <Upload /> Choose image
                </Button>
              </div>
            )}

            {searchError ? (
              <div
                className="border-destructive/30 bg-destructive/5 text-destructive flex gap-2 rounded-lg border p-3 text-sm"
                role="alert"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{searchError}</span>
              </div>
            ) : null}

            {engine === "eland" ? (
              <ElandQueryBox disabled={busy} />
            ) : null}

            {queryImage ? (
              <p className="text-muted-foreground text-center text-xs">
                Drop another image on the preview, or paste with Ctrl/Cmd+V, to replace it.
              </p>
            ) : null}

            {queryImage && !busy ? (
              <Button
                type="button"
                className="w-full"
                disabled={
                  engine === "eland"
                    ? !currentSupplierId || Boolean(blockingCatalogError)
                    : !currentSupplierId || Boolean(blockingCatalogError) || catalog.length === 0
                }
                onClick={() => void runMatch(queryImage)}
              >
                <Eye /> {matchMutation.data ? "Search again" : "Search similar images"}
              </Button>
            ) : null}

            <div className="text-muted-foreground mt-auto flex gap-2 border-t pt-4 text-xs leading-5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <p>
                {engine === "milvus"
                  ? "Search is limited to the selected supplier's images. When the Milvus sidecar is running, CLIP embeddings are indexed in Milvus Lite and ranked by cosine similarity; otherwise the local histogram fallback is used. No external LLM analysis."
                  : engine === "local"
                    ? "Search is limited to the selected supplier's images. Matches run entirely on this server using local embeddings — no Python sidecar required. No external LLM analysis."
                    : engine === "labelstash"
                      ? "Search is limited to the selected supplier's local product images. Matches run entirely on this server using local visual embeddings — no external service is called, nothing is uploaded. The score is a relative ranking signal, shown as % for layout parity."
                      : engine === "eland"
                        ? "Your reference image and optional query are sent to the-eland.co with your portal API key. Results come from images your organization previously uploaded at /portal/upload (and indexed) — the API has no per-supplier filter, so narrow with the query box (matches name/description/tags). Scores are a relative ranking signal, not a percentage."
                        : "Search is limited to the selected supplier's images. When the CLIP sidecar is running, matches use multi-view visual embeddings plus local feature matching for crop-from-product cases; otherwise the local histogram fallback is used. No external LLM analysis."}
              </p>
            </div>
          </aside>

          <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5" aria-busy={busy}>
            {isCatalogLoading || blockingCatalogError || catalog.length === 0 ? (
              <CatalogUnavailable loading={isCatalogLoading} error={blockingCatalogError} />
            ) : busy ? (
              isUploading ? (
                <div className="grid min-h-72 place-items-center" role="status" aria-live="polite">
                  <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                    Preparing your reference image…
                  </span>
                </div>
              ) : (
                <SearchLoading imageCount={catalog.length} />
              )
            ) : matchMutation.data && rankedMatches.length ? (
              <>
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-amber-800 dark:text-amber-200">
                    <Eye className="size-4" />
                    <p className="font-heading text-sm font-semibold">Vector search complete</p>
                    <Badge
                      variant="outline"
                      className="border-amber-500/30 bg-background/70 text-amber-900 dark:text-amber-100"
                    >
                      {matchEngineLabel(matchMutation.data.model)}
                    </Badge>
                  </div>
                  <p className="text-sm leading-6">
                    {engine === "eland"
                      ? `the-eland.co returned ${matchMutation.data.searchedCount} match${
                          matchMutation.data.searchedCount === 1 ? "" : "es"
                        } for your reference image. Results are ranked by the portal similarity score (higher is closer). Empty future results mean nothing is indexed yet — that is normal after a fresh /portal/upload.`
                      : `Compared your reference against ${matchMutation.data.searchedCount} image${
                          matchMutation.data.searchedCount === 1 ? "" : "s"
                        } from ${selectedSupplierName ?? "the selected supplier"}. Results are ranked by fused visual + color score (higher is closer). Weak top scores mean no catalog photo is a close match — inspect more than #1.`}
                  </p>
                  <p className="text-muted-foreground mt-2 font-mono text-[0.68rem]">
                    model: {matchMutation.data.model}
                  </p>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="font-heading font-semibold">Most similar images</p>
                    <p className="text-muted-foreground text-xs">
                      {engine === "eland"
                        ? `${matchMutation.data.searchedCount} match${
                            matchMutation.data.searchedCount === 1 ? "" : "es"
                          } from the-eland.co · ranked highest to lowest score`
                        : `${matchMutation.data.searchedCount} images searched · ranked highest to lowest score`}
                    </p>
                  </div>
                  <Badge variant="outline">{matchEngineLabel(matchMutation.data.model)}</Badge>
                </div>

                <div className="grid gap-3">
                  {rankedMatches.map((rankedMatch, index) => (
                    <RankedMatchCard
                      key={rankedMatch.match.catalogItemId}
                      rankedMatch={rankedMatch}
                      rank={index + 1}
                      selected={selectedItemId === rankedMatch.match.catalogItemId}
                      onCompare={() => openComparison(rankedMatch)}
                    />
                  ))}
                </div>
              </>
            ) : matchMutation.data && engine === "eland" ? (
              <ElandEmptyResults portalUploadUrl={matchMutation.data.portalUploadUrl} />
            ) : searchError ? (
              <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-8 text-center">
                <div className="max-w-md space-y-3">
                  <AlertCircle className="text-destructive mx-auto size-9" />
                  <p className="font-heading font-semibold">Search could not finish</p>
                  <p className="text-muted-foreground text-sm leading-6">{searchError}</p>
                  {queryImage ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void runMatch(queryImage)}
                    >
                      <RefreshCw /> Try again
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="grid min-h-72 flex-1 place-items-center rounded-xl border border-dashed p-8 text-center">
                <div className="max-w-md space-y-4">
                  <div className="bg-muted mx-auto grid size-16 place-items-center rounded-full">
                    <Eye className="text-muted-foreground size-7" />
                  </div>
                  <div className="space-y-2">
                    <p className="font-heading text-lg font-semibold">
                      Ready to search this supplier
                    </p>
                    <p className="text-muted-foreground text-sm leading-6">
                      Upload one target image on the left. Matches are limited to this supplier&apos;s
                      product images and ranked from highest to lowest similarity.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {comparisonMatch ? (
            <div
              className="absolute inset-0 z-30 bg-black/60 p-4 backdrop-blur-sm"
              role="presentation"
              onClick={() => setComparisonMatchId(null)}
            >
              <div
                className="bg-background mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-label="Image comparison"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="border-b px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
                        Compare preview
                      </p>
                      <h3 className="font-heading text-lg font-semibold">
                        Target image and selected similar image
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {Math.round(comparisonMatch.match.similarity)}% similarity
                      </Badge>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Close comparison"
                        title="Close comparison"
                        onClick={() => setComparisonMatchId(null)}
                      >
                        <X />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-2">
                  {(() => {
                    const comparedImageSrc =
                      comparisonMatch.match.remoteThumbnailUrl ??
                      comparisonMatch.match.remoteImageUrl ??
                      comparisonMatch.item?.variant.image.url ??
                      "";
                    const comparedImageAlt =
                      comparisonMatch.match.remoteName ??
                      comparisonMatch.item?.variant.image.name ??
                      "Compared image";
                    const comparedFields = comparisonMatch.item
                      ? buildComparisonFields(comparisonMatch.item)
                      : buildElandComparisonFields(comparisonMatch.match);
                    return [
                      {
                        title: "Target image",
                        subtitle: queryImage?.name ?? "Uploaded reference",
                        src: queryImage?.url ?? comparedImageSrc,
                        alt: queryImage?.name ?? "Target image",
                        // Target is an uploaded reference only — do not copy product
                        // metadata from the compared catalog item.
                        fields: [] as ComparisonField[],
                      },
                      {
                        title: "Compared image",
                        subtitle:
                          comparisonMatch.match.remoteName ??
                          comparisonMatch.item?.variant.image.name ??
                          "the-eland.co match",
                        src: comparedImageSrc,
                        alt: comparedImageAlt,
                        fields: comparedFields,
                      },
                    ];
                  })().map((panel) => (
                    <section
                      key={panel.title}
                      className="bg-muted/20 flex min-h-0 flex-col overflow-hidden rounded-xl border"
                    >
                      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-muted-foreground text-xs uppercase tracking-[0.16em]">
                            {panel.title}
                          </p>
                          <p className="truncate text-sm font-medium">{panel.subtitle}</p>
                        </div>
                        {panel.title === "Compared image" && comparisonMatch.supplier ? (
                          <Badge variant="secondary">
                            {comparisonMatch.supplier.company.companyName}
                          </Badge>
                        ) : null}
                        {panel.title === "Compared image" && !comparisonMatch.item ? (
                          <Badge variant="outline">the-eland.co</Badge>
                        ) : null}
                      </div>
                      <div className="grid min-h-0 flex-1 gap-4 p-4">
                        <div className="bg-background min-h-[18rem] overflow-hidden rounded-lg border">
                          {panel.src ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={panel.src}
                              alt={panel.alt}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <div className="text-muted-foreground grid h-full place-items-center p-4 text-center text-sm">
                              No image available
                            </div>
                          )}
                        </div>
                        {panel.fields.length ? (
                          <dl className="grid grid-cols-2 gap-2">
                            {panel.fields.map((field) => (
                              <div
                                key={field.label}
                                className="rounded-lg border bg-background px-3 py-2"
                              >
                                <dt className="text-muted-foreground text-[0.65rem] uppercase tracking-[0.14em]">
                                  {field.label}
                                </dt>
                                <dd className="truncate text-sm font-medium">{field.value}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="bg-muted/30 flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
                  <div className="min-w-0 space-y-1">
                    <p className="text-muted-foreground text-sm">
                      {isApplying
                        ? "Downloading and saving the image from the-eland.co…"
                        : "Review the pair, then apply the selected image."}
                    </p>
                    {applyError ? (
                      <p className="text-sm font-medium text-destructive">{applyError}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setComparisonMatchId(null)}
                      disabled={isApplying}
                    >
                      Keep browsing
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        // applyMatch is async for eland matches (download →
                        // persist → onSelect). It closes the compare overlay
                        // and the dialog itself on success; on failure it
                        // leaves both open with `applyError` shown above.
                        void applyMatch(comparisonMatch);
                      }}
                      disabled={
                        isApplying ||
                        (comparisonMatch.item
                          ? selectedItemId === comparisonMatch.item.id
                          : !comparisonMatch.match.remoteImageUrl)
                      }
                    >
                      {isApplying
                        ? "Saving…"
                        : comparisonMatch.item
                          ? selectedItemId === comparisonMatch.item.id
                            ? "Already selected"
                            : "Use this image"
                          : !comparisonMatch.match.remoteImageUrl
                            ? "No source image"
                            : "Use this image"}
                      {isApplying ? (
                        <LoaderCircle
                          className="ml-2 size-4 animate-spin motion-reduce:animate-none"
                          aria-hidden
                        />
                      ) : null}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
