"use client";

import { type NodeProps } from "@xyflow/react";
import { BookOpen, Database, Eye, Globe, ImageIcon, Package, Search, Shapes, X, Zap } from "lucide-react";

import { ImagePreviewDialog } from "@/components/image-preview-dialog";
import { ProductImageBrowserDialog } from "@/components/product-image-browser-dialog";
import { SupplierImageManagementDialog } from "@/components/canvas/supplier-image-management-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProducts, useSuppliers } from "@/lib/hooks/use-workspace-records";
import {
  getProductImageGalleryItems,
  type ProductImageGalleryItem,
} from "@/lib/product-image-gallery";
import { NODE_PORT_COLORS } from "@/lib/nodes/ports";
import type { SupplerCanvasNode } from "@/lib/nodes/types";
import {
  supplierProductTypeLabels,
  supplierProductTypes,
  isSupplierProductType,
  type SupplierProductType,
} from "@/lib/workspace-records";
import { cn } from "@/lib/utils";
import { useCanvasActions, useConnectionHighlight, useGroupAccent } from "../canvas-context";
import { NodeDeleteButton } from "./delete-button";
import { InputPort, OutputPort } from "./port";
import { ResizeHandle } from "./resize-handle";

const DEFAULT_WIDTH = 280;
const DEFAULT_HEIGHT = 420;

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function fuzzyIncludes(value: string, query: string): boolean {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return true;
  const normalizedValue = normalizeQuery(value);
  if (normalizedValue.includes(normalizedQuery)) return true;

  let queryIndex = 0;
  for (const character of normalizedValue) {
    if (character === normalizedQuery[queryIndex]) queryIndex += 1;
    if (queryIndex === normalizedQuery.length) return true;
  }
  return false;
}

export function SupplerNode({ id, data, parentId, selected }: NodeProps<SupplerCanvasNode>) {
  const { updateNodeData } = useCanvasActions();
  const highlight = useConnectionHighlight(id);
  const accent = useGroupAccent(parentId);
  const suppliers = useSuppliers();
  const products = useProducts();
  const width = data.width ?? DEFAULT_WIDTH;
  const height = data.height ?? DEFAULT_HEIGHT;
  const selectedProductType = data.selectedProductType;
  const productTypeQuery = data.productTypeQuery ?? "";
  const supplierQuery = data.supplierQuery ?? "";
  const alias = typeof data.alias === "string" ? data.alias : "supplier";
  const supplierProducts = (products.data ?? []).filter(
    (product) => product.ownerKind === "supplier",
  );
  const selectedSupplier = (suppliers.data ?? []).find(
    (supplier) => supplier.id === data.supplierId,
  );
  const selectedSupplierCatalogProducts = supplierProducts.filter(
    (product) => product.supplierId === data.supplierId,
  );
  const selectedSupplierProducts = supplierProducts.filter(
    (product) =>
      product.supplierId === data.supplierId &&
      (!selectedProductType || product.productType === selectedProductType),
  );
  const selectedGalleryItemId =
    data.productId && data.variantId ? `${data.productId}:${data.variantId}` : null;
  const selectedGalleryItems = getProductImageGalleryItems(selectedSupplierProducts);
  const selectedGalleryIndex = selectedGalleryItemId
    ? selectedGalleryItems.findIndex((item) => item.id === selectedGalleryItemId)
    : 0;
  const productTypes = supplierProductTypes.filter((productType) =>
    fuzzyIncludes(supplierProductTypeLabels[productType], productTypeQuery),
  );

  const matchingSuppliers = (suppliers.data ?? [])
    .filter((supplier) =>
      selectedProductType ? supplier.company.productTypes.includes(selectedProductType) : true,
    )
    .filter((supplier) =>
      fuzzyIncludes(
        [
          supplier.company.companyName,
          supplier.company.emailDomainSuffix,
          supplier.company.productTypes.map((type) => supplierProductTypeLabels[type]).join(" "),
        ].join(" "),
        supplierQuery,
      ),
    )
    .map((supplier) => {
      const variantCount = supplierProducts
        .filter(
          (product) =>
            product.supplierId === supplier.id &&
            (!selectedProductType || product.productType === selectedProductType),
        )
        .reduce(
          (total, product) =>
            total + product.variants.filter((variant) => variant.image !== null).length,
          0,
        );
      return { supplier, variantCount };
    });

  function selectProductType(productType: SupplierProductType) {
    updateNodeData(id, {
      selectedProductType: productType,
      productTypeQuery: supplierProductTypeLabels[productType],
      supplierId: null,
      supplierName: null,
      supplierQuery: "",
      productId: null,
      productSubject: null,
      variantId: null,
      variantImageUrl: null,
      variantImageName: null,
    });
  }

  function selectProductImage(item: ProductImageGalleryItem) {
    if (!isSupplierProductType(item.product.productType)) return;
    const supplier = (suppliers.data ?? []).find(
      (candidate) => candidate.id === item.product.supplierId,
    );
    const supplierName = supplier?.company.companyName ?? null;
    updateNodeData(id, {
      selectedProductType: item.product.productType,
      productTypeQuery: supplierProductTypeLabels[item.product.productType],
      supplierId: item.product.supplierId,
      supplierName,
      supplierQuery: supplierName ?? "",
      productId: item.product.id,
      productSubject: item.product.subject,
      variantId: item.variant.id,
      variantImageUrl: item.variant.image.url,
      variantImageName: item.variant.image.name,
    });
  }

  return (
    <div
      style={{
        width,
        height,
        ...(accent ? { outline: `2px solid ${accent}`, outlineOffset: 2 } : {}),
        ...highlight,
      }}
      className={cn(
        "group bg-card relative flex flex-col gap-3 overflow-hidden rounded-lg border p-3 shadow-md",
        selected && "ring-primary ring-offset-background shadow-lg ring-2 ring-offset-2",
      )}
    >
      <NodeDeleteButton id={id} />
      <InputPort color={NODE_PORT_COLORS.suppler} />
      <div className="flex items-center gap-2 pr-7 text-sm font-medium">
        <Package className="size-4" />
        Supplier
      </div>

      <Input
        data-new-node-focus-field
        value={alias}
        onChange={(event) => updateNodeData(id, { alias: event.target.value })}
        placeholder="alias (e.g. @supplier)"
        aria-label="Supplier image alias"
        className="nodrag h-8 text-xs"
      />

      <div className="grid gap-1.5">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={productTypeQuery}
            onChange={(event) =>
              updateNodeData(id, {
                productTypeQuery: event.target.value,
                selectedProductType: null,
                supplierId: null,
                supplierName: null,
              })
            }
            placeholder="Search product type"
            aria-label="Search supplier product type"
            className="nodrag h-8 pl-7 text-xs"
          />
          {selectedProductType ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Clear product type"
              className="nodrag absolute top-1/2 right-1 size-6 -translate-y-1/2"
              onClick={() =>
                updateNodeData(id, {
                  selectedProductType: null,
                  productTypeQuery: "",
                  supplierId: null,
                  supplierName: null,
                  productId: null,
                  productSubject: null,
                  variantId: null,
                  variantImageUrl: null,
                  variantImageName: null,
                })
              }
            >
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
        <div className="bg-background max-h-28 overflow-y-auto rounded-md border">
          {productTypes.map((productType) => (
            <button
              key={productType}
              type="button"
              className={cn(
                "nodrag hover:bg-muted/50 flex w-full items-center justify-between px-2 py-1.5 text-left text-xs",
                selectedProductType === productType && "bg-muted",
              )}
              onClick={() => selectProductType(productType)}
            >
              <span>{supplierProductTypeLabels[productType]}</span>
            </button>
          ))}
          {productTypes.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">No product type found.</p>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-1.5">
        <Input
          value={supplierQuery}
          onChange={(event) => updateNodeData(id, { supplierQuery: event.target.value })}
          placeholder="Search matching supplier"
          aria-label="Search matching supplier"
          className="nodrag h-8 text-xs"
          disabled={!selectedProductType}
        />
        <div className="bg-background min-h-0 flex-1 overflow-y-auto rounded-md border">
          {!selectedProductType ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">
              Select one product type first.
            </p>
          ) : suppliers.isLoading || products.isLoading ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">Loading suppliers...</p>
          ) : matchingSuppliers.length ? (
            matchingSuppliers.map(({ supplier, variantCount }) => (
              <button
                key={supplier.id}
                type="button"
                className={cn(
                  "nodrag hover:bg-muted/50 flex w-full items-start justify-between gap-2 px-2 py-2 text-left text-xs",
                  data.supplierId === supplier.id && "bg-muted",
                )}
                onClick={() =>
                  updateNodeData(id, {
                    supplierId: supplier.id,
                    supplierName: supplier.company.companyName,
                    supplierQuery: supplier.company.companyName,
                    productId: null,
                    productSubject: null,
                    variantId: null,
                    variantImageUrl: null,
                    variantImageName: null,
                  })
                }
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{supplier.company.companyName}</span>
                  <span className="text-muted-foreground block truncate">
                    {variantCount} image{variantCount === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="text-muted-foreground px-2 py-3 text-xs">No matching supplier.</p>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground truncate text-xs">
            {data.supplierName ?? "No supplier selected"}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <SupplierImageManagementDialog
              products={selectedSupplierCatalogProducts}
              suppliers={selectedSupplier ? [selectedSupplier] : []}
              isCatalogLoading={suppliers.isLoading || products.isLoading}
              catalogError={
                !data.supplierId
                  ? "Select a supplier before searching its product images."
                  : suppliers.error instanceof Error
                    ? suppliers.error.message
                    : products.error instanceof Error
                      ? products.error.message
                      : null
              }
              currentSupplierId={data.supplierId}
              selectedItemId={selectedGalleryItemId}
              engine="picture-sherlock"
              onSelect={selectProductImage}
              trigger={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Search similar images for this supplier"
                  title="Search similar images for this supplier"
                  className="nodrag"
                >
                  <Eye />
                </Button>
              }
            />
            <SupplierImageManagementDialog
              products={selectedSupplierCatalogProducts}
              suppliers={selectedSupplier ? [selectedSupplier] : []}
              isCatalogLoading={suppliers.isLoading || products.isLoading}
              catalogError={
                !data.supplierId
                  ? "Select a supplier before searching its product images."
                  : suppliers.error instanceof Error
                    ? suppliers.error.message
                    : products.error instanceof Error
                      ? products.error.message
                      : null
              }
              currentSupplierId={data.supplierId}
              selectedItemId={selectedGalleryItemId}
              engine="milvus"
              onSelect={selectProductImage}
              trigger={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Search similar images with Milvus"
                  title="Search similar images with Milvus"
                  className="nodrag"
                >
                  <Database />
                </Button>
              }
            />
            <SupplierImageManagementDialog
              products={selectedSupplierCatalogProducts}
              suppliers={selectedSupplier ? [selectedSupplier] : []}
              isCatalogLoading={suppliers.isLoading || products.isLoading}
              catalogError={
                !data.supplierId
                  ? "Select a supplier before searching its product images."
                  : suppliers.error instanceof Error
                    ? suppliers.error.message
                    : products.error instanceof Error
                      ? products.error.message
                      : null
              }
              currentSupplierId={data.supplierId}
              selectedItemId={selectedGalleryItemId}
              engine="local"
              onSelect={selectProductImage}
              trigger={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Search similar supplier product images (local)"
                  title="Search similar supplier product images (local)"
                  className="nodrag"
                >
                  <Zap />
                </Button>
              }
            />
            <SupplierImageManagementDialog
              products={selectedSupplierCatalogProducts}
              suppliers={selectedSupplier ? [selectedSupplier] : []}
              isCatalogLoading={suppliers.isLoading || products.isLoading}
              catalogError={
                !data.supplierId
                  ? "Select a supplier before searching its product images."
                  : suppliers.error instanceof Error
                    ? suppliers.error.message
                    : products.error instanceof Error
                      ? products.error.message
                      : null
              }
              currentSupplierId={data.supplierId}
              selectedItemId={selectedGalleryItemId}
              engine="labelstash"
              onSelect={selectProductImage}
              trigger={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Search this supplier's catalog by image (LabelStash-style)"
                  title="Search this supplier's catalog by image (LabelStash-style)"
                  className="nodrag"
                >
                  <Shapes />
                </Button>
              }
            />
            <SupplierImageManagementDialog
              products={selectedSupplierCatalogProducts}
              suppliers={selectedSupplier ? [selectedSupplier] : []}
              isCatalogLoading={suppliers.isLoading || products.isLoading}
              catalogError={
                !data.supplierId
                  ? "Select a supplier before searching its product images."
                  : suppliers.error instanceof Error
                    ? suppliers.error.message
                    : products.error instanceof Error
                      ? products.error.message
                      : null
              }
              currentSupplierId={data.supplierId}
              selectedItemId={selectedGalleryItemId}
              engine="eland"
              onSelect={selectProductImage}
              trigger={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Search the-eland.co by reference image"
                  title="Search the-eland.co by reference image"
                  className="nodrag"
                >
                  <Globe />
                </Button>
              }
            />
            <SupplierImageManagementDialog
              products={selectedSupplierCatalogProducts}
              suppliers={selectedSupplier ? [selectedSupplier] : []}
              isCatalogLoading={suppliers.isLoading || products.isLoading}
              catalogError={
                !data.supplierId
                  ? "Select a supplier before searching its product images."
                  : suppliers.error instanceof Error
                    ? suppliers.error.message
                    : products.error instanceof Error
                      ? products.error.message
                      : null
              }
              currentSupplierId={data.supplierId}
              selectedItemId={selectedGalleryItemId}
              engine="gemini"
              onSelect={selectProductImage}
              trigger={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Search similar supplier product images with Gemini"
                  title="Search similar supplier product images with Gemini"
                  className="nodrag"
                >
                  <span aria-hidden className="text-xs font-bold leading-none">
                    G
                  </span>
                </Button>
              }
            />
            <SupplierImageManagementDialog
              products={selectedSupplierCatalogProducts}
              suppliers={selectedSupplier ? [selectedSupplier] : []}
              isCatalogLoading={suppliers.isLoading || products.isLoading}
              catalogError={
                !data.supplierId
                  ? "Select a supplier before searching its product images."
                  : suppliers.error instanceof Error
                    ? suppliers.error.message
                    : products.error instanceof Error
                      ? products.error.message
                      : null
              }
              currentSupplierId={data.supplierId}
              selectedItemId={selectedGalleryItemId}
              engine="gemini"
              onSelect={selectProductImage}
              trigger={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Search similar supplier product images"
                  title="Search similar supplier product images"
                  className="nodrag"
                >
                  <Search />
                </Button>
              }
            />
            {data.supplierId ? (
              <ProductImageBrowserDialog
                products={selectedSupplierProducts}
                title={`${data.supplierName ?? "Supplier"} product images`}
                selectedItemId={selectedGalleryItemId}
                onSelect={selectProductImage}
                trigger={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label="Open supplier product image book"
                    title="Open supplier product image book"
                    className="nodrag"
                    disabled={selectedSupplierProducts.length === 0}
                  >
                    <BookOpen />
                  </Button>
                }
              />
            ) : null}
          </div>
        </div>
        {data.variantImageUrl ? (
          <div className="bg-muted overflow-hidden rounded-md border">
            <ImagePreviewDialog
              src={data.variantImageUrl}
              alt={data.variantImageName ?? data.productSubject ?? "Selected supplier product"}
              title={data.productSubject ?? data.variantImageName ?? "Selected supplier image"}
              gallery={
                selectedGalleryItems.length
                  ? selectedGalleryItems.map((item) => ({
                      id: item.id,
                      src: item.variant.image.url,
                      alt: item.variant.image.name,
                    }))
                  : undefined
              }
              initialIndex={selectedGalleryIndex >= 0 ? selectedGalleryIndex : 0}
              selectedItemId={selectedGalleryItemId}
              selectLabel="Select image"
              selectedLabel="Selected"
              onSelect={(_item, index) => {
                const galleryItem = selectedGalleryItems[index];
                if (galleryItem) selectProductImage(galleryItem);
              }}
              masks={data.imageMasks ?? []}
              onMasksChange={(imageMasks) => updateNodeData(id, { imageMasks })}
              trigger={
                <button
                  type="button"
                  className="nodrag nopan focus-visible:ring-ring block w-full cursor-zoom-in overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  aria-label="Open selected supplier image preview"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={data.variantImageUrl}
                    alt={
                      data.variantImageName ?? data.productSubject ?? "Selected supplier product"
                    }
                    className="aspect-video w-full object-contain"
                  />
                </button>
              }
            />
            <div className="flex items-center justify-between gap-2 p-2">
              <span className="min-w-0 truncate text-xs font-medium">
                {data.productSubject ?? data.variantImageName ?? "Selected image"}
              </span>
              <span className="nodrag nopan shrink-0 truncate rounded bg-black/55 px-1 text-[0.6rem] text-white">
                @{alias}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Remove selected supplier image"
                className="nodrag"
                onClick={() =>
                  updateNodeData(id, {
                    productId: null,
                    productSubject: null,
                    variantId: null,
                    variantImageUrl: null,
                    variantImageName: null,
                  })
                }
              >
                <X />
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground bg-muted/50 grid min-h-20 place-items-center rounded-md border border-dashed text-xs">
            <span className="inline-flex items-center gap-2">
              <ImageIcon className="size-4" />
              Select image from book
            </span>
          </div>
        )}
      </div>

      <OutputPort color={NODE_PORT_COLORS.suppler} />
      <ResizeHandle nodeId={id} width={width} height={height} minWidth={240} minHeight={360} />
    </div>
  );
}
