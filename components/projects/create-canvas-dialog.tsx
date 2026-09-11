"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateCanvas } from "@/lib/hooks/use-canvases";
import { createRegularUserCanvasContent } from "@/lib/nodes/starter-canvas";
import type { Canvas } from "@/lib/store";

export function CreateCanvasDialog({
  projectId,
  redirectOnCreate = true,
  onCreated,
  isAdmin = true,
}: {
  projectId: string;
  redirectOnCreate?: boolean;
  onCreated?: (canvas: Canvas) => void;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateCanvas();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const canvas = await create.mutateAsync({
        projectId,
        name,
        ...(isAdmin ? {} : { content: createRegularUserCanvasContent() }),
      });
      setOpen(false);
      setName("");
      toast.success("Canvas created");
      onCreated?.(canvas);
      if (redirectOnCreate) {
        router.push(`/projects/${projectId}/canvases/${canvas.id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create canvas");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="shadow-sm">
            <Plus /> New canvas
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>New canvas</DialogTitle>
            <DialogDescription>An infinite canvas where you arrange nodes.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="canvas-name">Name</Label>
            <Input
              id="canvas-name"
              autoFocus
              className="h-10"
              placeholder="Untitled canvas"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
