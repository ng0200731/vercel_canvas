"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileImage, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CanvasEditor } from "@/components/canvas/canvas-editor";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CreateCanvasDialog } from "@/components/projects/create-canvas-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useCanvases, useDeleteCanvas } from "@/lib/hooks/use-canvases";
import { getCanvasStore } from "@/lib/store";

// The standalone Canvas library keeps every canvas under a single shared
// backing project so the same canvases appear on every origin (localhost, the
// Vercel deploy, other machines) that uses the same account/database. The
// project is resolved deterministically by name (NOT by a per-origin
// localStorage id), otherwise each origin silently creates its own "Canvas"
// project and canvases stop syncing between local and production.
const LIBRARY_PROJECT_NAME = "quickcanvas";

/**
 * Left-menu "Canvas → View / edit" panel. Presents a standalone canvas library
 * (mirroring the Project → View / edit page): a "New canvas" button plus a table
 * of every saved canvas with a View / Edit action that loads it into the full editor.
 *
 * Canvases are stored under a single hidden backing project so the UI never
 * surfaces project concepts — canvases are simply saved and fetched by name.
 */
export function CanvasLibraryPanel({ isAdmin = true }: { isAdmin?: boolean }) {
  const queryClient = useQueryClient();
  const initRef = useRef(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const {
    data: canvases,
    isLoading,
    isError,
    error: loadError,
  } = useCanvases(projectId ?? "");
  const del = useDeleteCanvas(projectId ?? "");

  // Resolve the shared backing project from the project database rather than a
  // per-origin localStorage id. find-or-create by name (reusing the quick-canvas
  // pattern) so every origin/account opening the library converges on the SAME
  // project and canvases stay in sync between local and Vercel. Safe under
  // StrictMode (single resolution, retryable on failure).
  async function ensureLibrary(force = false) {
    if (initRef.current && !force) return;
    initRef.current = true;
    try {
      const store = getCanvasStore();
      const projects = await store.listProjects();
      let project = projects.find(
        (entry) => entry.name.trim().toLocaleLowerCase() === LIBRARY_PROJECT_NAME,
      );
      if (!project) {
        project = await store.createProject({ name: LIBRARY_PROJECT_NAME });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
      }
      setProjectId(project.id);
      setResolveError(null);
    } catch (error) {
      initRef.current = false;
      setResolveError(
        error instanceof Error ? error.message : "Failed to open the canvas library",
      );
    }
  }

  useEffect(() => {
    if (projectId == null) void ensureLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function backToLibrary() {
    if (projectId) void queryClient.invalidateQueries({ queryKey: ["canvases", projectId] });
    setSelectedCanvasId(null);
  }

  async function deleteCanvas(canvasId: string) {
    if (!projectId) return;
    await del.mutateAsync(canvasId);
    toast.success("Canvas deleted");
  }

  if (selectedCanvasId && projectId) {
    return (
      <CanvasEditor
        projectId={projectId}
        canvasId={selectedCanvasId}
        embedded
        onBack={backToLibrary}
        isAdmin={isAdmin}
      />
    );
  }

  if (projectId == null) {
    return (
      <div className="flex h-full flex-col gap-6 overflow-auto p-6">
        {resolveError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="bg-destructive/10 text-destructive flex size-11 items-center justify-center rounded-lg">
              <AlertTriangle className="size-5" />
            </div>
            <p className="font-medium">Unable to open the canvas library</p>
            <p className="text-muted-foreground max-w-sm text-sm">{resolveError}</p>
            <Button size="sm" onClick={() => void ensureLibrary(true)}>
              <RefreshCw /> Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="ml-auto h-9 w-28" />
            </div>
            <div className="bg-card rounded-lg border p-3 shadow-sm">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="mb-2 h-11 last:mb-0" />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Workspace
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Canvases</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
            Create and manage standalone canvases. Each canvas is saved and can be reopened for
            further editing.
          </p>
        </div>
        <CreateCanvasDialog
          projectId={projectId}
          isAdmin={false}
          redirectOnCreate={false}
          onCreated={(canvas) => setSelectedCanvasId(canvas.id)}
        />
      </div>

      {isLoading ? (
        <div className="bg-card rounded-lg border p-3 shadow-sm">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="mb-2 h-11 last:mb-0" />
          ))}
        </div>
      ) : isError ? (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
          Failed to load canvases: {loadError instanceof Error ? loadError.message : "unknown error"}
        </p>
      ) : canvases && canvases.length > 0 ? (
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-4 py-3">Canvas name</th>
                  <th className="px-4 py-3">Create time</th>
                  <th className="w-40 px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {canvases.map((canvas) => (
                  <tr key={canvas.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedCanvasId(canvas.id)}
                        className="focus-visible:ring-ring inline-flex items-center gap-2 rounded-sm font-medium outline-none focus-visible:ring-2"
                      >
                        <FileImage className="text-muted-foreground size-4" />
                        {canvas.name}
                      </button>
                    </td>
                    <td className="text-muted-foreground px-4 py-3">{formatDate(canvas.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedCanvasId(canvas.id)}
                        >
                          View/Edit
                        </Button>
                        <ConfirmDialog
                          title="Delete canvas?"
                          description="This permanently deletes the canvas and its saved content."
                          onConfirm={() => void deleteCanvas(canvas.id)}
                          trigger={
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Delete ${canvas.name}`}
                            >
                              <Trash2 />
                            </Button>
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-card flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center shadow-sm">
          <div className="bg-secondary text-secondary-foreground flex size-11 items-center justify-center rounded-lg">
            <FileImage className="size-5" />
          </div>
          <p className="font-medium">No canvases yet</p>
          <p className="text-muted-foreground max-w-sm text-sm">
            Create a canvas to start arranging image, generation, and output nodes.
          </p>
          <CreateCanvasDialog
            projectId={projectId}
            isAdmin={false}
            redirectOnCreate={false}
            onCreated={(canvas) => setSelectedCanvasId(canvas.id)}
          />
        </div>
      )}
    </div>
  );
}