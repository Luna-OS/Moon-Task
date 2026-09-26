import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SortKey, SortState, VisibleRow } from "@/lib/processes";
import { processKey } from "@/lib/history";
import { formatBytes, formatRate } from "@/lib/format";
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon, ShieldIcon } from "@/components/icons";
import { OwnerDot, StateText } from "@/components/ui";

const ROW_HEIGHT = 30;
const OVERSCAN = 12;

interface Column {
  key: SortKey;
  label: string;
  width?: string;
  align?: "right";
  title?: string;
  /** Hidden while the detail panel takes space (it shows these anyway). */
  secondary?: boolean;
}

const COLUMNS: Column[] = [
  { key: "name", label: "Name" },
  { key: "pid", label: "PID", width: "5rem", align: "right" },
  { key: "user", label: "User", width: "8.5rem", secondary: true },
  {
    key: "cpu",
    label: "CPU",
    width: "5.5rem",
    align: "right",
    title: "Share of the whole machine, so the column adds up to the CPU total",
  },
  { key: "memory", label: "Memory", width: "6.5rem", align: "right", title: "Resident memory" },
  { key: "threads", label: "Threads", width: "5rem", align: "right", secondary: true },
  {
    key: "disk",
    label: "Disk",
    width: "7rem",
    align: "right",
    title: "Read + write per second",
    secondary: true,
  },
  { key: "status", label: "Status", width: "6.5rem" },
];

export interface ProcessTableProps {
  rows: VisibleRow[];
  selectedId: string | null;
  fresh: ReadonlySet<string>;
  sort: SortState;
  onSort: (key: SortKey) => void;
  onSelect: (row: VisibleRow) => void;
  onToggle: (row: VisibleRow, expanded?: boolean) => void;
  /** Delete / Shift+Delete on the selected row. */
  onEnd: (row: VisibleRow, force: boolean) => void;
  /** Fewer columns, for when the detail panel is open. */
  compact?: boolean;
}

export function ProcessTable({
  rows,
  selectedId,
  fresh,
  sort,
  onSort,
  onSelect,
  onToggle,
  onEnd,
  compact = false,
}: ProcessTableProps) {
  const columns = compact ? COLUMNS.filter((c) => !c.secondary) : COLUMNS;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    setViewport(el.clientHeight || 600);
    return () => observer.disconnect();
  }, []);

  const selectedIndex = selectedId === null ? -1 : rows.findIndex((r) => r.id === selectedId);

  // Keep the selection in view when it moves by keyboard.
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || selectedIndex < 0 || lastSelected.current === selectedId) return;
    lastSelected.current = selectedId;
    const top = selectedIndex * ROW_HEIGHT;
    const header = ROW_HEIGHT + 4;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight - header) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight + header;
    }
  }, [selectedId, selectedIndex]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const slice = rows.slice(start, end);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (rows.length === 0) return;
    const current = selectedIndex >= 0 ? rows[selectedIndex] : null;
    const page = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1);
    const move = (index: number) => {
      e.preventDefault();
      onSelect(rows[Math.min(rows.length - 1, Math.max(0, index))]);
    };
    switch (e.key) {
      case "ArrowDown":
        return move(selectedIndex + 1);
      case "ArrowUp":
        return move(selectedIndex < 0 ? 0 : selectedIndex - 1);
      case "PageDown":
        return move(selectedIndex + page);
      case "PageUp":
        return move(selectedIndex - page);
      case "Home":
        return move(0);
      case "End":
        return move(rows.length - 1);
      case "ArrowRight":
        if (current?.hasChildren && !current.expanded) {
          e.preventDefault();
          onToggle(current, true);
        }
        return;
      case "ArrowLeft":
        if (current?.hasChildren && current.expanded) {
          e.preventDefault();
          onToggle(current, false);
        } else if (current && current.depth > 0) {
          // Jump to the parent row.
          for (let i = selectedIndex - 1; i >= 0; i--) {
            if (rows[i].depth < current.depth) return move(i);
          }
        }
        return;
      case "Delete":
        if (current) {
          e.preventDefault();
          onEnd(current, e.shiftKey);
        }
        return;
    }
  }

  return (
    <div
      ref={scroller}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="h-full min-h-0 overflow-auto rounded-b-[inherit]"
    >
      <table
        role="treegrid"
        aria-label="Process list"
        aria-rowcount={rows.length + 1}
        aria-activedescendant={selectedIndex >= 0 ? rowDomId(rows[selectedIndex].id) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="mt-table table-fixed focus-visible:outline-offset-[-2px]"
        style={{ minWidth: compact ? "26rem" : "44rem" }}
      >
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={c.align === "right" ? "text-right" : undefined}
                >
                  <button
                    type="button"
                    title={c.title}
                    onClick={() => onSort(c.key)}
                    className={`inline-flex items-center gap-1 uppercase hover:text-(--mt-text) ${
                      active ? "text-(--mt-accent)" : ""
                    }`}
                  >
                    {c.label}
                    {active && (sort.dir === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {start > 0 && <tr aria-hidden="true" style={{ height: start * ROW_HEIGHT }} />}
          {slice.map((row, i) => (
            <Row
              key={row.id}
              index={start + i}
              row={row}
              selected={row.id === selectedId}
              fresh={row.kind === "process" && fresh.has(processKey(row.process))}
              onSelect={onSelect}
              onToggle={onToggle}
              compact={compact}
            />
          ))}
          {end < rows.length && (
            <tr aria-hidden="true" style={{ height: (rows.length - end) * ROW_HEIGHT }} />
          )}
        </tbody>
      </table>
    </div>
  );
}

/** A DOM id for a row; process names never end up in it. */
function rowDomId(id: string): string {
  return `proc-row-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function Row({
  row,
  index,
  selected,
  fresh,
  onSelect,
  onToggle,
  compact,
}: {
  row: VisibleRow;
  index: number;
  compact: boolean;
  selected: boolean;
  fresh: boolean;
  onSelect: (row: VisibleRow) => void;
  onToggle: (row: VisibleRow, expanded?: boolean) => void;
}) {
  const p = row.process;
  const group = row.kind === "group";
  const heat = Math.min(100, p.cpu);
  return (
    <tr
      id={rowDomId(row.id)}
      aria-selected={selected}
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-rowindex={index + 2}
      onClick={() => onSelect(row)}
      onDoubleClick={() => row.hasChildren && onToggle(row)}
      className={`cursor-default ${row.dimmed ? "opacity-45" : ""}`}
      style={{
        height: ROW_HEIGHT,
        background: fresh && !selected ? "var(--mt-new)" : undefined,
      }}
    >
      <td title={p.command || p.exe || p.name}>
        <span className="flex items-center gap-1.5" style={{ paddingLeft: row.depth * 16 }}>
          {row.hasChildren ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={row.expanded ? `Collapse ${p.name}` : `Expand ${p.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(row);
              }}
              className="flex size-4 items-center justify-center rounded text-(--mt-text-muted) hover:text-(--mt-text)"
            >
              <ChevronIcon open={row.expanded} />
            </button>
          ) : (
            <span className="inline-block w-4" />
          )}
          <OwnerDot owner={p.owner} />
          <span className="truncate font-medium">{p.name}</span>
          {group && (
            <span className="mt-chip mt-chip-muted" title="Processes in this app">
              {row.members?.length}
            </span>
          )}
          {p.protected && !group && (
            <span
              className="text-(--mt-text-faint)"
              title="Protected — ending it would crash the system or MoonTask itself"
            >
              <ShieldIcon />
            </span>
          )}
        </span>
      </td>
      <td className="text-right text-(--mt-text-muted)">{group ? "" : p.pid}</td>
      {!compact && <td className="text-(--mt-text-muted)">{p.user ?? "–"}</td>}
      <td
        className="text-right"
        style={
          heat >= 0.5
            ? {
                background: `color-mix(in srgb, var(--mt-chart-1) ${Math.round(
                  8 + Math.min(heat, 50) * 0.8,
                )}%, transparent)`,
              }
            : undefined
        }
      >
        {p.cpu < 0.05 ? "0.0" : p.cpu.toFixed(1)}
      </td>
      <td className="text-right">{formatBytes(p.memory)}</td>
      {!compact && (
        <>
          <td className="text-right text-(--mt-text-muted)">{p.threads ?? "–"}</td>
          <td className="text-right text-(--mt-text-muted)">
            {p.diskRead + p.diskWrite > 0 ? formatRate(p.diskRead + p.diskWrite) : ""}
          </td>
        </>
      )}
      <td>
        <StateText state={p.status} />
      </td>
    </tr>
  );
}
