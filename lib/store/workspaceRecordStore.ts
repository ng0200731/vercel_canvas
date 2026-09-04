import type {
  CustomerRecord,
  CustomerRecordInput,
  ProductRecord,
  ProductRecordInput,
  SupplierRecord,
  SupplierRecordInput,
} from "@/lib/workspace-records";
import type {
  GenericNodeDefinition,
  GenericNodeDefinitionInput,
  WorkspaceOption,
  WorkspaceOptionKind,
} from "@/lib/workspace-settings";

export interface WorkspaceRecordStore {
  listCustomers(): Promise<CustomerRecord[]>;
  upsertCustomer(id: string | null, input: CustomerRecordInput): Promise<CustomerRecord>;
  listSuppliers(): Promise<SupplierRecord[]>;
  upsertSupplier(id: string | null, input: SupplierRecordInput): Promise<SupplierRecord>;
  deleteSuppliers(ids: string[]): Promise<void>;
  listProducts(): Promise<ProductRecord[]>;
  upsertProduct(id: string | null, input: ProductRecordInput): Promise<ProductRecord>;
  deleteProducts(ids: string[]): Promise<void>;
  getProduct(productId: string): Promise<ProductRecord | null>;
  listWorkspaceOptions(kind: WorkspaceOptionKind): Promise<WorkspaceOption[]>;
  replaceWorkspaceOptions(
    kind: WorkspaceOptionKind,
    options: WorkspaceOption[],
  ): Promise<WorkspaceOption[]>;
  listGenericNodeDefinitions(): Promise<GenericNodeDefinition[]>;
  upsertGenericNodeDefinition(
    id: string | null,
    input: GenericNodeDefinitionInput,
  ): Promise<GenericNodeDefinition>;
  deleteGenericNodeDefinition(id: string): Promise<void>;
  reorderGenericNodeDefinitions(orderedIds: string[]): Promise<GenericNodeDefinition[]>;
  /** Read a scalar per-user app setting by key (e.g. "gemini-match-min-cosine").
   *  Returns null when no row exists (the caller then falls back to its env default). */
  getAppSetting(key: string): Promise<unknown | null>;
  /** Persist a scalar per-user app setting by key (overwrites any existing row). */
  setAppSetting(key: string, value: unknown): Promise<void>;
}

export type WorkspaceRecordKind = "customer" | "supplier" | "product";
