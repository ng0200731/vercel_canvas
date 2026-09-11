import type { CanvasContent } from "@/lib/nodes/types";
import type { ProjectMetadata } from "@/lib/project-metadata";
import type {
  RotateSampleOrderTokenInput,
  SampleOrder,
  UpdateSampleOrderEmailInput,
  UpsertSampleOrderInput,
} from "@/lib/sample-orders";

export interface Project extends ProjectMetadata {
  id: string;
  name: string;
  description: string | null;
  userId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Canvas {
  id: string;
  projectId: string;
  name: string;
  content: CanvasContent;
  status: CanvasStatus;
  createdAt: string;
  updatedAt: string;
}

export const CANVAS_STATUSES = ["draft", "awaiting_approval", "approved", "rejected"] as const;
export type CanvasStatus = (typeof CANVAS_STATUSES)[number];

export interface CanvasSendRecord {
  id: string;
  canvasId: string;
  sequence: string;
  status: Exclude<CanvasStatus, "draft">;
  recipientEmail: string;
  reportUrl: string;
  approvalUrl: string;
  rejectionUrl: string;
  qrCodeDataUrl: string | null;
  selectedImageIds: string[];
  reportSnapshot: unknown;
  createdAt: string;
  respondedAt: string | null;
}

export interface ImageRecord {
  id: string;
  canvasId: string | null;
  source: "upload" | "generated";
  url: string;
  storagePath: string | null;
  prompt: string | null;
  model: string | null;
  modelDetails: ImageModelDetails | null;
  createdAt: string;
}

export interface ImageModelDetails {
  model: string;
  size: string | null;
  resolution: string | null;
  outputFormat: string | null;
  durationMs?: number | null;
}

export interface CreateProjectInput extends Partial<ProjectMetadata> {
  name: string;
  description?: string;
}

export interface CreateCanvasInput {
  projectId: string;
  name: string;
  content?: CanvasContent;
}

export interface CreateCanvasSendInput {
  canvasId: string;
  recipientEmail: string;
  reportUrl: string;
  approvalToken: string;
  approvalUrl: string;
  rejectionUrl: string;
  qrCodeDataUrl?: string | null;
  selectedImageIds: string[];
  reportSnapshot: unknown;
}

export interface UpdateCanvasSendInput {
  reportUrl?: string;
  approvalUrl?: string;
  rejectionUrl?: string;
  qrCodeDataUrl?: string | null;
  reportSnapshot?: unknown;
}

export interface RecordImageInput {
  canvasId?: string | null;
  source: "upload" | "generated";
  url: string;
  storagePath?: string | null;
  prompt?: string | null;
  model?: string | null;
  modelDetails?: ImageModelDetails | null;
}

export type ProjectUpdate = Partial<Pick<Project, "name" | "description"> & ProjectMetadata>;

/**
 * Persistence boundary for projects, canvases, and image records.
 *
 * Implementations:
 *   - Supabase (cloud) — active when Supabase env vars are configured
 *   - localStorage — demo/local mode otherwise
 *
 * Always obtain an instance via `getCanvasStore()` in `lib/store/index.ts`; never
 * import a concrete implementation directly, so the backend can swap by env.
 */
export interface CanvasStore {
  // ── Projects ──────────────────────────────────────────────────────────
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(id: string, input: ProjectUpdate): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  // ── Canvases ──────────────────────────────────────────────────────────
  listCanvases(projectId: string): Promise<Canvas[]>;
  getCanvas(id: string): Promise<Canvas | null>;
  createCanvas(input: CreateCanvasInput): Promise<Canvas>;
  renameCanvas(id: string, name: string): Promise<Canvas>;
  saveCanvasContent(id: string, content: CanvasContent): Promise<void>;
  updateCanvasStatus(id: string, status: CanvasStatus): Promise<Canvas>;
  deleteCanvas(id: string): Promise<void>;

  // Canvas sends / approvals
  listCanvasSends(canvasId: string): Promise<CanvasSendRecord[]>;
  createCanvasSend(input: CreateCanvasSendInput): Promise<CanvasSendRecord>;
  updateCanvasSend(id: string, input: UpdateCanvasSendInput): Promise<CanvasSendRecord>;

  // Supplier sample-order tracking
  listSampleOrders(): Promise<SampleOrder[]>;
  upsertSampleOrder(input: UpsertSampleOrderInput): Promise<SampleOrder>;
  updateSampleOrderEmail(id: string, input: UpdateSampleOrderEmailInput): Promise<SampleOrder>;
  rotateSampleOrderToken(id: string, input: RotateSampleOrderTokenInput): Promise<SampleOrder>;
  deleteSampleOrder(id: string): Promise<void>;
  generateDemoSampleOrders(count: number): Promise<SampleOrder[]>;

  // ── Image metadata ────────────────────────────────────────────────────
  listImages(canvasId: string): Promise<ImageRecord[]>;
  recordImage(input: RecordImageInput): Promise<ImageRecord>;
}
