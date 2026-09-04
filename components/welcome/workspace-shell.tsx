"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  FolderKanban,
  Layers3,
  Menu,
  PackageSearch,
  PanelLeftClose,
  Settings2,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CanvasEditor } from "@/components/canvas/canvas-editor";
import { CanvasList } from "@/components/projects/canvas-list";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectList } from "@/components/projects/project-list";
import { GenericNodeSettingsPanel } from "@/components/settings/generic-node-settings-panel";
import { GeminiSearchSettingsPanel } from "@/components/settings/gemini-search-settings-panel";
import { OrderedOptionSettingsPanel } from "@/components/settings/ordered-option-settings-panel";
import { SmtpSettingsPanel } from "@/components/settings/smtp-settings-panel";
import { EntityWorkspacePanel } from "@/components/welcome/entity-workspace-panel";
import { SampleStatusDashboard } from "@/components/sample-status/sample-status-dashboard";
import { cn } from "@/lib/utils";

type SectionId = "customer" | "product" | "supplier" | "project" | "sample-status" | "settings";
type TabId =
  | "customer"
  | "product"
  | "supplier"
  | "project"
  | "sample-status"
  | "smtp-settings"
  | "currency-settings"
  | "destination-country-settings"
  | "address-book-settings"
  | "generic-node-settings"
  | "gemini-settings";
type WorkspaceMode = "new" | "records";

interface MenuItem {
  label: string;
  tab: TabId;
  mode?: WorkspaceMode;
}

interface MenuSection {
  id: SectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  tab: TabId;
  items: MenuItem[];
}

interface WorkspaceTab {
  id: TabId;
  label: string;
}

const sections: MenuSection[] = [
  {
    id: "customer",
    label: "Customer",
    icon: Users,
    tab: "customer",
    items: [
      { label: "New", tab: "customer", mode: "new" },
      { label: "View / edit", tab: "customer", mode: "records" },
    ],
  },
  {
    id: "product",
    label: "Product",
    icon: Boxes,
    tab: "product",
    items: [
      { label: "New", tab: "product", mode: "new" },
      { label: "View / edit", tab: "product", mode: "records" },
    ],
  },
  {
    id: "supplier",
    label: "Supplier",
    icon: PackageSearch,
    tab: "supplier",
    items: [
      { label: "New", tab: "supplier", mode: "new" },
      { label: "View / edit", tab: "supplier", mode: "records" },
    ],
  },
  {
    id: "project",
    label: "Project",
    icon: FolderKanban,
    tab: "project",
    items: [{ label: "View / edit", tab: "project", mode: "records" }],
  },
  {
    id: "sample-status",
    label: "Sample Status",
    icon: ClipboardList,
    tab: "sample-status",
    items: [],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings2,
    tab: "smtp-settings",
    items: [
      { label: "SMTP setting", tab: "smtp-settings" },
      { label: "Currency", tab: "currency-settings" },
      { label: "Destination country", tab: "destination-country-settings" },
      { label: "Address book", tab: "address-book-settings" },
      { label: "Generic node", tab: "generic-node-settings" },
      { label: "Gemini image search", tab: "gemini-settings" },
    ],
  },
];

const tabLabels: Record<TabId, string> = {
  customer: "Customer +",
  product: "Product +",
  supplier: "Supplier +",
  project: "Project",
  "sample-status": "Sample Status",
  "smtp-settings": "SMTP Setting",
  "currency-settings": "Currency",
  "destination-country-settings": "Destination Country",
  "address-book-settings": "Address Book",
  "generic-node-settings": "Generic Node",
  "gemini-settings": "Gemini Image Search",
};

function sectionForTab(tabId: TabId): SectionId {
  if (tabId === "sample-status") return "sample-status";
  if (tabId === "customer" || tabId === "product" || tabId === "supplier" || tabId === "project") {
    return tabId;
  }
  return "settings";
}

function ProjectWorkspacePanel({
  selectedProjectId,
  selectedCanvasId,
  onOpenProject,
  onOpenCanvas,
  onOpenCanvasFromProject,
  onBackToProjects,
  onBackToProjectDetail,
}: {
  selectedProjectId: string | null;
  selectedCanvasId: string | null;
  onOpenProject: (projectId: string) => void;
  onOpenCanvas: (canvasId: string) => void;
  onOpenCanvasFromProject: (projectId: string, canvasId: string) => void;
  onBackToProjects: () => void;
  onBackToProjectDetail: () => void;
}) {
  if (!selectedProjectId) {
    return (
      <ProjectList
        redirectOnCreate={false}
        onOpenProject={onOpenProject}
        onOpenCanvas={onOpenCanvasFromProject}
        onProjectCreated={onOpenProject}
        stickyTopClassName="top-0"
        className="h-full"
        tableViewportClassName="flex-1"
      />
    );
  }

  if (selectedCanvasId) {
    return (
      <CanvasEditor
        projectId={selectedProjectId}
        canvasId={selectedCanvasId}
        embedded
        onBack={onBackToProjectDetail}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mb-5 w-fit"
        onClick={onBackToProjects}
      >
        <ChevronLeft />
        Projects
      </Button>
      <ProjectHeader projectId={selectedProjectId} stickyTopClassName="top-0" />
      <div className="mt-8">
        <CanvasList
          projectId={selectedProjectId}
          redirectOnCreate={false}
          onOpenCanvas={onOpenCanvas}
          onCanvasCreated={onOpenCanvas}
        />
      </div>
    </div>
  );
}

function renderTabContent({
  tabId,
  selectedProjectId,
  selectedCanvasId,
  onOpenProject,
  onOpenCanvas,
  onOpenCanvasFromProject,
  onBackToProjects,
  onBackToProjectDetail,
  entityMode,
  onEntityModeChange,
  entityFormVersion,
}: {
  tabId: TabId;
  selectedProjectId: string | null;
  selectedCanvasId: string | null;
  onOpenProject: (projectId: string) => void;
  onOpenCanvas: (canvasId: string) => void;
  onOpenCanvasFromProject: (projectId: string, canvasId: string) => void;
  onBackToProjects: () => void;
  onBackToProjectDetail: () => void;
  entityMode: WorkspaceMode;
  onEntityModeChange: (mode: WorkspaceMode) => void;
  entityFormVersion: number;
}): ReactNode {
  if (tabId === "project") {
    return (
      <ProjectWorkspacePanel
        selectedProjectId={selectedProjectId}
        selectedCanvasId={selectedCanvasId}
        onOpenProject={onOpenProject}
        onOpenCanvas={onOpenCanvas}
        onOpenCanvasFromProject={onOpenCanvasFromProject}
        onBackToProjects={onBackToProjects}
        onBackToProjectDetail={onBackToProjectDetail}
      />
    );
  }
  if (tabId === "sample-status") return <SampleStatusDashboard />;
  if (tabId === "smtp-settings") return <SmtpSettingsPanel />;
  if (tabId === "currency-settings") return <OrderedOptionSettingsPanel kind="currency" />;
  if (tabId === "destination-country-settings")
    return <OrderedOptionSettingsPanel kind="destination-country" />;
  if (tabId === "address-book-settings") return <OrderedOptionSettingsPanel kind="address-book" />;
  if (tabId === "generic-node-settings") return <GenericNodeSettingsPanel />;
  if (tabId === "gemini-settings") return <GeminiSearchSettingsPanel />;
  if (tabId === "customer")
    return (
      <EntityWorkspacePanel
        kind="customer"
        mode={entityMode}
        onModeChange={onEntityModeChange}
        formVersion={entityFormVersion}
      />
    );
  if (tabId === "supplier")
    return (
      <EntityWorkspacePanel
        kind="supplier"
        mode={entityMode}
        onModeChange={onEntityModeChange}
        formVersion={entityFormVersion}
      />
    );
  return (
    <EntityWorkspacePanel
      kind="product"
      mode={entityMode}
      onModeChange={onEntityModeChange}
      formVersion={entityFormVersion}
    />
  );
}

export function WorkspaceShell({
  isSupabaseConfigured,
  isImageGenerationConfigured,
}: {
  isSupabaseConfigured: boolean;
  isImageGenerationConfigured: boolean;
}) {
  const [expanded, setExpanded] = useState<SectionId | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(false);
  const [entityMode, setEntityMode] = useState<WorkspaceMode>("new");
  const [entityFormVersion, setEntityFormVersion] = useState(0);

  function syncMenuToTab(tabId: TabId) {
    const sectionId = sectionForTab(tabId);
    setActiveSection(sectionId);
    if (!isMenuCollapsed) setExpanded(sectionId);
  }

  function openTab(tabId: TabId) {
    setTabs((current) =>
      current.some((tab) => tab.id === tabId)
        ? current
        : [...current, { id: tabId, label: tabLabels[tabId] }],
    );
    setActiveTab(tabId);
    syncMenuToTab(tabId);
  }

  function activateTab(tabId: TabId) {
    setActiveTab(tabId);
    syncMenuToTab(tabId);
  }

  function openProjectDetail(projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedCanvasId(null);
    openTab("project");
  }

  function openCanvasDetail(canvasId: string) {
    setSelectedCanvasId(canvasId);
    openTab("project");
  }

  function openCanvasFromProject(projectId: string, canvasId: string) {
    setSelectedProjectId(projectId);
    setSelectedCanvasId(canvasId);
    openTab("project");
  }

  function backToProjects() {
    setSelectedProjectId(null);
    setSelectedCanvasId(null);
  }

  function selectSection(section: MenuSection) {
    if (isMenuCollapsed) {
      setIsMenuCollapsed(false);
      setExpanded(section.id);
      setActiveSection(section.id);
      return;
    }

    setExpanded((current) => (current === section.id ? null : section.id));
    setActiveSection(section.id);
    if (section.id === "project" || section.id === "sample-status" || section.id === "settings")
      openTab(section.tab);
  }

  function closeTab(tabId: TabId) {
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== tabId);
      if (activeTab === tabId) {
        const nextActiveTab = next.at(-1)?.id ?? null;
        setActiveTab(nextActiveTab);
        if (nextActiveTab) {
          syncMenuToTab(nextActiveTab);
        } else {
          setActiveSection(null);
          setExpanded(null);
        }
      }
      if (tabId === "project") {
        setSelectedProjectId(null);
        setSelectedCanvasId(null);
      }
      return next;
    });
  }

  return (
    <main className="bg-background flex h-dvh flex-1 flex-col overflow-hidden md:flex-row">
      <aside
        className={cn(
          "bg-sidebar text-sidebar-foreground flex shrink-0 flex-col border-b p-3 transition-[width] md:border-r md:border-b-0",
          isMenuCollapsed ? "md:w-16" : "md:w-72",
        )}
      >
        <div className={cn("mb-5 flex items-start gap-2", isMenuCollapsed && "justify-center")}>
          {!isMenuCollapsed ? (
            <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
              <span className="bg-sidebar-primary text-sidebar-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Layers3 className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Studio
                </p>
                <h1 className="truncate text-lg font-semibold tracking-tight">Infinite Canvas</h1>
              </div>
            </div>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={isMenuCollapsed ? "Expand menu" : "Collapse menu"}
            onClick={() => setIsMenuCollapsed((value) => !value)}
          >
            {isMenuCollapsed ? <Menu /> : <PanelLeftClose />}
          </Button>
        </div>

        <nav aria-label="Main menu" className="flex flex-col gap-1">
          {sections.map((section) => {
            const Icon = section.icon;
            const isExpanded = expanded === section.id;
            const isActive = activeSection === section.id;
            return (
              <section key={section.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  aria-expanded={section.items.length ? isExpanded : undefined}
                  title={isMenuCollapsed ? section.label : undefined}
                  onClick={() => selectSection(section)}
                  className={cn(
                    "focus-visible:ring-ring flex h-10 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2",
                    isMenuCollapsed && "justify-center",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      isActive ? "text-sidebar-primary-foreground" : "text-muted-foreground",
                    )}
                  />
                  {!isMenuCollapsed ? (
                    <>
                      <span className="min-w-0 flex-1 text-left">{section.label}</span>
                      {section.items.length ? (
                        <ChevronDown
                          className={cn(
                            "size-4 shrink-0 transition-transform",
                            isExpanded && "rotate-180",
                          )}
                        />
                      ) : null}
                    </>
                  ) : null}
                </button>

                {section.items.length > 0 && isExpanded && !isMenuCollapsed ? (
                  <div className="border-sidebar-border ml-4 flex flex-col gap-1 border-l pl-2">
                    {section.items.map((item) => (
                      <button
                        key={`${section.id}-${item.label}`}
                        type="button"
                        onClick={() => {
                          if (item.mode) setEntityMode(item.mode);
                          if (item.mode === "new") setEntityFormVersion((current) => current + 1);
                          if (section.id === "project") backToProjects();
                          openTab(item.tab);
                        }}
                        className={cn(
                          "focus-visible:ring-ring flex h-8 items-center rounded-md px-2 text-left text-sm transition-colors outline-none focus-visible:ring-2",
                          activeTab === item.tab &&
                            (item.mode
                              ? section.id === "project" || entityMode === item.mode
                              : true)
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </nav>

        {!isMenuCollapsed ? (
          <div className="border-sidebar-border bg-background/50 mt-auto flex flex-col gap-2 rounded-lg border p-3 text-xs">
            <span className="text-muted-foreground font-medium">Runtime</span>
            <div className="flex flex-wrap gap-2">
              <span className="bg-sidebar-accent rounded-md px-2 py-1">
                {isSupabaseConfigured ? "Cloud sync" : "Local mode"}
              </span>
              <span className="bg-sidebar-accent rounded-md px-2 py-1">
                {isImageGenerationConfigured ? "AI enabled" : "AI disabled"}
              </span>
            </div>
          </div>
        ) : null}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="bg-background/80 supports-[backdrop-filter]:bg-background/65 flex h-12 shrink-0 items-end gap-1 border-b px-4 backdrop-blur">
          {tabs.length > 0 ? (
            tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => activateTab(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    closeTab(tab.id);
                  }
                }}
                className={cn(
                  "focus-visible:ring-ring h-9 rounded-t-md border border-b-0 px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2",
                  activeTab === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))
          ) : (
            <span className="text-muted-foreground mb-3 text-sm font-medium">Workspace</span>
          )}
        </div>

        <div
          className={cn(
            "min-h-0 flex-1",
            activeTab === "project" && selectedCanvasId
              ? "overflow-hidden p-0"
              : activeTab === "project"
                ? "overflow-hidden p-6"
                : "overflow-auto p-6",
          )}
        >
          {activeTab ? (
            renderTabContent({
              tabId: activeTab,
              selectedProjectId,
              selectedCanvasId,
              onOpenProject: openProjectDetail,
              onOpenCanvas: openCanvasDetail,
              onOpenCanvasFromProject: openCanvasFromProject,
              onBackToProjects: backToProjects,
              onBackToProjectDetail: () => setSelectedCanvasId(null),
              entityMode,
              onEntityModeChange: setEntityMode,
              entityFormVersion,
            })
          ) : (
            <div className="mx-auto flex h-full min-h-96 w-full max-w-4xl flex-col justify-center">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Workspace
              </p>
              <h2 className="mt-2 text-4xl font-semibold tracking-tight">Infinite Canvas</h2>
              <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-6">
                Choose an area from the sidebar to create, review, or open project canvases.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
