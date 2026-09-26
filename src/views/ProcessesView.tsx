import { useMemo, useState, type RefObject } from "react";
import {
  processId,
  visibleRows,
  type OwnerFilter,
  type SortKey,
  type SortState,
  type ViewMode,
  type VisibleRow,
} from "@/lib/processes";
import { processKey, type History } from "@/lib/history";
import { formatBytes, formatPercent } from "@/lib/format";
import type { Platform, ProcessAction, ProcessRow, Snapshot } from "@/types/models";
import { ProcessTable } from "@/components/ProcessTable";
import { ProcessDetail } from "@/components/ProcessDetail";
import { AppsIcon, CloseIcon, ListIcon, StopIcon, TreeIcon } from "@/components/icons";
import { Card, EmptyState, Facts, OwnerDot, SearchField, Segmented } from "@/components/ui";

export interface ProcessesViewProps {
  snapshot: Snapshot | null;
  history: History;
  fresh: ReadonlySet<string>;
  platform: Platform;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  showKernel: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAction: (row: ProcessRow, action: ProcessAction) => void;
  onEndGroup: (name: string, members: ProcessRow[]) => void;
  onReveal: (row: ProcessRow) => void;
}

export function ProcessesView({
  snapshot,
  history,
  fresh,
  platform,
  mode,
  onModeChange,
  sort,
  onSortChange,
  showKernel,
  query,
  onQueryChange,
  searchRef,
  selectedId,
  onSelect,
  onAction,
  onEndGroup,
  onReveal,
}: ProcessesViewProps) {
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());

  const processes = useMemo(() => snapshot?.processes ?? [], [snapshot]);
  const rows = useMemo(
    () => visibleRows(processes, { mode, sort, query, owner, showKernel, collapsed, openGroups }),
    [processes, mode, sort, query, owner, showKernel, collapsed, openGroups],
  );
  const names = useMemo(() => new Map(processes.map((p) => [p.pid, p.name])), [processes]);

  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;
  // The selection survives filtering and collapsing: look it up in the
  // full list, not only among the visible rows.
  const selectedProcess =
    selectedId?.startsWith("p:") === true
      ? (processes.find((p) => processId(p.pid) === selectedId) ?? null)
      : null;

  function toggle(row: VisibleRow, expanded?: boolean) {
    if (row.kind === "group") {
      setOpenGroups((prev) => {
        const next = new Set(prev);
        const open = expanded ?? !next.has(row.id);
        if (open) next.add(row.id);
        else next.delete(row.id);
        return next;
      });
      return;
    }
    const pid = row.process.pid;
    setCollapsed((prev) => {
      const next = new Set(prev);
      const open = expanded ?? next.has(pid);
      if (open) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  function sortBy(key: SortKey) {
    onSortChange(
      sort.key === key
        ? { key, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "user" || key === "pid" ? "asc" : "desc" },
    );
  }

  const selectedGroup =
    selectedRow?.kind === "group"
      ? selectedRow
      : selectedId?.startsWith("g:") === true
        ? (visibleRows(processes, {
            mode: "apps",
            sort,
            query: "",
            owner: "all",
            showKernel: true,
            collapsed,
            openGroups,
          }).find((r) => r.id === selectedId) ?? null)
        : null;

  const showPanel = selectedProcess !== null || selectedGroup !== null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-64 flex-1">
          <SearchField
            inputRef={searchRef}
            value={query}
            onChange={onQueryChange}
            label="Search processes"
            placeholder="Search by name, PID, user or command line  ( / )"
          />
        </div>
        <Segmented
          label="View"
          value={mode}
          onChange={onModeChange}
          options={[
            {
              value: "tree",
              label: (
                <>
                  <TreeIcon /> Tree
                </>
              ),
              title: "Parent and child processes",
            },
            {
              value: "list",
              label: (
                <>
                  <ListIcon /> List
                </>
              ),
              title: "Every process, flat",
            },
            {
              value: "apps",
              label: (
                <>
                  <AppsIcon /> Apps
                </>
              ),
              title: "Processes grouped by program",
            },
          ]}
        />
        <Segmented
          label="Owner"
          value={owner}
          onChange={setOwner}
          options={[
            { value: "all", label: "All" },
            { value: "mine", label: "Mine" },
            { value: "others", label: "System & others" },
          ]}
        />
      </div>

      <div
        className={`grid min-h-0 flex-1 gap-3 ${
          showPanel ? "grid-cols-[minmax(0,1fr)_27rem]" : "grid-cols-1"
        }`}
      >
        <Card
          className="min-h-0"
          bodyClassName="min-h-0 h-full"
          title={
            <span>
              {rows.length === processes.length || mode === "apps"
                ? `${processes.length} processes`
                : `${rows.length} of ${processes.length} processes`}
            </span>
          }
          actions={<Legend />}
        >
          {snapshot === null ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="mt-skeleton h-6 rounded" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title="No matching processes">
              Nothing matches “{query}”. Try a shorter search or another owner filter.
            </EmptyState>
          ) : (
            <ProcessTable
              rows={rows}
              selectedId={selectedId}
              fresh={fresh}
              sort={sort}
              onSort={sortBy}
              compact={showPanel}
              onSelect={(row) => onSelect(row.id)}
              onToggle={toggle}
              onEnd={(row, force) => {
                if (row.kind === "group") onEndGroup(row.process.name, row.members ?? []);
                else onAction(row.process, { type: force ? "kill" : "terminate" });
              }}
            />
          )}
        </Card>

        {selectedProcess && (
          <ProcessDetail
            row={selectedProcess}
            platform={platform}
            history={history.processes.get(processKey(selectedProcess))}
            names={names}
            onAction={onAction}
            onReveal={onReveal}
            onSelectPid={(pid) => onSelect(processId(pid))}
            onClose={() => onSelect(null)}
          />
        )}
        {!selectedProcess && selectedGroup && (
          <GroupSummary
            row={selectedGroup}
            onSelectPid={(pid) => onSelect(processId(pid))}
            onEndAll={() => onEndGroup(selectedGroup.process.name, selectedGroup.members ?? [])}
            onClose={() => onSelect(null)}
          />
        )}
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    ["current", "You"],
    ["system", "System"],
    ["other", "Other users"],
  ] as const;
  return (
    <div className="hidden items-center gap-3 text-xs text-(--mt-text-muted) lg:flex">
      {items.map(([owner, label]) => (
        <span key={owner} className="inline-flex items-center gap-1.5">
          <OwnerDot owner={owner} /> {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm bg-(--mt-new) ring-1 ring-mint-400/40" />
        Just started
      </span>
    </div>
  );
}

function GroupSummary({
  row,
  onSelectPid,
  onEndAll,
  onClose,
}: {
  row: VisibleRow;
  onSelectPid: (pid: number) => void;
  onEndAll: () => void;
  onClose: () => void;
}) {
  const members = [...(row.members ?? [])].sort((a, b) => b.cpu - a.cpu || b.memory - a.memory);
  const endable = members.filter((m) => !m.protected);
  return (
    <aside
      aria-label={`${row.process.name} app group`}
      className="mt-glass flex min-h-0 flex-col overflow-hidden"
    >
      <header className="flex items-start gap-3 border-b border-(--mt-border) px-4 pt-3.5 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{row.process.name}</h2>
          <p className="mt-0.5 text-xs text-(--mt-text-muted)">
            {members.length} processes of the same program
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="mt-btn mt-btn-ghost mt-btn-icon mt-btn-sm"
        >
          <CloseIcon />
        </button>
      </header>
      <div className="flex items-center gap-2 border-b border-(--mt-border) px-4 py-2.5">
        <button
          type="button"
          className="mt-btn mt-btn-danger mt-btn-sm"
          disabled={endable.length === 0}
          onClick={onEndAll}
        >
          <StopIcon /> End all {endable.length}
        </button>
      </div>
      <div className="flex flex-col gap-4 overflow-auto p-4">
        <Facts
          items={[
            ["CPU", formatPercent(row.process.cpu)],
            ["Memory", formatBytes(row.process.memory)],
            ["Threads", row.process.threads ?? "–"],
            ["User", row.process.user ?? "–"],
          ]}
        />
        <div className="flex flex-col gap-1">
          <span className="mt-eyebrow">Processes</span>
          <ul className="m-0 flex list-none flex-col p-0">
            {members.map((m) => (
              <li key={m.pid}>
                <button
                  type="button"
                  onClick={() => onSelectPid(m.pid)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-(--mt-hover)"
                >
                  <span className="w-14 text-(--mt-text-muted) tabular-nums">{m.pid}</span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs text-(--mt-text-muted)"
                    title={m.command}
                  >
                    {m.command || m.name}
                  </span>
                  <span className="tabular-nums">{m.cpu.toFixed(1)} %</span>
                  <span className="w-20 text-right tabular-nums">{formatBytes(m.memory)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
