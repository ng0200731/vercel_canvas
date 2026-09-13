"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { getWorkspaceRecordStore } from "@/lib/store/workspaceRecords";
import type {
  CustomerRecordInput,
  ProductRecordInput,
  SupplierRecordInput,
} from "@/lib/workspace-records";
import type {
  GenericNodeDefinition,
  GenericNodeDefinitionInput,
  WorkspaceOption,
  WorkspaceOptionKind,
} from "@/lib/workspace-settings";

const WORKSPACE_RECORDS_ROOT_KEY = ["workspace-records"] as const;
const CUSTOMERS_KEY = ["workspace-records", "customers"] as const;
const SUPPLIERS_KEY = ["workspace-records", "suppliers"] as const;
const PRODUCTS_KEY = ["workspace-records", "products"] as const;
const GENERIC_NODE_DEFINITIONS_KEY = ["workspace-records", "generic-node-definitions"] as const;

function workspaceOptionsKey(kind: WorkspaceOptionKind) {
  return ["workspace-records", "workspace-options", kind] as const;
}

/** Refetch customers, suppliers, products, generic nodes, and workspace options. */
export async function refreshWorkspaceRecords(queryClient: QueryClient) {
  await queryClient.refetchQueries({ queryKey: WORKSPACE_RECORDS_ROOT_KEY });
}

function optimisticId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `optimistic-${crypto.randomUUID()}`
    : `optimistic-${Date.now()}`;
}

function orderByIds<T extends { id: string; sortIndex: number }>(
  records: T[],
  orderedIds: readonly string[],
): T[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((record): record is T => Boolean(record));
  const orderedSet = new Set(orderedIds);

  return [...ordered, ...records.filter((record) => !orderedSet.has(record.id))].map(
    (record, sortIndex) => ({ ...record, sortIndex }),
  );
}

export function useCustomers() {
  return useQuery({
    queryKey: CUSTOMERS_KEY,
    queryFn: () => getWorkspaceRecordStore().listCustomers(),
  });
}

export function useUpsertCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: CustomerRecordInput }) =>
      getWorkspaceRecordStore().upsertCustomer(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY }),
  });
}

export function useSuppliers() {
  return useQuery({
    queryKey: SUPPLIERS_KEY,
    queryFn: () => getWorkspaceRecordStore().listSuppliers(),
  });
}

export function useUpsertSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: SupplierRecordInput }) =>
      getWorkspaceRecordStore().upsertSupplier(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
  });
}

export function useDeleteSuppliers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => getWorkspaceRecordStore().deleteSuppliers(ids),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
        queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
      ]);
    },
  });
}

export function useSetSupplierShared() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, shared }: { id: string; shared: boolean }) =>
      getWorkspaceRecordStore().setSupplierShared(id, shared),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUPPLIERS_KEY }),
  });
}

export function useProducts() {
  return useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: () => getWorkspaceRecordStore().listProducts(),
  });
}

export function useUpsertProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: ProductRecordInput }) =>
      getWorkspaceRecordStore().upsertProduct(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  });
}

export function useDeleteProducts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => getWorkspaceRecordStore().deleteProducts(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  });
}

export function useWorkspaceOptions(kind: WorkspaceOptionKind) {
  return useQuery({
    queryKey: workspaceOptionsKey(kind),
    queryFn: () => getWorkspaceRecordStore().listWorkspaceOptions(kind),
  });
}

export function useReplaceWorkspaceOptions(kind: WorkspaceOptionKind) {
  const queryClient = useQueryClient();
  const queryKey = workspaceOptionsKey(kind);

  return useMutation({
    mutationFn: (options: WorkspaceOption[]) =>
      getWorkspaceRecordStore().replaceWorkspaceOptions(kind, options),
    onMutate: async (options) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<WorkspaceOption[]>(queryKey);
      queryClient.setQueryData<WorkspaceOption[]>(
        queryKey,
        options.map((option, sortIndex) => ({ ...option, sortIndex })),
      );
      return { previous };
    },
    onError: (_error, _options, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
    },
    onSuccess: (options) => queryClient.setQueryData(queryKey, options),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}

export function useGenericNodeDefinitions() {
  return useQuery({
    queryKey: GENERIC_NODE_DEFINITIONS_KEY,
    queryFn: () => getWorkspaceRecordStore().listGenericNodeDefinitions(),
  });
}

export function useUpsertGenericNodeDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: GenericNodeDefinitionInput }) =>
      getWorkspaceRecordStore().upsertGenericNodeDefinition(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: GENERIC_NODE_DEFINITIONS_KEY });
      const previous = queryClient.getQueryData<GenericNodeDefinition[]>(
        GENERIC_NODE_DEFINITIONS_KEY,
      );
      const timestamp = new Date().toISOString();
      const nextId = id ?? optimisticId();
      const existing = previous?.find((record) => record.id === id);
      const optimistic: GenericNodeDefinition = {
        id: nextId,
        ...input,
        sortIndex: existing?.sortIndex ?? previous?.length ?? 0,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      const next = existing
        ? previous?.map((record) => (record.id === id ? optimistic : record))
        : [...(previous ?? []), optimistic];
      queryClient.setQueryData(GENERIC_NODE_DEFINITIONS_KEY, next);
      return { optimisticId: nextId, previous };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(GENERIC_NODE_DEFINITIONS_KEY, context.previous);
      }
    },
    onSuccess: (saved, _variables, context) => {
      queryClient.setQueryData<GenericNodeDefinition[]>(
        GENERIC_NODE_DEFINITIONS_KEY,
        (current = []) =>
          current.map((record) => (record.id === context.optimisticId ? saved : record)),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: GENERIC_NODE_DEFINITIONS_KEY }),
  });
}

export function useDeleteGenericNodeDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getWorkspaceRecordStore().deleteGenericNodeDefinition(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: GENERIC_NODE_DEFINITIONS_KEY });
      const previous = queryClient.getQueryData<GenericNodeDefinition[]>(
        GENERIC_NODE_DEFINITIONS_KEY,
      );
      queryClient.setQueryData<GenericNodeDefinition[]>(
        GENERIC_NODE_DEFINITIONS_KEY,
        (current = []) => current.filter((record) => record.id !== id),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context) {
        queryClient.setQueryData(GENERIC_NODE_DEFINITIONS_KEY, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: GENERIC_NODE_DEFINITIONS_KEY }),
  });
}

export function useReorderGenericNodeDefinitions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      getWorkspaceRecordStore().reorderGenericNodeDefinitions(orderedIds),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: GENERIC_NODE_DEFINITIONS_KEY });
      const previous = queryClient.getQueryData<GenericNodeDefinition[]>(
        GENERIC_NODE_DEFINITIONS_KEY,
      );
      queryClient.setQueryData<GenericNodeDefinition[]>(
        GENERIC_NODE_DEFINITIONS_KEY,
        (current = []) => orderByIds(current, orderedIds),
      );
      return { previous };
    },
    onError: (_error, _orderedIds, context) => {
      if (context) {
        queryClient.setQueryData(GENERIC_NODE_DEFINITIONS_KEY, context.previous);
      }
    },
    onSuccess: (records) => queryClient.setQueryData(GENERIC_NODE_DEFINITIONS_KEY, records),
    onSettled: () => queryClient.invalidateQueries({ queryKey: GENERIC_NODE_DEFINITIONS_KEY }),
  });
}
