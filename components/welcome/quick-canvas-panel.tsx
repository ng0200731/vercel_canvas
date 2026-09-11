"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { CanvasEditor } from "@/components/canvas/canvas-editor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createRegularUserCanvasContent } from "@/lib/nodes/starter-canvas";
import { getCanvasStore, type Canvas, type Project } from "@/lib/store";

const QUICK_PROJECT_KEY = "quick-canvas-project-id";
const QUICK_CANVAS_KEY = "quick-canvas-id";
const QUICK_NAME = "Quick Canvas";

type InitState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; projectId: string; canvasId: string };

/**
 * Self-contained panel for the left-menu "Canvas → View / edit" item. It ensures a
 * single dedicated quick project + canvas exist (seeded with the starter
 * image → generate → output flow on first use), then embeds the normal canvas editor for
 * that canvas. The resolved ids are cached in state and localStorage so every click and
 * reload reopens the SAME canvas.
 */
export function QuickCanvasPanel({
  onBack,
  isAdmin = true,
}: {
  onBack: () => void;
  isAdmin?: boolean;
}) {
  const queryClient = useQueryClient();
  const initRef = useRef(false);
  const [state, setState] = useState<InitState>(() => {
    const projectId = window.localStorage.getItem(QUICK_PROJECT_KEY);
    const canvasId = window.localStorage.getItem(QUICK_CANVAS_KEY);
    return projectId && canvasId ? { status: "ready", projectId, canvasId } : { status: "loading" };
  });

  async function ensureQuickCanvas(force = false) {
    if (initRef.current && !force) return;
    initRef.current = true;
    // If we already resolved in a previous mount, keep using those ids without
    // touching the network (ids may not yet be persisted).
    if (!force && state.status === "ready") return;

    setState({ status: "loading" });
    try {
      const store = getCanvasStore();

      // 1) Reuse or create the dedicated quick project.
      const storedProjectId = window.localStorage.getItem(QUICK_PROJECT_KEY);
      let project: Project | null =
        storedProjectId != null ? await store.getProject(storedProjectId) : null;
      if (!project) {
        project = await store.createProject({ name: QUICK_NAME });
        window.localStorage.setItem(QUICK_PROJECT_KEY, project.id);
      }

      // 2) Reuse or create the quick canvas, seeded with the starter flow on first use.
      const storedCanvasId = window.localStorage.getItem(QUICK_CANVAS_KEY);
      let canvas: Canvas | null =
        storedCanvasId != null ? await store.getCanvas(storedCanvasId) : null;
      if (!canvas) {
        canvas = await store.createCanvas({
          projectId: project.id,
          name: QUICK_NAME,
          content: createRegularUserCanvasContent(),
        });
        window.localStorage.setItem(QUICK_CANVAS_KEY, canvas.id);
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
      }

      setState({ status: "ready", projectId: project.id, canvasId: canvas.id });
    } catch (error) {
      initRef.current = false;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to open the canvas",
      });
    }
  }

  useEffect(() => {
    if (state.status !== "ready") void ensureQuickCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="bg-destructive/10 text-destructive flex size-11 items-center justify-center rounded-lg">
          <AlertTriangle className="size-5" />
        </div>
        <p className="font-medium">Unable to open the canvas</p>
        <p className="text-muted-foreground max-w-sm text-sm">{state.message}</p>
        <Button size="sm" onClick={() => void ensureQuickCanvas(true)}>
          <RefreshCw /> Retry
        </Button>
      </div>
    );
  }

  if (state.status !== "ready") {
    return (
      <div className="flex h-full flex-col gap-3 p-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="ml-auto h-8 w-24" />
        </div>
        <p className="text-muted-foreground text-sm">Setting up canvas…</p>
        <Skeleton className="h-full flex-1" />
      </div>
    );
  }

  return (
    <CanvasEditor
      projectId={state.projectId}
      canvasId={state.canvasId}
      embedded
      onBack={onBack}
      isAdmin={isAdmin}
    />
  );
}