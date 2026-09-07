import type { Canvas, ImageRecord, Project } from "@/lib/store";
import type { CanvasContent, CanvasEdge, CanvasNode } from "@/lib/nodes/types";
import { getPantoneCatalogLabel, type PantoneCatalog } from "@/lib/nodes/pantone";
import {
  getWorkspaceProductTypeLabel,
  type CustomerRecord,
  type ProductRecord,
  type ProductVariantRecord,
  type SupplierRecord,
} from "@/lib/workspace-records";

export interface CanvasReportImage {
  url: string | null;
  alt: string;
}

export interface CanvasReportTable {
  columns: string[];
  rows: Array<{
    label: string;
    image?: CanvasReportImage | null;
    values: string[];
  }>;
}

export interface CanvasReportBlock {
  id: string;
  title: string;
  subtitle?: string;
  details: Array<{ label: string; value: string }>;
  table?: CanvasReportTable;
  image: CanvasReportImage | null;
}

export interface CanvasReportStep {
  id: string;
  title: string;
  detail: string;
}

export interface CanvasReportSection {
  id: string;
  title: string;
  blocks: CanvasReportBlock[];
  pageBreakBefore?: boolean;
}

export interface CanvasReport {
  schemaVersion: 2;
  title: string;
  generatedAt: string;
  send?: CanvasReportSendInfo;
  project: {
    id: string;
    name: string;
    customerName: string;
    employeeName: string;
    employeeTitle: string;
    employeeEmail: string;
    employeeTel: string;
    currency: string;
    destination: string;
  };
  canvas: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  customerProducts: CanvasReportBlock[];
  supplierBlocks: CanvasReportBlock[];
  pantoneBlocks: CanvasReportBlock[];
  genericBlocks: CanvasReportBlock[];
  outputBlocks: CanvasReportBlock[];
  supplierBreakdowns: CanvasReportBlock[];
  sections: CanvasReportSection[];
  steps: CanvasReportStep[];
  html: string;
  text: string;
}

export interface CanvasReportSendInfo {
  sequence: string;
  reportUrl: string;
  approvalUrl: string;
  rejectionUrl: string;
  qrCodeDataUrl: string | null;
  selectedImageIds?: readonly string[];
}

export interface BuildCanvasReportInput {
  canvas: Pick<
    Canvas,
    "id" | "projectId" | "name" | "content" | "createdAt" | "updatedAt"
  >;
  project: Project | null;
  customers: readonly CustomerRecord[];
  suppliers: readonly SupplierRecord[];
  products: readonly ProductRecord[];
  images: readonly ImageRecord[];
  send?: CanvasReportSendInfo;
  filterSupplierId?: string;
}

function toIso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown): string | null {
  const normalized = stringValue(value);
  return normalized ? normalized : null;
}

function boundedString(value: string, fallback: string, maxLength: number): string {
  const normalized = value.trim() || fallback;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function imageAlt(value: string, fallback: string): string {
  return boundedString(value, fallback, 300);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isPantoneCatalog(value: string): value is PantoneCatalog {
  return [
    "solid-coated",
    "solid-uncoated",
    "fhi-tcx",
    "fhi-tpg",
    "metallics-coated",
    "premium-metallics-coated",
    "pastels-neons-coated",
    "pastels-neons-uncoated",
    "color-bridge-coated",
    "color-bridge-uncoated",
  ].includes(value);
}

function normalizedHex(value: string): `#${string}` | null {
  const trimmed = value.trim();
  const match = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  return match ? `#${match[1]?.toLowerCase()}` : null;
}

function crc32(bytes: readonly number[]): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: readonly number[]): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function uint32Bytes(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function pngChunk(type: string, data: readonly number[]): number[] {
  const typeBytes = Array.from(type).map((character) => character.charCodeAt(0));
  return [
    ...uint32Bytes(data.length),
    ...typeBytes,
    ...data,
    ...uint32Bytes(crc32([...typeBytes, ...data])),
  ];
}

function bytesToBase64(bytes: readonly number[]): string {
  let binary = "";
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function zlibStoredBlock(bytes: readonly number[]): number[] {
  const output = [0x78, 0x01];
  for (let index = 0; index < bytes.length; index += 65535) {
    const chunk = bytes.slice(index, index + 65535);
    const isFinal = index + 65535 >= bytes.length;
    const length = chunk.length;
    output.push(isFinal ? 1 : 0, length & 255, (length >>> 8) & 255);
    const nlen = ~length & 0xffff;
    output.push(nlen & 255, (nlen >>> 8) & 255, ...chunk);
  }
  output.push(...uint32Bytes(adler32(bytes)));
  return output;
}

function solidColorPngDataUrl(hex: `#${string}`): string {
  const width = 64;
  const height = 36;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const raw: number[] = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0);
    for (let x = 0; x < width; x += 1) {
      raw.push(r, g, b);
    }
  }
  const png = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", [...uint32Bytes(width), ...uint32Bytes(height), 8, 2, 0, 0, 0]),
    ...pngChunk("IDAT", zlibStoredBlock(raw)),
    ...pngChunk("IEND", []),
  ];
  return `data:image/png;base64,${bytesToBase64(png)}`;
}

function lineBreaks(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function labelFromKey(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (first) => first.toUpperCase());
}

function primaryVariant(product: ProductRecord | null): ProductVariantRecord | null {
  return product?.variants[0] ?? null;
}

function variantImage(variant: ProductVariantRecord | null): CanvasReportImage | null {
  if (!variant?.image?.url) return null;
  return { url: variant.image.url, alt: imageAlt(variant.image.name, "Product image") };
}

function parameterDetails(variant: ProductVariantRecord | null) {
  if (!variant) return [];
  return Object.entries(variant.parameters)
    .filter(([, value]) => value.trim())
    .map(([label, value]) => ({ label: labelFromKey(label), value }));
}

function productDetails(product: ProductRecord, ownerName: string): CanvasReportBlock["details"] {
  const variant = primaryVariant(product);
  return [
    { label: "Owner", value: ownerName },
    { label: "Product type", value: getWorkspaceProductTypeLabel(product.productType) },
    { label: "Internal code", value: product.subject },
    { label: "Product details", value: product.detail },
    ...(variant
      ? [
          { label: "Material", value: variant.material },
          { label: "Color notes", value: variant.colorNotes },
          { label: "Production cost", value: `${variant.unitPrice} ${variant.priceUnit}` },
        ]
      : []),
    ...parameterDetails(variant),
  ].filter((item) => typeof item.value === "string" && item.value.trim());
}

function byNodePosition(left: CanvasNode, right: CanvasNode): number {
  const y = left.position.y - right.position.y;
  return Math.abs(y) > 24 ? y : left.position.x - right.position.x;
}

function linkedLabel(nodesById: Map<string, CanvasNode>, edge: CanvasEdge): string {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  return `${nodeTitle(source)} -> ${nodeTitle(target)}`;
}

function connectedNodeIds(edges: readonly CanvasEdge[], nodeId: string): string[] {
  const ids = new Set<string>();
  edges.forEach((edge) => {
    if (edge.source === nodeId) ids.add(edge.target);
    if (edge.target === nodeId) ids.add(edge.source);
  });
  return [...ids];
}

function findOutputForSource(
  sourceNodeId: string,
  nodesById: Map<string, CanvasNode>,
  edges: readonly CanvasEdge[],
): CanvasNode | null {
  const queue = connectedNodeIds(edges, sourceNodeId);
  const seen = new Set<string>([sourceNodeId]);

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || seen.has(nodeId)) continue;
    seen.add(nodeId);

    const node = nodesById.get(nodeId);
    if (!node) continue;
    if (node.type === "imageOutput" && nullableString(asRecord(node.data).resultUrl)) return node;

    if (
      node.type === "generate" ||
      node.type === "imageOutput" ||
      node.type === "pantone" ||
      node.type === "suppler" ||
      node.type === "product" ||
      node.type === "imageInput" ||
      node.type === "painted"
    ) {
      queue.push(...connectedNodeIds(edges, nodeId).filter((id) => !seen.has(id)));
    }
  }

  return null;
}

function outputBlockForNode(node: CanvasNode): CanvasReportBlock {
  const data = asRecord(node.data);
  const prompt = stringValue(data.prompt);
  return {
    id: `output-${node.id}`,
    title: node.type === "generate" ? "Input prompt" : "Output",
    details: [
      { label: "Node", value: nodeTitle(node) },
      { label: "Input prompt", value: prompt },
      { label: "Model", value: stringValue(data.model) },
      { label: "Status", value: stringValue(data.status) },
      {
        label: "Created time",
        value: nullableString(data.createdAt) ? formatDateTime(stringValue(data.createdAt)) : "",
      },
      { label: "Output format", value: stringValue(data.outputFormat) },
    ].filter((item) => item.value),
    image: nullableString(data.resultUrl)
      ? {
          url: nullableString(data.resultUrl),
          alt: imageAlt(
            node.type === "generate" ? "Generated image" : "Output image",
            "Output image",
          ),
        }
      : null,
  };
}

function finalOutputImage(outputBlocks: readonly CanvasReportBlock[]): CanvasReportImage | null {
  return [...outputBlocks].reverse().find((block) => block.image?.url)?.image ?? null;
}

function selectedRenderImage(
  images: readonly ImageRecord[],
  selectedImageIds?: readonly string[],
): CanvasReportImage | null {
  if (selectedImageIds && selectedImageIds.length > 0) {
    const selected = images.filter((image) => selectedImageIds.includes(image.id));
    const image = [...selected].reverse().find((candidate) => candidate.url.trim());
    if (image) {
      return {
        url: image.url,
        alt: imageAlt(image.prompt || "Selected render image", "Selected render image"),
      };
    }
  }
  const image = [...images].reverse().find((candidate) => candidate.url.trim());
  if (!image) return null;
  return {
    url: image.url,
    alt: imageAlt(image.prompt || "Selected render image", "Selected render image"),
  };
}

function parseQuantityAmount(value: string): {
  prefix: string;
  amount: number;
  suffix: string;
} | null {
  const match = /^\s*([^\d.-]*)\s*(-?\d+(?:\.\d+)?)\s*(.*?)\s*$/.exec(value);
  if (!match) return null;
  const amount = Number(match[2]);
  if (!Number.isFinite(amount)) return null;
  return {
    prefix: match[1]?.trim() ?? "",
    amount,
    suffix: match[3]?.trim() ?? "",
  };
}

function formatQuantityAmount(prefix: string, amount: number, suffix: string): string {
  const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return [prefix, formatted, suffix].filter(Boolean).join(" ");
}

function detailValue(
  block: CanvasReportBlock,
  labels: readonly string[],
): { raw: string; parsed: ReturnType<typeof parseQuantityAmount> } | null {
  const normalizedLabels = new Set(labels.map((label) => label.toLocaleLowerCase()));
  const raw =
    block.details.find((detail) => normalizedLabels.has(detail.label.toLocaleLowerCase()))?.value ??
    "";
  if (!raw) return null;
  return { raw, parsed: parseQuantityAmount(raw) };
}

function totalTableValue(
  values: readonly { raw: string; parsed: ReturnType<typeof parseQuantityAmount> }[],
  mode: "sum" | "max",
): string {
  const parsedValues = values
    .map((value) => value.parsed)
    .filter(
      (value): value is NonNullable<ReturnType<typeof parseQuantityAmount>> => value !== null,
    );

  if (parsedValues.length === 0) return "—";

  const prefixes = new Set(parsedValues.map((value) => value.prefix));
  const suffixes = new Set(parsedValues.map((value) => value.suffix));
  const prefix = prefixes.size === 1 ? (parsedValues[0]?.prefix ?? "") : "";
  const suffix = suffixes.size === 1 ? (parsedValues[0]?.suffix ?? "") : "mixed units";
  const total =
    mode === "max"
      ? Math.max(...parsedValues.map((value) => value.amount))
      : parsedValues.reduce((sum, value) => sum + value.amount, 0);

  return formatQuantityAmount(prefix, total, suffix);
}

function supplierBreakdownTable(supplierBlocks: readonly CanvasReportBlock[]): CanvasReportTable {
  const metrics = [
    {
      label: "Sample cost",
      labels: ["Sample charge", "Sample cost"],
      mode: "sum" as const,
    },
    {
      label: "Sample lead time",
      labels: ["Sample lead time"],
      mode: "max" as const,
    },
    {
      label: "Bulk cost",
      labels: ["Production cost", "Bulk cost", "Unit price"],
      mode: "sum" as const,
    },
    {
      label: "Bulk lead time",
      labels: ["Bulk lead time", "Production lead time", "Product lead time"],
      mode: "max" as const,
    },
  ];
  const supplierRows = supplierBlocks.map((block) => ({
    label: block.title,
    image: block.image,
    values: metrics.map((metric) => detailValue(block, metric.labels)?.raw ?? "—"),
  }));
  const totalRow = {
    label: "Total",
    image: null,
    values: metrics.map((metric) =>
      totalTableValue(
        supplierBlocks
          .map((block) => detailValue(block, metric.labels))
          .filter(
            (value): value is { raw: string; parsed: ReturnType<typeof parseQuantityAmount> } =>
              value !== null,
          ),
        metric.mode,
      ),
    ),
  };

  return {
    columns: metrics.map((metric) => metric.label),
    rows: [...supplierRows, totalRow],
  };
}

function nodeTitle(node: CanvasNode | undefined): string {
  if (!node) return "Unknown node";
  const data = asRecord(node.data);
  const alias = stringValue(data.alias);
  const label = stringValue(data.label);
  const prompt = stringValue(data.prompt);
  const productSubject = stringValue(data.productSubject);
  const genericName = stringValue(data.genericDefinitionName);
  if (alias) return `@${alias}`;
  if (productSubject) return productSubject;
  if (genericName) return genericName;
  if (label) return label;
  if (prompt) return "Generate prompt";
  return node.type;
}

function blockHtml(block: CanvasReportBlock): string {
  const isSupplierBreakdown = block.id === "supplier-total-breakdown";
  const isSupplierDetail = block.id.startsWith("supplier-") && !isSupplierBreakdown;
  const supplierTable = block.table
    ? `<table class="supplier-matrix"><thead><tr><th>Supplier</th><th>Image</th>${block.table.columns
        .map((column) => `<th>${escapeHtml(column)}</th>`)
        .join("")}</tr></thead><tbody>${block.table.rows
        .map(
          (row) =>
            `<tr><th>${escapeHtml(row.label)}</th><td class="matrix-image-cell">${
              row.image?.url
                ? `<img class="matrix-thumb" src="${escapeHtml(row.image.url)}" alt="${escapeHtml(row.image.alt)}">`
                : "—"
            }</td>${row.values.map((value) => `<td>${lineBreaks(value)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table>`
    : "";
  const details = block.details
    .map((detail, index) => {
      const rowClass =
        isSupplierBreakdown && index <= 2 && detail.label.toLocaleLowerCase().startsWith("total ")
          ? ' class="total-row"'
          : "";
      return `<tr${rowClass}><th>${escapeHtml(detail.label)}</th><td>${lineBreaks(detail.value)}</td></tr>`;
    })
    .join("");
  const image = block.image?.url
    ? `<div class="image"><img src="${escapeHtml(block.image.url)}" alt="${escapeHtml(block.image.alt)}"></div>`
    : `<div class="image empty">No image</div>`;
  if (isSupplierDetail) {
    return `<article class="block supplier-detail-block"><div class="supplier-detail-image">${image}</div><div class="details"><h3>${escapeHtml(block.title)}</h3>${block.subtitle ? `<p>${escapeHtml(block.subtitle)}</p>` : ""}<table>${details}</table></div></article>`;
  }
  return `<article class="block${isSupplierBreakdown ? " breakdown-block" : ""}"><div class="details"><h3>${escapeHtml(block.title)}</h3>${block.subtitle ? `<p>${escapeHtml(block.subtitle)}</p>` : ""}${supplierTable}<table${isSupplierBreakdown ? ' class="breakdown-table"' : ""}>${details}</table></div>${image}</article>`;
}

function makeHtml(report: Omit<CanvasReport, "html" | "text">): string {
  const pageCss = `
    body{font-family:Arial,sans-serif;color:#151515;margin:0;background:#f6f5f2}
    .page{max-width:960px;margin:0 auto;background:#fff;padding:28px}
    header{border-bottom:1px solid #ddd;padding-bottom:16px;margin-bottom:22px}
    h1{font-size:24px;margin:0 0 8px} h2{font-size:16px;margin:28px 0 12px}
    h3{font-size:14px;margin:0 0 6px} p{margin:0;color:#555}
    .meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 18px;font-size:12px}
    .block{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(220px,.75fr);gap:16px;border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:12px;break-inside:avoid}
    .supplier-detail-block{display:block}
    .supplier-detail-block .supplier-detail-image{margin-bottom:12px}
    .supplier-detail-block .image{min-height:210px}
    .supplier-detail-block .image img{max-height:320px}
    table{width:100%;border-collapse:collapse;font-size:12px} th{width:34%;text-align:left;color:#666;font-weight:600;vertical-align:top;padding:5px 8px 5px 0} td{padding:5px 0;vertical-align:top}
    .breakdown-block{border-color:#d9c9a3;background:#fffdf8}
    .breakdown-table th{width:52%;padding:8px 10px;border-top:1px solid #eee}
    .breakdown-table td{padding:8px 10px;border-top:1px solid #eee}
    .breakdown-table .total-row th,.breakdown-table .total-row td{background:#f5ead0;color:#111;font-weight:700;border-top:0;border-bottom:1px solid #decda6}
    .supplier-matrix{margin:10px 0 12px;border:1px solid #decda6}
    .supplier-matrix th,.supplier-matrix td{border:1px solid #eadfca;padding:8px;text-align:left}
    .supplier-matrix thead th{background:#f5ead0;color:#111;font-weight:700}
    .supplier-matrix tbody th{background:#fff8ea;color:#333;font-weight:700}
    .supplier-matrix tbody tr:last-child th,.supplier-matrix tbody tr:last-child td{background:#fff4d8;font-weight:700}
    .supplier-matrix .matrix-image-cell{width:72px;text-align:center}
    .supplier-matrix .matrix-thumb{width:56px;height:42px;object-fit:contain;border-radius:4px;background:#f1f1ef}
    .image{min-height:160px;background:#f1f1ef;border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#777;font-size:12px}
    img{max-width:100%;max-height:260px;object-fit:contain}
    .page-break{break-before:page;border-top:1px solid #ddd;margin-top:32px;padding-top:8px}
    .steps{font-size:12px;margin:0;padding-left:20px}.steps li{margin-bottom:8px}
    .approval{display:grid;grid-template-columns:minmax(0,1fr) 128px;gap:16px;align-items:center;border:1px solid #ddd;border-radius:8px;padding:12px;margin:0 0 18px;background:#fafafa}
    .approval a{color:#0f5eb8}.approval img{width:128px;height:128px}
    @media print{body{background:#fff}.page{padding:18mm}.block{page-break-inside:avoid}.page-break{page-break-before:always}}
  `;
  const project = report.project;
  const sections = report.sections
    .filter((section) => section.blocks.length > 0)
    .map(
      (section) =>
        `<section${section.pageBreakBefore ? ' class="page-break"' : ""}><h2>${escapeHtml(section.title)}</h2>${section.blocks.map(blockHtml).join("")}</section>`,
    )
    .join("");
  const send = report.send
    ? `<section class="approval"><div><h2>Canvas QR reference</h2><p><strong>Reference:</strong> ${escapeHtml(report.send.sequence)}</p><p><strong>Project:</strong> ${escapeHtml(project.name)}</p><p><strong>Canvas:</strong> ${escapeHtml(report.canvas.name)}</p><p><strong>Relationship:</strong> ${escapeHtml(project.name)} &rarr; ${escapeHtml(report.canvas.name)} &rarr; ${escapeHtml(report.send.sequence)}</p><p><strong>Scan:</strong> <a href="${escapeHtml(report.send.reportUrl)}">Open this canvas report</a></p><p><strong>Approve:</strong> <a href="${escapeHtml(report.send.approvalUrl)}">Confirm approval</a></p><p><strong>Reject:</strong> <a href="${escapeHtml(report.send.rejectionUrl)}">Reject canvas</a></p></div>${report.send.qrCodeDataUrl ? `<img src="${escapeHtml(report.send.qrCodeDataUrl)}" alt="QR code for canvas ${escapeHtml(report.canvas.name)} in project ${escapeHtml(project.name)}, reference ${escapeHtml(report.send.sequence)}">` : ""}</section>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${pageCss}</style></head><body><div class="page"><header><h1>${escapeHtml(report.title)}</h1><div class="meta">
    <span><strong>Project:</strong> ${escapeHtml(project.name)}</span>
    <span><strong>Canvas:</strong> ${escapeHtml(report.canvas.name)}</span>
    <span><strong>Customer:</strong> ${escapeHtml(project.customerName)}</span>
    <span><strong>Contact:</strong> ${escapeHtml([project.employeeName, project.employeeTitle].filter(Boolean).join(" / "))}</span>
    <span><strong>Email:</strong> ${escapeHtml(project.employeeEmail)}</span>
    <span><strong>Tel:</strong> ${escapeHtml(project.employeeTel)}</span>
    <span><strong>Currency:</strong> ${escapeHtml(project.currency)}</span>
    <span><strong>Delivery destination:</strong> ${escapeHtml(project.destination)}</span>
    <span><strong>Generated:</strong> ${escapeHtml(formatDateTime(report.generatedAt))}</span>
  </div></header>
  ${send}
  ${sections}
  ${report.steps.length > 0 ? `<section><h2>Canvas log</h2><ol class="steps">${report.steps.map((step) => `<li><strong>${escapeHtml(step.title)}</strong><br>${lineBreaks(step.detail)}</li>`).join("")}</ol></section>` : ""}
  </div></body></html>`;
}

function makeText(report: Omit<CanvasReport, "html" | "text">): string {
  const lines = [
    report.title,
    ...(report.send
      ? [
          `Canvas report reference: ${report.send.sequence}`,
          `Relationship: ${report.project.name} -> ${report.canvas.name} -> ${report.send.sequence}`,
          `Scan URL: ${report.send.reportUrl}`,
          `Approve: ${report.send.approvalUrl}`,
          `Reject: ${report.send.rejectionUrl}`,
        ]
      : []),
    `Project: ${report.project.name}`,
    `Canvas: ${report.canvas.name}`,
    `Customer: ${report.project.customerName}`,
    `Contact: ${[report.project.employeeName, report.project.employeeTitle].filter(Boolean).join(" / ")}`,
    `Email: ${report.project.employeeEmail}`,
    `Currency: ${report.project.currency}`,
    `Delivery destination: ${report.project.destination}`,
    "",
  ];
  for (const section of report.sections) {
    if (section.blocks.length === 0) continue;
    lines.push(section.title);
    for (const block of section.blocks) {
      lines.push(`- ${block.title}`);
      if (block.table) {
        lines.push(["Supplier", "Image", ...block.table.columns].join(" | "));
        block.table.rows.forEach((row) =>
          lines.push([row.label, row.image?.url ? "Yes" : "—", ...row.values].join(" | ")),
        );
      }
      block.details.forEach((detail) => lines.push(`  ${detail.label}: ${detail.value}`));
      if (block.image?.url) lines.push(`  Image: ${block.image.url}`);
    }
    lines.push("");
  }
  if (report.steps.length > 0) {
    lines.push("Canvas log");
    report.steps.forEach((step, index) =>
      lines.push(`${index + 1}. ${step.title}: ${step.detail}`),
    );
  }
  return lines.join("\n");
}

export function buildCanvasReport(input: BuildCanvasReportInput): CanvasReport {
  const content: CanvasContent = input.canvas.content;
  const nodes = content.nodes.slice().sort(byNodePosition);
  const nodesById = new Map(content.nodes.map((node) => [node.id, node] as const));
  const productsById = new Map(input.products.map((product) => [product.id, product] as const));
  const suppliersById = new Map(
    input.suppliers.map((supplier) => [supplier.id, supplier] as const),
  );
  const customer = input.project?.customerId
    ? (input.customers.find((candidate) => candidate.id === input.project?.customerId) ?? null)
    : null;

  const productNodes = nodes.filter((node) => node.type === "product");
  const productNodeProducts = productNodes.map((node) => {
    const data = asRecord(node.data);
    const product = nullableString(data.productId)
      ? (productsById.get(nullableString(data.productId) ?? "") ?? null)
      : null;
    const variant =
      product?.variants.find((item) => item.id === stringValue(data.variantId)) ??
      primaryVariant(product ?? null);
    const customerName =
      stringValue(data.customerName) ||
      customer?.company.companyName ||
      input.project?.customerName ||
      "Customer";
    return {
      id: `product-${node.id}`,
      title:
        product?.subject ||
        stringValue(data.productSubject) ||
        stringValue(data.alias) ||
        "Product node",
      subtitle: product ? getWorkspaceProductTypeLabel(product.productType) : nodeTitle(node),
      details: product
        ? productDetails(product, customerName)
        : [
            { label: "Alias", value: stringValue(data.alias) },
            { label: "Customer", value: customerName },
            { label: "Product", value: stringValue(data.productSubject) },
          ].filter((item) => item.value),
      image:
        (nullableString(data.variantImageUrl)
          ? {
              url: nullableString(data.variantImageUrl),
              alt: imageAlt(stringValue(data.variantImageName), "Product image"),
            }
          : null) ?? variantImage(variant),
    };
  });
  const customerProducts = productNodeProducts;

  const supplierNodes = nodes.filter((node) => node.type === "suppler");
  const nodeIds = new Set(content.nodes.map((node) => node.id));
  const adjacency = new Map<string, Set<string>>();
  for (const edge of content.edges) {
    if (!edge.source || !edge.target) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    adjacency.get(edge.source)!.add(edge.target);
  }
  const generateNodeIds = new Set(
    nodes.filter((node) => node.type === "generate").map((node) => node.id),
  );
  const reachesGenerate = new Set<string>();
  const stack = [...generateNodeIds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachesGenerate.has(id)) continue;
    reachesGenerate.add(id);
    for (const source of adjacency.keys()) {
      if (adjacency.get(source)!.has(id)) {
        stack.push(source);
      }
    }
  }
  const connectedSupplierNodes = supplierNodes.filter((node) => reachesGenerate.has(node.id));
  const filteredSupplierNodes = input.filterSupplierId
    ? connectedSupplierNodes.filter(
        (node) => stringValue(asRecord(node.data).supplierId) === input.filterSupplierId,
      )
    : connectedSupplierNodes;
  const supplierBlocks = filteredSupplierNodes.map((node) => {
    const data = asRecord(node.data);
    const supplier = nullableString(data.supplierId)
      ? (suppliersById.get(nullableString(data.supplierId) ?? "") ?? null)
      : null;
    const product = nullableString(data.productId)
      ? (productsById.get(nullableString(data.productId) ?? "") ?? null)
      : null;
    const variant =
      product?.variants.find((item) => item.id === stringValue(data.variantId)) ??
      primaryVariant(product ?? null);
    const supplierName = supplier?.company.companyName ?? stringValue(data.supplierName);
    return {
      id: `supplier-${node.id}`,
      title: stringValue(data.supplierName) || supplier?.company.companyName || "Supplier node",
      subtitle: nodeTitle(node),
      details: product
        ? productDetails(product, supplierName || "Supplier")
        : [
            { label: "Alias", value: stringValue(data.alias) },
            { label: "Supplier", value: stringValue(data.supplierName) },
            { label: "Product", value: stringValue(data.productSubject) },
          ].filter((item) => item.value),
      image:
        variantImage(variant) ??
        (nullableString(data.variantImageUrl)
          ? {
              url: nullableString(data.variantImageUrl),
              alt: imageAlt(stringValue(data.variantImageName), "Supplier image"),
            }
          : null),
    };
  });

  const pantoneBlocks = nodes
    .filter((node) => node.type === "pantone")
    .map((node) => {
      const data = asRecord(node.data);
      const code = stringValue(data.code);
      const hex = normalizedHex(stringValue(data.hex));
      const catalogValue = stringValue(data.catalog);
      const catalogLabel = isPantoneCatalog(catalogValue)
        ? getPantoneCatalogLabel(catalogValue)
        : "Pantone";
      const title = code
        ? `Pantone ${code} ${catalogLabel.toLocaleLowerCase()}`
        : stringValue(data.alias) || "Pantone";
      return {
        id: `pantone-${node.id}`,
        title,
        details: [
          { label: "Alias", value: stringValue(data.alias) },
          { label: "Code", value: code },
          { label: "Name", value: stringValue(data.name) },
          { label: "Catalog", value: catalogLabel },
          { label: "Hex", value: hex ?? stringValue(data.hex) },
        ].filter((item) => item.value),
        image: hex
          ? { url: solidColorPngDataUrl(hex), alt: imageAlt(`${title} ${hex}`, title) }
          : null,
      };
    });

  const genericBlocks = nodes
    .filter(
      (node) =>
        node.type === "imageInput" &&
        (stringValue(asRecord(node.data).genericDefinitionName) ||
          nullableString(asRecord(node.data).imageUrl)),
    )
    .map((node) => {
      const data = asRecord(node.data);
      const genericName = stringValue(data.genericDefinitionName);
      const alias = stringValue(data.alias);
      return {
        id: `generic-${node.id}`,
        title: genericName || alias || "Input image",
        subtitle: alias ? `@${alias}` : undefined,
        details: [
          { label: "Alias", value: alias },
          { label: "Node", value: genericName || "Input image" },
        ].filter((item) => item.value),
        image: nullableString(data.imageUrl)
          ? {
              url: nullableString(data.imageUrl),
              alt: imageAlt(alias, genericName ? "Generic node image" : "Input image"),
            }
          : null,
      };
    });

  // Painted nodes carry a single resolved main image (paste/drop override or a
  // promoted wired source) — surface them as an image-bearing block, like the
  // generic/imageInput blocks above.
  const paintedBlocks = nodes
    .filter((node) => node.type === "painted")
    .map((node) => {
      const data = asRecord(node.data);
      const alias = stringValue(data.alias);
      const imageUrl = nullableString(data.mainImageUrl);
      return {
        id: `painted-${node.id}`,
        title: "Painted image",
        subtitle: alias ? `@${alias}` : undefined,
        details: [{ label: "Alias", value: alias }].filter((item) => item.value),
        image: imageUrl ? { url: imageUrl, alt: imageAlt(alias, "Painted image") } : null,
      };
    });

  const outputBlocks = nodes.filter((node) => node.type === "imageOutput").map(outputBlockForNode);
  const reportImage = selectedRenderImage(
    input.images,
    input.send?.selectedImageIds,
  ) ?? finalOutputImage(outputBlocks);

  const supplierBreakdowns: CanvasReportBlock[] =
    supplierBlocks.length > 0
      ? [
          {
            id: "supplier-total-breakdown",
            title: "Supplier total breakdown",
            subtitle: supplierBlocks.map((block) => block.subtitle ?? block.title).join(" + "),
            details: [],
            table: supplierBreakdownTable(supplierBlocks),
            image: reportImage,
          },
        ]
      : [];

  const sections: CanvasReportSection[] = [
    { id: "supplier-breakdown", title: "Supplier breakdown", blocks: supplierBreakdowns },
    { id: "customer-products", title: "Product list", blocks: customerProducts },
    { id: "supplier-details", title: "Supplier details", blocks: supplierBlocks },
    { id: "pantone", title: "Pantone", blocks: pantoneBlocks },
    { id: "generic-node", title: "Generic node", blocks: genericBlocks },
    { id: "painted", title: "Painted images", blocks: paintedBlocks },
    {
      id: "output-prompt",
      title: "Output and input prompt",
      blocks: outputBlocks,
      pageBreakBefore: true,
    },
  ];

  const logNodes = nodes.filter(
    (node) => node.type !== "generate" || findOutputForSource(node.id, nodesById, content.edges),
  );
  const steps: CanvasReportStep[] = [
    ...logNodes.map((node, index) => ({
      id: `node-${node.id}`,
      title: `${index + 1}. ${node.type} node`,
      detail:
        node.type === "generate"
          ? `Created Generate node with prompt: ${stringValue(asRecord(node.data).prompt) || "No prompt entered."}`
          : node.type === "imageOutput" && nullableString(asRecord(node.data).createdAt)
            ? `Created ${nodeTitle(node)} at ${formatDateTime(stringValue(asRecord(node.data).createdAt))}.`
            : `Created ${nodeTitle(node)}.`,
    })),
    ...content.edges.map((edge, index) => ({
      id: `edge-${edge.id}`,
      title: `Link ${index + 1}`,
      detail: linkedLabel(nodesById, edge),
    })),
    ...input.images.map((image, index) => ({
      id: `image-${image.id}`,
      title: `Render ${index + 1}`,
      detail: `${formatDateTime(image.createdAt)}${image.prompt ? ` - ${image.prompt}` : ""}`,
    })),
  ];

  const baseReport: Omit<CanvasReport, "html" | "text"> = {
    schemaVersion: 2,
    title: `${input.canvas.name} canvas report`,
    generatedAt: new Date().toISOString(),
    send: input.send,
    project: {
      id: input.project?.id ?? input.canvas.projectId,
      name: input.project?.name ?? "Project",
      customerName: input.project?.customerName ?? customer?.company.companyName ?? "Not set",
      employeeName: input.project?.employeeName ?? "Not set",
      employeeTitle: input.project?.employeeTitle ?? "",
      employeeEmail: input.project?.employeeEmail ?? "Not set",
      employeeTel: input.project?.employeeTel ?? "Not set",
      currency:
        [input.project?.currencyCode, input.project?.currencySymbol].filter(Boolean).join(" ") ||
        "Not set",
      destination: input.project?.destinationCountryName ?? "Not set",
    },
    canvas: {
      id: input.canvas.id,
      name: input.canvas.name,
      createdAt: toIso(input.canvas.createdAt),
      updatedAt: toIso(input.canvas.updatedAt),
    },
    customerProducts,
    supplierBlocks,
    pantoneBlocks,
    genericBlocks,
    outputBlocks,
    supplierBreakdowns,
    sections,
    steps,
  };

  return {
    ...baseReport,
    html: makeHtml(baseReport),
    text: makeText(baseReport),
  };
}
