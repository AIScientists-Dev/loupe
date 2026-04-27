"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Archive,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  Github,
  Inbox as InboxIcon,
  Loader2,
  Move,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { LoupeLockup, LoupeMark } from "@/components/brand/loupe-mark";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserChip } from "@/components/shell/user-chip";
import { useGlossary } from "@/lib/hooks/use-glossary";
import { initialsFor, useProfile } from "@/lib/hooks/use-profile";
import { useSettingsDialog } from "@/lib/hooks/use-settings-dialog";
import {
  STATUS_FOLDERS,
  VENUE_GROUPS,
  buildVenueTree,
  useSidebarFolders,
  type StatusFolderKey,
} from "@/lib/hooks/use-folders";
import {
  useFolderHydration,
  useFolderMutations,
} from "@/lib/hooks/use-folder-store";
import { useOnboardingHydration } from "@/lib/hooks/use-onboarding";
import type { VenueType } from "@/lib/types";

const RAIL_W = 60;
const FULL_W = 280;

const STATUS_ICON: Record<StatusFolderKey, React.ComponentType<{ className?: string }>> = {
  processing: Loader2,
  stage_1: Search,
  stage_2: CheckCircle2,
};

export function Sidebar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const openGlossary = useGlossary((s) => s.openAt);
  const [expanded, setExpanded] = React.useState(false);
  // Hydrate the local folder store from /v1/folders on first mount, and
  // keep it in sync as the React Query cache refetches.
  useFolderHydration();
  // Pull the onboarding profile from the server so the gate (and the
  // settings panel's defaults) reflect what's persisted.
  useOnboardingHydration();

  const closeTimerRef = React.useRef<number | null>(null);
  const onEnter = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setExpanded(true);
  };
  const onLeave = () => {
    closeTimerRef.current = window.setTimeout(() => setExpanded(false), 120);
  };

  const onPapersList = pathname === "/papers";
  const activeStatus = onPapersList ? (search.get("status") as StatusFolderKey | null) : null;
  const activeVenue = onPapersList ? search.get("folder") : null;
  const activeAll =
    onPapersList && !activeStatus && !activeVenue;

  return (
    <aside
      className="relative h-screen shrink-0"
      style={{ width: RAIL_W }}
      aria-label="Primary navigation"
    >
      <div
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className={cn(
          "absolute inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
          expanded ? "shadow-xl" : "",
        )}
        style={{ width: expanded ? FULL_W : RAIL_W }}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex h-[68px] shrink-0 items-center",
            expanded ? "px-3" : "justify-center px-0",
          )}
        >
          <Link
            href="/papers"
            aria-label="Loupe"
            className={cn(
              "flex h-10 items-center transition-opacity hover:opacity-80",
              expanded ? "" : "justify-center",
            )}
          >
            {expanded ? (
              <span className="pl-2">
                <LoupeLockup height={32} />
              </span>
            ) : (
              <LoupeMark size={26} />
            )}
          </Link>
        </div>

        {/* Nav body — collapsed shows just icons; expanded shows folder list */}
        {expanded ? (
          <div className="flex-1 overflow-y-auto px-2">
            <ExpandedFolderNav
              activeAll={activeAll}
              activeStatus={activeStatus}
              activeVenue={activeVenue}
            />
          </div>
        ) : (
          <CollapsedRailNav onPapersList={onPapersList} />
        )}

        {/* Footer */}
        <div className="border-t border-sidebar-border p-2">
          <CollapsibleUserChip expanded={expanded} />
          <div
            className={cn(
              "mt-1 flex items-center gap-0.5 px-0.5",
              expanded ? "justify-between" : "flex-col gap-1",
            )}
          >
            <div
              className={cn(
                "flex items-center gap-0.5",
                expanded ? "flex-row" : "flex-col",
              )}
            >
              <Link
                href="https://github.com/morphmind/loupe"
                target="_blank"
                rel="noreferrer"
                title="GitHub"
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  expanded ? "px-1.5" : "size-7 justify-center",
                )}
              >
                <Github className="size-3" />
                {expanded && <span>GitHub</span>}
              </Link>
              <button
                onClick={() => openGlossary()}
                title="Glossary"
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  expanded ? "px-1.5" : "size-7 justify-center",
                )}
                aria-label="Open glossary"
              >
                <BookOpen className="size-3" />
                {expanded && <span>Glossary</span>}
              </button>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  );
}

// ---- Expanded folder nav --------------------------------------------------

function ExpandedFolderNav({
  activeAll,
  activeStatus,
  activeVenue,
}: {
  activeAll: boolean;
  activeStatus: StatusFolderKey | null;
  activeVenue: string | null;
}) {
  const data = useSidebarFolders();

  return (
    <nav className="flex flex-col gap-3 py-2">
      <SectionLabel>Library</SectionLabel>
      <div className="flex flex-col gap-0.5">
        <FolderRow
          href="/papers"
          icon={InboxIcon}
          label="All papers"
          count={data.totalCount}
          active={activeAll}
        />
      </div>

      <SectionLabel>Status</SectionLabel>
      <div className="flex flex-col gap-0.5">
        {STATUS_FOLDERS.map((s) => {
          const Icon = STATUS_ICON[s.key];
          return (
            <FolderRow
              key={s.key}
              href={`/papers?status=${s.key}`}
              icon={Icon}
              label={s.label}
              count={data.statusCounts[s.key]}
              active={activeStatus === s.key}
              hint={s.hint}
              spinning={s.key === "processing"}
            />
          );
        })}
      </div>

      <SectionLabel>Venues</SectionLabel>
      <div className="flex flex-col gap-0.5">
        <VenueTreeNav
          activeVenue={activeVenue}
          venueFolders={data.venueFolders}
          venueCounts={data.venueCounts}
          folderMeta={data.folderMeta}
          papers={data.papers}
        />
        {data.unfiledCount > 0 && (
          <FolderRow
            href="/papers?folder=__unfiled"
            icon={Archive}
            label="Unfiled"
            count={data.unfiledCount}
            active={activeVenue === "__unfiled"}
            hint="Papers without a venue folder"
          />
        )}
      </div>
    </nav>
  );
}

// ---- Venue tree (parent groups + indented children) -----------------------

function VenueTreeNav({
  activeVenue,
  venueFolders,
  venueCounts,
  folderMeta,
  papers,
}: {
  activeVenue: string | null;
  venueFolders: string[];
  venueCounts: Record<string, number>;
  folderMeta: ReturnType<typeof useSidebarFolders>["folderMeta"];
  papers: ReturnType<typeof useSidebarFolders>["papers"];
}) {
  const tree = React.useMemo(
    () => buildVenueTree(venueFolders, folderMeta),
    [venueFolders, folderMeta],
  );
  const orphanNames = React.useMemo(() => {
    const set = new Set<string>();
    for (const name of venueFolders) set.add(name);
    return set;
  }, [venueFolders]);

  return (
    <>
      {tree.parents.map((p) => {
        // Roll up the parent's own count + every child's count so the
        // collapsed parent row tells you at a glance how many papers live
        // under that venue type.
        const ownCount = venueCounts[p.name] ?? 0;
        const childCount = p.children.reduce(
          (sum, c) => sum + (venueCounts[c] ?? 0),
          0,
        );
        return (
          <VenueParent
            key={p.name}
            name={p.name}
            venue_type={p.venue_type}
            count={ownCount + childCount}
            active={activeVenue === p.name}
            children_={p.children}
            venueCounts={venueCounts}
            activeVenue={activeVenue}
            folderMeta={folderMeta}
            paperIdsInFolder={(name: string) =>
              papers.filter((q) => q.folder === name).map((q) => q.id)
            }
            existingNames={orphanNames}
          />
        );
      })}
      {/* Orphan folders (no venue_type set) — render as flat top-level rows
          so the user can still see and use them, then move them under a
          parent via the row's "Move under" affordance. */}
      {tree.orphans.map((name) => (
        <VenueFolderRow
          key={name}
          name={name}
          count={venueCounts[name] ?? 0}
          active={activeVenue === name}
          paperIdsInFolder={papers
            .filter((q) => q.folder === name)
            .map((q) => q.id)}
          isDefault={folderMeta[name]?.is_default ?? false}
          venueType={folderMeta[name]?.venue_type ?? null}
        />
      ))}
      <NewTopLevelFolderInput existingNames={Array.from(orphanNames)} />
    </>
  );
}

function VenueParent({
  name,
  venue_type,
  count,
  active,
  children_,
  venueCounts,
  activeVenue,
  folderMeta,
  paperIdsInFolder,
  existingNames,
}: {
  name: string;
  venue_type: VenueType;
  count: number;
  active: boolean;
  children_: string[];
  venueCounts: Record<string, number>;
  activeVenue: string | null;
  folderMeta: ReturnType<typeof useSidebarFolders>["folderMeta"];
  paperIdsInFolder: (name: string) => string[];
  existingNames: Set<string>;
}) {
  // Persist expand-collapse per-parent in localStorage so the user's view
  // sticks across reloads. Default open if any child is active or has count.
  const storageKey = `loupe.sidebar.parent.${name}`;
  const [open, setOpen] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "0") return false;
    if (saved === "1") return true;
    return children_.length > 0;
  });
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, open ? "1" : "0");
  }, [open, storageKey]);
  // Reopen if a child becomes active.
  const childActive = children_.some((c) => c === activeVenue);
  React.useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  const Icon = active ? FolderOpen : Folder;
  return (
    <div className="flex flex-col">
      <div className="group relative flex items-center">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        >
          <ChevronDown
            className={cn(
              "size-3 transition-transform",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
        </button>
        <Link
          href={`/papers?folder=${encodeURIComponent(name)}`}
          className={cn(
            "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 transition-colors",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
          )}
        >
          <Icon className={cn("size-3.5 shrink-0", active && "text-primary")} />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">
            {name}
          </span>
          {count > 0 && (
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums transition-opacity group-hover:opacity-0",
                active
                  ? "bg-sidebar-accent-foreground/15 text-sidebar-accent-foreground"
                  : "bg-muted-foreground/15 text-muted-foreground",
              )}
            >
              {count}
            </span>
          )}
        </Link>
        {/* Hover-only "+ child" so the expanded tree feels self-contained. */}
        <ParentAddChildButton parentName={name} parentVenueType={venue_type} />
      </div>
      {open && (
        <div className="ml-5 flex flex-col gap-0.5 border-l border-sidebar-border/60 pl-1.5">
          {children_.map((c) => (
            <VenueFolderRow
              key={c}
              name={c}
              count={venueCounts[c] ?? 0}
              active={activeVenue === c}
              paperIdsInFolder={paperIdsInFolder(c)}
              isDefault={folderMeta[c]?.is_default ?? false}
              venueType={folderMeta[c]?.venue_type ?? null}
            />
          ))}
          {children_.length === 0 && (
            <div className="px-2 py-1 text-[10px] text-muted-foreground">
              No {name.toLowerCase()} folders yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ParentAddChildButton({
  parentName,
  parentVenueType,
}: {
  parentName: string;
  parentVenueType: VenueType;
}) {
  const { create } = useFolderMutations();
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const submit = async () => {
    const name = draft.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    try {
      await create(name, parentVenueType);
    } catch {
      // duplicate or 409 — silently revert
    }
    setAdding(false);
    setDraft("");
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft("");
          setAdding(true);
        }}
        title={`Add a folder under ${parentName}`}
        aria-label={`Add a folder under ${parentName}`}
        className="ml-0.5 grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100"
      >
        <Plus className="size-3" />
      </button>
    );
  }
  return (
    <div className="absolute inset-x-5 inset-y-0 z-10 flex items-center gap-1 rounded-md bg-sidebar-accent/30 px-2">
      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setAdding(false);
          }
        }}
        placeholder={`Folder under ${parentName}`}
        className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
}

// ---- Per-folder row with rename + delete affordances --------------------

function VenueFolderRow({
  name,
  count,
  active,
  paperIdsInFolder,
  isDefault = false,
  venueType = null,
}: {
  name: string;
  count: number;
  active: boolean;
  paperIdsInFolder: string[];
  isDefault?: boolean;
  venueType?: VenueType | null;
}) {
  const { renameFolder, deleteFolder, setVenueType } = useFolderMutations();
  const [editing, setEditing] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const [draft, setDraft] = React.useState(name);

  const startRename = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraft(name);
    setEditing(true);
  };

  const commitRename = async () => {
    const next = draft.trim();
    if (!next || next === name) {
      setEditing(false);
      return;
    }
    try {
      const ok = await renameFolder(name, next);
      if (!ok) setDraft(name); // duplicate or empty — silently revert
    } catch {
      // Backend rejected (e.g., conflict). Revert.
      setDraft(name);
    }
    setEditing(false);
  };

  const onDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const msg = paperIdsInFolder.length
      ? `Delete folder "${name}"? ${paperIdsInFolder.length} paper${paperIdsInFolder.length === 1 ? "" : "s"} will move to Unfiled.`
      : `Delete folder "${name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await deleteFolder(name);
    } catch {
      // is_default folders refuse delete; we already rolled back optimistically.
    }
  };

  if (editing) {
    return (
      <div className="flex h-8 items-center gap-1 rounded-md bg-sidebar-accent/30 px-2">
        {/* Inline rename input. Enter commits, Esc reverts, blur commits too. */}
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setDraft(name);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-foreground outline-none"
        />
      </div>
    );
  }

  const Icon = active ? FolderOpen : Folder;
  return (
    <div className="group relative">
      <Link
        href={`/papers?folder=${encodeURIComponent(name)}`}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md px-2 transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon className={cn("size-3.5 shrink-0", active && "text-primary")} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
        {count > 0 && (
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums transition-opacity group-hover:opacity-0",
              active
                ? "bg-sidebar-accent-foreground/15 text-sidebar-accent-foreground"
                : "bg-muted-foreground/15 text-muted-foreground",
            )}
          >
            {count}
          </span>
        )}
      </Link>
      {/* Hover-only action icons — float on top of the count chip so the row
          stays compact when idle. */}
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {!isDefault && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMoving((v) => !v);
            }}
            title="Move under another venue group"
            aria-label={`Move ${name}`}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <Move className="size-3" />
          </button>
        )}
        <button
          type="button"
          onClick={startRename}
          title="Rename"
          aria-label={`Rename ${name}`}
          className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
        {!isDefault && (
          <button
            type="button"
            onClick={onDelete}
            title="Delete folder (papers move to Unfiled)"
            aria-label={`Delete ${name}`}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>
      {/* Tiny inline "move under" picker — shown when the user toggled it
          via the move button. Cheap dropdown that calls setVenueType and
          closes itself. */}
      {moving && (
        <div className="absolute right-1 top-8 z-20 flex flex-col rounded-md border border-sidebar-border bg-popover p-1 shadow-md">
          {VENUE_GROUPS.map((g) => (
            <button
              key={g.name}
              type="button"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                setMoving(false);
                if (venueType !== g.venue_type) {
                  await setVenueType(name, g.venue_type);
                }
              }}
              className={cn(
                "flex h-7 items-center gap-2 rounded px-2 text-left text-xs hover:bg-sidebar-accent",
                venueType === g.venue_type && "bg-sidebar-accent/60",
              )}
            >
              <Folder className="size-3 text-muted-foreground" />
              <span>{g.name}</span>
              {venueType === g.venue_type && (
                <span className="ml-auto text-[10px] text-muted-foreground">current</span>
              )}
            </button>
          ))}
          {venueType !== null && (
            <button
              type="button"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                setMoving(false);
                await setVenueType(name, null);
              }}
              className="mt-0.5 flex h-7 items-center gap-2 rounded px-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent"
            >
              <Archive className="size-3" />
              <span>Top level</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NewTopLevelFolderInput({ existingNames }: { existingNames: string[] }) {
  const { create } = useFolderMutations();
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft("");
          setAdding(true);
        }}
        className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        <Plus className="size-3.5 shrink-0" />
        <span>New top-level folder</span>
      </button>
    );
  }

  const submit = async () => {
    const name = draft.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    if (existingNames.includes(name)) {
      // Silent no-op: existing name. Keep the input open so the user can fix it.
      return;
    }
    await create(name);
    setAdding(false);
    setDraft("");
  };

  return (
    <div className="flex h-8 items-center gap-1 rounded-md bg-sidebar-accent/30 px-2">
      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setAdding(false);
          }
        }}
        placeholder="Folder name"
        className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </div>
  );
}

function FolderRow({
  href,
  icon: Icon,
  label,
  count,
  active,
  hint,
  spinning,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  active: boolean;
  hint?: string;
  spinning?: boolean;
}) {
  return (
    <Link
      href={href}
      title={hint}
      className={cn(
        "group flex h-8 items-center gap-2 rounded-md px-2 transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          spinning && count > 0 && "animate-spin text-primary",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
            active
              ? "bg-sidebar-accent-foreground/15 text-sidebar-accent-foreground"
              : "bg-muted-foreground/15 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

// ---- Collapsed rail (icon-only) ------------------------------------------

function CollapsedRailNav({ onPapersList }: { onPapersList: boolean }) {
  return (
    <nav className="flex-1 px-2">
      <Link
        href="/papers"
        title="Papers"
        className={cn(
          "group relative flex h-9 items-center justify-center rounded-md transition-colors",
          onPapersList
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        )}
      >
        <FileText className="size-4 shrink-0" />
      </Link>
    </nav>
  );
}

function CollapsibleUserChip({ expanded }: { expanded: boolean }) {
  const profile = useProfile();
  const openSettings = useSettingsDialog((s) => s.openDialog);

  if (!expanded) {
    return (
      <button
        onClick={openSettings}
        title={`${profile.name} — Settings`}
        aria-label="Open settings"
        className="grid size-9 w-full place-items-center rounded-md transition-colors hover:bg-sidebar-accent/60"
      >
        <span className="grid size-7 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {initialsFor(profile)}
        </span>
      </button>
    );
  }
  return <UserChip />;
}
