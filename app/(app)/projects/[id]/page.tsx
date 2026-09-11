import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { CanvasList } from "@/components/projects/canvas-list";
import { getCurrentAdminAccess } from "@/lib/admin";
import { ProjectHeader } from "@/components/projects/project-header";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/projects"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring hover:bg-muted mb-5 inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm transition-colors outline-none focus-visible:ring-2"
      >
        <ChevronLeft className="size-4" /> Projects
      </Link>
      <ProjectHeader projectId={id} />
      <div className="mt-8">
        <CanvasList projectId={id} />
      </div>
    </main>
  );
}
