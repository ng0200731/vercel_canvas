"use client";

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

import type { WorkspaceRecordStore } from "./workspaceRecordStore";

async function callLocalWorkspaceStore<T>(method: string, args: unknown[] = []): Promise<T> {
  const response = await fetch("/api/local-store/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, args }),
  });

  let payload: { result?: T; error?: string } = {};
  try {
    payload = (await response.json()) as { result?: T; error?: string };
  } catch {
    // ignore
  }

  if (!response.ok) {
    throw new Error(payload.error ?? `Local Postgres request failed (${response.status}).`);
  }
  return payload.result as T;
}

/**
 * Browser-side WorkspaceRecordStore that proxies methods to the local Postgres API.
 */
export const remotePostgresWorkspaceRecordStore: WorkspaceRecordStore = {
  listCustomers: () => callLocalWorkspaceStore<CustomerRecord[]>("listCustomers"),
  upsertCustomer: (id: string | null, input: CustomerRecordInput) =>
    callLocalWorkspaceStore<CustomerRecord>("upsertCustomer", [id, input]),
  listSuppliers: () => callLocalWorkspaceStore<SupplierRecord[]>("listSuppliers"),
  upsertSupplier: (id: string | null, input: SupplierRecordInput) =>
    callLocalWorkspaceStore<SupplierRecord>("upsertSupplier", [id, input]),
  deleteSuppliers: (ids: string[]) => callLocalWorkspaceStore<void>("deleteSuppliers", [ids]),
  listProducts: () => callLocalWorkspaceStore<ProductRecord[]>("listProducts"),
  upsertProduct: (id: string | null, input: ProductRecordInput) =>
    callLocalWorkspaceStore<ProductRecord>("upsertProduct", [id, input]),
  deleteProducts: (ids: string[]) => callLocalWorkspaceStore<void>("deleteProducts", [ids]),
  getProduct: (productId: string) =>
    callLocalWorkspaceStore<ProductRecord | null>("getProduct", [productId]),
  listWorkspaceOptions: (kind: WorkspaceOptionKind) =>
    callLocalWorkspaceStore<WorkspaceOption[]>("listWorkspaceOptions", [kind]),
  replaceWorkspaceOptions: (kind: WorkspaceOptionKind, options: WorkspaceOption[]) =>
    callLocalWorkspaceStore<WorkspaceOption[]>("replaceWorkspaceOptions", [kind, options]),
  listGenericNodeDefinitions: () =>
    callLocalWorkspaceStore<GenericNodeDefinition[]>("listGenericNodeDefinitions"),
  upsertGenericNodeDefinition: (id: string | null, input: GenericNodeDefinitionInput) =>
    callLocalWorkspaceStore<GenericNodeDefinition>("upsertGenericNodeDefinition", [id, input]),
  deleteGenericNodeDefinition: (id: string) =>
    callLocalWorkspaceStore<void>("deleteGenericNodeDefinition", [id]),
  reorderGenericNodeDefinitions: (orderedIds: string[]) =>
    callLocalWorkspaceStore<GenericNodeDefinition[]>("reorderGenericNodeDefinitions", [
      orderedIds,
    ]),
  getAppSetting: (key: string) =>
    callLocalWorkspaceStore<unknown | null>("getAppSetting", [key]),
  setAppSetting: (key: string, value: unknown) =>
    callLocalWorkspaceStore<void>("setAppSetting", [key, value]),
};
