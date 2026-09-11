import { EMPTY_CANVAS_CONTENT, type CanvasContent } from "@/lib/nodes/types";
import { mergeProjectMetadata } from "@/lib/project-metadata";
import {
  SAMPLE_STAGES,
  sampleOrderSchema,
  type SampleOrder,
  type SampleOrderUpdate,
  type SampleStage,
  type SampleUpdatePayload,
} from "@/lib/sample-orders";

import type {
  Canvas,
  CanvasSendRecord,
  CanvasStatus,
  CanvasStore,
  CreateCanvasSendInput,
  CreateCanvasInput,
  CreateProjectInput,
  ImageRecord,
  Project,
  ProjectUpdate,
  RecordImageInput,
  UpdateCanvasSendInput,
} from "./canvasStore";

/**
 * localStorage-backed CanvasStore. Used in local/demo mode (no Supabase keys).
 * Client-only: every method guards `window` so SSR is a no-op-safe import.
 */

const KEYS = {
  projects: "ica:projects",
  canvases: "ica:canvases",
  images: "ica:images",
  canvasSends: "ica:canvas-sends",
  sampleOrders: "ica:sample-orders",
} as const;

const DB_NAME = "ica:local-store";
const DB_VERSION = 2;
const CANVAS_CONTENT_STORE = "canvasContent";
const IMAGE_RECORD_STORE = "imageRecords";

function isInlineImageUrl(url: string): boolean {
  return url.startsWith("data:image/");
}

function isCanvasContent(value: unknown): value is CanvasContent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { nodes?: unknown; edges?: unknown };
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014)
  );
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openLocalDb(): Promise<IDBDatabase> {
  if (!canUseIndexedDb()) {
    return Promise.reject(new Error("Browser storage is not available"));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CANVAS_CONTENT_STORE)) {
        db.createObjectStore(CANVAS_CONTENT_STORE);
      }
      if (!db.objectStoreNames.contains(IMAGE_RECORD_STORE)) {
        db.createObjectStore(IMAGE_RECORD_STORE, { keyPath: "id" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to open browser storage"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function readCanvasContentFromIndexedDb(id: string): Promise<CanvasContent | null> {
  if (!canUseIndexedDb()) return null;

  const db = await openLocalDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(CANVAS_CONTENT_STORE, "readonly");
      const request = transaction.objectStore(CANVAS_CONTENT_STORE).get(id);
      request.onerror = () => reject(request.error ?? new Error("Failed to read canvas content"));
      request.onsuccess = () => {
        const result: unknown = request.result;
        resolve(isCanvasContent(result) ? result : null);
      };
    });
  } finally {
    db.close();
  }
}

async function writeCanvasContentToIndexedDb(id: string, content: CanvasContent): Promise<void> {
  const db = await openLocalDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CANVAS_CONTENT_STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Failed to save canvas content"));
      transaction.objectStore(CANVAS_CONTENT_STORE).put(content, id);
    });
  } finally {
    db.close();
  }
}

async function deleteCanvasContentFromIndexedDb(id: string): Promise<void> {
  if (!canUseIndexedDb()) return;

  const db = await openLocalDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CANVAS_CONTENT_STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Failed to delete canvas content"));
      transaction.objectStore(CANVAS_CONTENT_STORE).delete(id);
    });
  } finally {
    db.close();
  }
}

async function hydrateCanvasContent(canvas: Canvas): Promise<Canvas> {
  const offloadedContent = await readCanvasContentFromIndexedDb(canvas.id);
  return offloadedContent ? { ...canvas, content: offloadedContent } : canvas;
}

async function listImageRecordsFromIndexedDb(canvasId: string): Promise<ImageRecord[]> {
  if (!canUseIndexedDb()) return [];
  const db = await openLocalDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(IMAGE_RECORD_STORE, "readonly")
        .objectStore(IMAGE_RECORD_STORE)
        .getAll();
      request.onerror = () => reject(request.error ?? new Error("Failed to read rendered images"));
      request.onsuccess = () => {
        const records = Array.isArray(request.result) ? (request.result as ImageRecord[]) : [];
        resolve(
          records.filter((record) => record.canvasId === canvasId && record.source === "generated"),
        );
      };
    });
  } finally {
    db.close();
  }
}

async function writeImageRecordToIndexedDb(record: ImageRecord): Promise<void> {
  if (!canUseIndexedDb()) return;
  const db = await openLocalDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(IMAGE_RECORD_STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Failed to save rendered image"));
      transaction.objectStore(IMAGE_RECORD_STORE).put(record);
    });
  } finally {
    db.close();
  }
}

function withoutInlineContent(canvas: Canvas): Canvas {
  return { ...canvas, content: EMPTY_CANVAS_CONTENT };
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

const nowISO = () => new Date().toISOString();
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function delay<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

function normalizeProject(project: Project): Project {
  return {
    ...project,
    ...mergeProjectMetadata(project, project.description),
  };
}

function normalizeCanvas(canvas: Canvas): Canvas {
  return {
    ...canvas,
    status: canvas.status ?? "draft",
  };
}

function nextLocalSequence(records: readonly CanvasSendRecord[]): string {
  const max = records.reduce((value, record) => {
    const numeric = Number(record.sequence.replace(/^CA/, ""));
    return Number.isFinite(numeric) ? Math.max(value, numeric) : value;
  }, 0);
  return `CA${String(max + 1).padStart(6, "0")}`;
}

function readSampleOrders(): SampleOrder[] {
  return read<unknown[]>(KEYS.sampleOrders, []).flatMap((value) => {
    const parsed = sampleOrderSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function demoPayload(stage: SampleStage, index: number): SampleUpdatePayload {
  const date = `2026-${String((index % 9) + 1).padStart(2, "0")}-${String((index % 20) + 1).padStart(2, "0")}`;
  switch (stage) {
    case "pmc":
      return {
        stage,
        receivedBy: `PMC owner ${index + 1}`,
        pmcDate: date,
        notes: "Purchase order received.",
      };
    case "purchase":
      return {
        stage,
        materialItem: `Trim material ${index + 1}`,
        supplierReference: `SUP-${100 + index}`,
        orderedQuantity: 500 + index * 100,
        unit: "pcs",
        orderDate: date,
        expectedDeliveryDate: date,
      };
    case "production":
      return {
        stage,
        startDate: date,
        plannedFinishDate: date,
        notes: "Production started.",
      };
    case "quality_control":
      return {
        stage,
        qcStartDate: date,
        defectivePercent: index % 4,
        inspectedQuantity: 50,
        evidenceUrl: "",
      };
    case "package":
      return {
        stage,
        packagingStartDate: date,
        cartonCount: 20 + index,
        unitsPerCarton: 50,
        notes: "Packaging started.",
      };
    case "shipment":
      return {
        stage,
        carrier: index % 2 ? "DHL" : "FedEx",
        awb: `AWB${100000 + index}`,
        shipDate: date,
        eta: date,
        documentUrl: "",
      };
    case "invoice":
      return {
        stage,
        invoiceNumber: `INV-${202600 + index}`,
        invoiceDate: date,
        currency: "USD",
        amount: 1200 + index * 175,
        documentUrl: "",
      };
  }
}

export const localCanvasStore: CanvasStore = {
  // ── Projects ──────────────────────────────────────────────────────────
  async listProjects() {
    const projects = read<Project[]>(KEYS.projects, []).map(normalizeProject);
    return delay(projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  },

  async getProject(id) {
    const projects = read<Project[]>(KEYS.projects, []).map(normalizeProject);
    return delay(projects.find((p) => p.id === id) ?? null);
  },

  async createProject(input: CreateProjectInput) {
    const projects = read<Project[]>(KEYS.projects, []);
    const description = input.description?.trim() ?? null;
    const project: Project = {
      id: uid(),
      name: input.name.trim(),
      description,
      ...mergeProjectMetadata(input, description),
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    write(KEYS.projects, [project, ...projects]);
    return delay(project);
  },

  async updateProject(id, input: ProjectUpdate) {
    const projects = read<Project[]>(KEYS.projects, []);
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error("Project not found");
    const existing = normalizeProject(projects[idx]);
    const description = input.description !== undefined ? input.description : existing.description;
    const updated: Project = {
      ...existing,
      ...("name" in input && input.name !== undefined ? { name: input.name } : {}),
      ...("description" in input && input.description !== undefined
        ? { description: input.description }
        : {}),
      ...mergeProjectMetadata({ ...existing, ...input }, description),
      updatedAt: nowISO(),
    };
    projects[idx] = updated;
    write(KEYS.projects, projects);
    return delay(updated);
  },

  async deleteProject(id) {
    const projects = read<Project[]>(KEYS.projects, []);
    write(
      KEYS.projects,
      projects.filter((p) => p.id !== id),
    );
    // Cascade: drop canvases + their images.
    const canvases = read<Canvas[]>(KEYS.canvases, []).map(normalizeCanvas);
    const remaining = canvases.filter((c) => c.projectId !== id);
    write(KEYS.canvases, remaining);
    const deletedIds = new Set(canvases.filter((c) => c.projectId === id).map((c) => c.id));
    await Promise.all(
      [...deletedIds].map((canvasId) => deleteCanvasContentFromIndexedDb(canvasId)),
    );
    if (deletedIds.size > 0) {
      const images = read<ImageRecord[]>(KEYS.images, []);
      write(
        KEYS.images,
        images.filter((i) => !i.canvasId || !deletedIds.has(i.canvasId)),
      );
    }
  },

  // ── Canvases ──────────────────────────────────────────────────────────
  async listCanvases(projectId) {
    const canvases = read<Canvas[]>(KEYS.canvases, []);
    const filtered = canvases
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return Promise.all(filtered.map((canvas) => hydrateCanvasContent(canvas)));
  },

  async getCanvas(id) {
    const canvases = read<Canvas[]>(KEYS.canvases, []).map(normalizeCanvas);
    const canvas = canvases.find((c) => c.id === id) ?? null;
    return canvas ? hydrateCanvasContent(canvas) : delay(null);
  },

  async createCanvas(input: CreateCanvasInput) {
    const canvases = read<Canvas[]>(KEYS.canvases, []);
    const canvas: Canvas = {
      id: uid(),
      projectId: input.projectId,
      name: input.name.trim(),
      content: input.content ?? EMPTY_CANVAS_CONTENT,
      status: "draft",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    write(KEYS.canvases, [canvas, ...canvases]);
    return delay(canvas);
  },

  async renameCanvas(id, name) {
    const canvases = read<Canvas[]>(KEYS.canvases, []);
    const idx = canvases.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error("Canvas not found");
    canvases[idx] = { ...normalizeCanvas(canvases[idx]), name: name.trim(), updatedAt: nowISO() };
    write(KEYS.canvases, canvases);
    return delay(canvases[idx]);
  },

  async saveCanvasContent(id, content) {
    const canvases = read<Canvas[]>(KEYS.canvases, []);
    const idx = canvases.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error("Canvas not found");

    // Prefer metadata-only localStorage updates: strip inline content first so
    // we never JSON.stringify large node graphs (images/masks) into ica:canvases
    // when IndexedDB can hold the full payload.
    const baseMeta = withoutInlineContent(normalizeCanvas(canvases[idx]));
    const now = nowISO();
    canvases[idx] = { ...baseMeta, updatedAt: now };

    // Keep large, image-heavy canvas content out of synchronous localStorage.
    // IndexedDB uses structured cloning and does not require serializing the
    // entire canvas into the metadata blob on every autosave.
    if (canUseIndexedDb()) {
      try {
        await writeCanvasContentToIndexedDb(id, content);
        write(KEYS.canvases, canvases);
        return delay(undefined);
      } catch {
        // Fall through to the inline path when IndexedDB is unavailable or
        // fails, preserving local demo mode on restricted browsers.
      }
    }

    canvases[idx] = { ...canvases[idx], content };
    try {
      write(KEYS.canvases, canvases);
      await deleteCanvasContentFromIndexedDb(id);
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;

      await writeCanvasContentToIndexedDb(id, content);
      canvases[idx] = withoutInlineContent(canvases[idx]);
      try {
        write(KEYS.canvases, canvases);
      } catch (metadataError) {
        throw new Error(
          isQuotaExceededError(metadataError)
            ? "Canvas is too large for local browser storage. Delete unused local canvases or enable Supabase persistence."
            : "Failed to save canvas metadata.",
        );
      }
    }
    return delay(undefined);
  },

  async updateCanvasStatus(id: string, status: CanvasStatus) {
    const canvases = read<Canvas[]>(KEYS.canvases, []).map(normalizeCanvas);
    const idx = canvases.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error("Canvas not found");
    canvases[idx] = { ...canvases[idx], status, updatedAt: nowISO() };
    write(KEYS.canvases, canvases);
    return delay(canvases[idx]);
  },

  async deleteCanvas(id) {
    const canvases = read<Canvas[]>(KEYS.canvases, []);
    write(
      KEYS.canvases,
      canvases.filter((c) => c.id !== id),
    );
    await deleteCanvasContentFromIndexedDb(id);
    const images = read<ImageRecord[]>(KEYS.images, []);
    write(
      KEYS.images,
      images.filter((i) => i.canvasId !== id),
    );
    return delay(undefined);
  },

  async listCanvasSends(canvasId) {
    return delay(
      read<CanvasSendRecord[]>(KEYS.canvasSends, [])
        .filter((record) => record.canvasId === canvasId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },

  async createCanvasSend(input: CreateCanvasSendInput) {
    const records = read<CanvasSendRecord[]>(KEYS.canvasSends, []);
    const record: CanvasSendRecord = {
      id: uid(),
      canvasId: input.canvasId,
      sequence: nextLocalSequence(records),
      status: "awaiting_approval",
      recipientEmail: input.recipientEmail,
      reportUrl: input.reportUrl,
      approvalUrl: input.approvalUrl,
      rejectionUrl: input.rejectionUrl,
      qrCodeDataUrl: input.qrCodeDataUrl ?? null,
      selectedImageIds: input.selectedImageIds,
      reportSnapshot: input.reportSnapshot,
      createdAt: nowISO(),
      respondedAt: null,
    };
    write(KEYS.canvasSends, [record, ...records]);
    return delay(record);
  },

  async updateCanvasSend(id: string, input: UpdateCanvasSendInput) {
    const records = read<CanvasSendRecord[]>(KEYS.canvasSends, []);
    const idx = records.findIndex((record) => record.id === id);
    if (idx === -1) throw new Error("Canvas send record not found");
    records[idx] = {
      ...records[idx],
      ...(input.reportUrl !== undefined ? { reportUrl: input.reportUrl } : {}),
      ...(input.approvalUrl !== undefined ? { approvalUrl: input.approvalUrl } : {}),
      ...(input.rejectionUrl !== undefined ? { rejectionUrl: input.rejectionUrl } : {}),
      ...(input.qrCodeDataUrl !== undefined ? { qrCodeDataUrl: input.qrCodeDataUrl } : {}),
      ...(input.reportSnapshot !== undefined ? { reportSnapshot: input.reportSnapshot } : {}),
    };
    write(KEYS.canvasSends, records);
    return delay(records[idx]);
  },

  // ── Image metadata ────────────────────────────────────────────────────
  async listSampleOrders() {
    return delay(readSampleOrders().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  },

  async upsertSampleOrder(input) {
    const records = readSampleOrders();
    const now = nowISO();
    const index = records.findIndex(
      (record) =>
        record.canvasSendId === input.canvasSendId && record.supplierId === input.supplierId,
    );
    if (index >= 0) {
      records[index] = {
        ...records[index],
        recipientEmail: input.recipientEmail,
        approverEmail: input.approverEmail,
        snapshot: input.snapshot,
        emailStatus: "pending",
        emailError: null,
        deliveryCount: records[index].deliveryCount + 1,
        currentStage: "purchase",
        currentPayload: null,
        updatedAt: now,
      };
      write(KEYS.sampleOrders, records);
      return delay(records[index]);
    }
    const record: SampleOrder = {
      id: uid(),
      canvasSendId: input.canvasSendId,
      canvasId: input.canvasId,
      projectId: input.projectId,
      supplierId: input.supplierId,
      sequence: input.sequence,
      recipientEmail: input.recipientEmail,
      approverEmail: input.approverEmail,
      snapshot: input.snapshot,
      emailStatus: "pending",
      emailError: null,
      deliveryCount: 1,
      purchaseSentAt: null,
      currentStage: "purchase",
      currentPayload: null,
      latestUpdateAt: null,
      approvalStatus: "not_requested",
      approvalEmailStatus: null,
      approvalError: null,
      approvalSentAt: null,
      approvalRespondedAt: null,
      createdAt: now,
      updatedAt: now,
      updates: [],
    };
    write(KEYS.sampleOrders, [record, ...records]);
    return delay(record);
  },

  async updateSampleOrderEmail(id, input) {
    const records = readSampleOrders();
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error("Sample order not found");
    records[index] = {
      ...records[index],
      emailStatus: input.status,
      emailError: input.error ?? null,
      purchaseSentAt: input.sentAt === undefined ? records[index].purchaseSentAt : input.sentAt,
      updatedAt: nowISO(),
    };
    write(KEYS.sampleOrders, records);
    return delay(records[index]);
  },

  async rotateSampleOrderToken(id) {
    const records = readSampleOrders();
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error("Sample order not found");
    records[index] = {
      ...records[index],
      emailStatus: "pending",
      emailError: null,
      deliveryCount: records[index].deliveryCount + 1,
      updatedAt: nowISO(),
    };
    write(KEYS.sampleOrders, records);
    return delay(records[index]);
  },

  async deleteSampleOrder(id) {
    const records = readSampleOrders();
    write(KEYS.sampleOrders, records.filter((record) => record.id !== id));
  },

  async generateDemoSampleOrders(count) {
    const records = readSampleOrders();
    const created: SampleOrder[] = [];
    for (let index = 0; index < count; index += 1) {
      const stage = SAMPLE_STAGES[(records.length + index) % SAMPLE_STAGES.length];
      const now = new Date(Date.now() - index * 3_600_000).toISOString();
      const payload = demoPayload(stage, index);
      const id = uid();
      const update: SampleOrderUpdate = {
        id: uid(),
        orderId: id,
        stage,
        payload,
        source: "demo",
        createdAt: now,
      };
      created.push({
        id,
        canvasSendId: null,
        canvasId: null,
        projectId: null,
        supplierId: null,
        sequence: `CA${String(900001 + records.length + index).padStart(6, "0")}`,
        recipientEmail: `supplier${index + 1}@example.com`,
        approverEmail: "buyer@example.com",
        snapshot: {
          project: {
            id: `demo-project-${index}`,
            name: `Seasonal Project ${index + 1}`,
            customerName: `Customer ${index + 1}`,
          },
          canvas: {
            id: `demo-canvas-${index}`,
            name: `Sample Canvas ${index + 1}`,
            reportUrl: "https://example.com/canvas-report",
          },
          supplier: {
            id: `demo-supplier-${index}`,
            name: `Supplier Workshop ${index + 1}`,
            email: `supplier${index + 1}@example.com`,
            productTypes: ["woven-label"],
            employees: [
              {
                name: `Contact ${index + 1}`,
                title: "Sample coordinator",
                email: `supplier${index + 1}@example.com`,
                tel: `+86 755 8800 ${String(1000 + index)}`,
              },
            ],
          },
          lines: [
            {
              nodeId: `demo-node-${index}`,
              productId: null,
              variantId: null,
              subject: `Garment trim sample ${index + 1}`,
              details: ["Material: recycled polyester", `Quantity: ${500 + index * 100} pcs`],
            },
          ],
        },
        emailStatus: index % 8 === 0 ? "failed" : "sent",
        emailError: index % 8 === 0 ? "Demo SMTP timeout" : null,
        deliveryCount: 1,
        purchaseSentAt: now,
        currentStage: stage,
        currentPayload: payload,
        latestUpdateAt: now,
        approvalStatus:
          stage === "shipment" ? "pending" : stage === "invoice" ? "approved" : "not_requested",
        approvalEmailStatus: stage === "shipment" || stage === "invoice" ? "sent" : null,
        approvalError: null,
        approvalSentAt: stage === "shipment" || stage === "invoice" ? now : null,
        approvalRespondedAt: stage === "invoice" ? now : null,
        createdAt: now,
        updatedAt: now,
        updates: [update],
      });
    }
    write(KEYS.sampleOrders, [...created, ...records]);
    return delay(created);
  },

  async listImages(canvasId) {
    const metadata = read<ImageRecord[]>(KEYS.images, []).filter(
      (image) => image.canvasId === canvasId && image.source === "generated",
    );
    const inline = await listImageRecordsFromIndexedDb(canvasId);
    return [...metadata, ...inline].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async recordImage(input: RecordImageInput) {
    const images = read<ImageRecord[]>(KEYS.images, []);
    const record: ImageRecord = {
      id: uid(),
      canvasId: input.canvasId ?? null,
      source: input.source,
      url: input.url,
      storagePath: input.storagePath ?? null,
      prompt: input.prompt ?? null,
      model: input.model ?? null,
      modelDetails: input.modelDetails ?? null,
      createdAt: nowISO(),
    };

    // Inline images already live in canvas node data. Duplicating their
    // multi-megabyte payloads in image metadata quickly exhausts localStorage.
    const metadataImages = images.filter((image) => !isInlineImageUrl(image.url));
    if (isInlineImageUrl(record.url)) {
      if (metadataImages.length !== images.length) {
        write(KEYS.images, metadataImages);
      }
      await writeImageRecordToIndexedDb(record);
      return delay(record);
    }

    write(KEYS.images, [record, ...metadataImages]);
    return delay(record);
  },
};
