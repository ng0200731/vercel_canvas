import { CanvasEditor } from "@/components/canvas/canvas-editor";
import { getCurrentAdminAccess } from "@/lib/admin";

export default async function CanvasEditorPage({
  params,
}: {
  params: Promise<{ id: string; canvasId: string }>;
}) {
  const { id, canvasId } = await params;
  const { isAdmin } = await getCurrentAdminAccess();
  return <CanvasEditor projectId={id} canvasId={canvasId} isAdmin={isAdmin} />;
}
