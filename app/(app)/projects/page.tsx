import { ProjectList } from "@/components/projects/project-list";
import { getCurrentAdminAccess } from "@/lib/admin";

export default async function ProjectsPage() {
  const { isAdmin } = await getCurrentAdminAccess();
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <ProjectList isAdmin={isAdmin} />
    </main>
  );
}
