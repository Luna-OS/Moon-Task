import { useCallback, useMemo, useState, type ReactNode } from "react";
import { getProcessDetails, listConnections } from "@/lib/ipc";
import { usePolling } from "@/hooks/usePolling";
import {
  formatBytes,
  formatCpuTime,
  formatDateTime,
  formatDuration,
  formatPercent,
} from "@/lib/format";
import { isAllowed } from "@/lib/risk";
import type { ProcessHistory } from "@/lib/history";
import type { Platform, Priority, ProcessAction, ProcessDetails, ProcessRow } from "@/types/models";
import { Sparkline } from "@/components/charts";
import {
  BranchIcon,
  CloseIcon,
  FolderIcon,
  KillIcon,
  ResumeIcon,
  ShieldIcon,
  StopIcon,
  SuspendIcon,
} from "@/components/icons";
import { EmptyState, Facts, OwnerDot, StateText } from "@/components/ui";
import { OWNER_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import { ConnectionTable } from "@/components/ConnectionTable";

const TABS = ["general", "threads", "modules", "handles", "network", "environment"] as const;
type DetailTab = (typeof TABS)[number];
const TAB_LABELS: Record<DetailTab, string> = {
  general: "General",
  threads: "Threads",
  modules: "Modules",
  handles: "Handles",
  network: "Network",
  environment: "Env",
};

export interface ProcessDetailProps {
  row: ProcessRow;
  platform: Platform;
  history: ProcessHistory | undefined;
  /** Name of every PID, to label parents and socket owners. */
  names: ReadonlyMap<number, string>;
  onAction: (row: ProcessRow, action: ProcessAction) => void;
  onReveal: (row: ProcessRow) => void;
  onSelectPid: (pid: number) => void;
  onClose: () => void;
}

export function ProcessDetail({
  row,
  platform,
  history,
  names,
  onAction,
  onReveal,
  onSelectPid,
  onClose,
}: ProcessDetailProps) {
  const [tab, setTab] = useState<DetailTab>("general");
  const pid = row.pid;
  const loadDetails = useCallback(() => getProcessDetails(pid), [pid]);
  const details = usePolling(loadDetails, 2000);
  const d = details.data;

  return (
    <aside
      aria-label={`Details of ${row.name}`}
      className="mt-glass flex min-h-0 w-full flex-col overflow-hidden"
    >
      <header className="flex items-start gap-3 border-b border-(--mt-border) px-4 pt-3.5 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <OwnerDot owner={row.owner} />
            <h2 className="truncate text-base font-semibold" title={row.name}>
              {row.name}
            </h2>
            {row.protected && (
              <span className="mt-chip mt-chip-muted" title="Can't be ended or suspended">
                <ShieldIcon size={11} /> Protected
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-(--mt-text-muted)">
            PID {row.pid} · {row.user ?? OWNER_LABELS[row.owner]} · <StateText state={row.status} />
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

      <Actions
        row={row}
        platform={platform}
        priority={d?.priority ?? null}
        onAction={onAction}
        onReveal={onReveal}
      />

      <div
        role="tablist"
        aria-label="Process details"
        className="flex gap-0.5 overflow-x-auto border-b border-(--mt-border) px-2"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            id={`detail-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="detail-panel"
            onClick={() => setTab(t)}
            title={t === "environment" ? "Environment variables" : undefined}
            className={`-mb-px border-b-2 px-2 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
              tab === t
                ? "border-(--mt-accent) text-(--mt-accent)"
                : "border-transparent text-(--mt-text-muted) hover:text-(--mt-text)"
            }`}
          >
            {TAB_LABELS[t]}
            {t === "threads" && d?.threads && <Count n={d.threads.length} />}
            {t === "modules" && d?.modules && <Count n={d.modules.length} />}
            {t === "handles" && d?.handles && <Count n={d.handles.length} />}
          </button>
        ))}
      </div>

      <div
        id="detail-panel"
        role="tabpanel"
        aria-labelledby={`detail-tab-${tab}`}
        className="min-h-0 flex-1 overflow-auto"
      >
        {details.error && !d ? (
          <EmptyState title="Details unavailable">{details.error}</EmptyState>
        ) : !d ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="mt-skeleton h-5 rounded" />
            ))}
          </div>
        ) : (
          <TabBody
            tab={tab}
            row={row}
            details={d}
            platform={platform}
            history={history}
            names={names}
            onSelectPid={onSelectPid}
          />
        )}
      </div>
    </aside>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1 text-(--mt-text-faint) tabular-nums">{n}</span>;
}

function Actions({
  row,
  platform,
  priority,
  onAction,
  onReveal,
}: {
  row: ProcessRow;
  platform: Platform;
  priority: Priority | null;
  onAction: (row: ProcessRow, action: ProcessAction) => void;
  onReveal: (row: ProcessRow) => void;
}) {
  const blocked = row.protected;
  const stopped = row.status === "stopped";
  // Windows doesn't report a suspended state, so offer both there.
  const showSuspend = platform === "windows" || !stopped;
  const showResume = platform === "windows" || stopped;
  const priorities: Priority[] = ["idle", "belowNormal", "normal", "aboveNormal", "high"];
  const blockedTitle = blocked ? "Protected process" : undefined;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-(--mt-border) px-4 py-2.5">
      <button
        type="button"
        className="mt-btn mt-btn-danger mt-btn-sm"
        disabled={!isAllowed(row, "terminate")}
        title={blockedTitle ?? "Ask the process to quit (Delete)"}
        onClick={() => onAction(row, { type: "terminate" })}
      >
        <StopIcon /> End
      </button>
      {platform !== "windows" && (
        <button
          type="button"
          className="mt-btn mt-btn-danger mt-btn-sm"
          disabled={!isAllowed(row, "kill")}
          title={blockedTitle ?? "End immediately, without letting it save (Shift+Delete)"}
          onClick={() => onAction(row, { type: "kill" })}
        >
          <KillIcon /> Kill
        </button>
      )}
      <button
        type="button"
        className="mt-btn mt-btn-ghost mt-btn-sm"
        disabled={!isAllowed(row, "killTree")}
        title={blockedTitle ?? "End this process and everything it started"}
        onClick={() => onAction(row, { type: "killTree" })}
      >
        <BranchIcon /> End tree
      </button>
      {showSuspend && (
        <button
          type="button"
          className="mt-btn mt-btn-warning mt-btn-sm"
          disabled={!isAllowed(row, "suspend")}
          title={blockedTitle ?? "Freeze the process until it is resumed"}
          onClick={() => onAction(row, { type: "suspend" })}
        >
          <SuspendIcon /> Suspend
        </button>
      )}
      {showResume && (
        <button
          type="button"
          className="mt-btn mt-btn-ghost mt-btn-sm"
          onClick={() => onAction(row, { type: "resume" })}
        >
          <ResumeIcon /> Resume
        </button>
      )}
      <label className="ml-auto flex items-center gap-1.5 text-xs text-(--mt-text-muted)">
        Priority
        <select
          className="mt-input h-7 px-2 text-xs"
          disabled={blocked || priority === null}
          value={priority ?? ""}
          onChange={(e) =>
            onAction(row, { type: "setPriority", priority: e.target.value as Priority })
          }
        >
          {priority === null && <option value="">–</option>}
          {priority === "realtime" && <option value="realtime">Realtime</option>}
          {priorities.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="mt-btn mt-btn-ghost mt-btn-icon mt-btn-sm"
        disabled={!row.exe}
        title="Show the executable in the file manager"
        aria-label="Open file location"
        onClick={() => onReveal(row)}
      >
        <FolderIcon />
      </button>
    </div>
  );
}

function TabBody({
  tab,
  row,
  details,
  platform,
  history,
  names,
  onSelectPid,
}: {
  tab: DetailTab;
  row: ProcessRow;
  details: ProcessDetails;
  platform: Platform;
  history: ProcessHistory | undefined;
  names: ReadonlyMap<number, string>;
  onSelectPid: (pid: number) => void;
}) {
  const unavailable = (what: string) => (
    <EmptyState title={`${what} not available`}>
      {platform === "macos"
        ? `macOS only lets debuggers and root look at another process' ${what.toLowerCase()}.`
        : platform === "windows" && what === "Handles"
          ? "Listing handles on Windows is planned for a later version."
          : `MoonTask can't read them for this process — it probably belongs to another user. Start MoonTask with administrator rights to see them.`}
    </EmptyState>
  );

  switch (tab) {
    case "general":
      return <General row={row} d={details} history={history} onSelectPid={onSelectPid} />;
    case "threads":
      return details.threads ? (
        <SimpleTable
          head={["TID", "Name", "State", "CPU time", "Prio"]}
          right={[0, 3, 4]}
          rows={details.threads.map((t) => [
            t.tid,
            t.name ?? "–",
            t.state ?? "–",
            t.cpuTime === null ? "–" : formatCpuTime(t.cpuTime),
            t.priority ?? "–",
          ])}
        />
      ) : (
        unavailable("Threads")
      );
    case "modules":
      return details.modules ? (
        <SimpleTable
          head={["Name", "Base", "Size"]}
          right={[2]}
          rows={details.modules.map((m) => [
            <span key="n" title={m.path}>
              {m.name}
            </span>,
            <span key="b" className="font-mono text-xs">
              {m.base ?? "–"}
            </span>,
            m.size === null ? "–" : formatBytes(m.size),
          ])}
        />
      ) : (
        unavailable("Modules")
      );
    case "handles":
      return details.handles ? (
        <SimpleTable
          head={["FD", "Type", "Target"]}
          right={[0]}
          rows={details.handles.map((h) => [
            h.fd,
            h.kind,
            <span key="t" title={h.target}>
              {h.target}
            </span>,
          ])}
        />
      ) : (
        unavailable("Handles")
      );
    case "network":
      return <ProcessConnections pid={row.pid} names={names} />;
    case "environment":
      return details.environment.length > 0 ? (
        <SimpleTable
          head={["Variable", "Value"]}
          rows={details.environment.map((e) => [
            <span key="k" className="font-medium">
              {e.key}
            </span>,
            <span key="v" className="font-mono text-xs" title={e.value}>
              {e.value}
            </span>,
          ])}
        />
      ) : (
        unavailable("Environment")
      );
  }
}

function General({
  row,
  d,
  history,
  onSelectPid,
}: {
  row: ProcessRow;
  d: ProcessDetails;
  history: ProcessHistory | undefined;
  onSelectPid: (pid: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="CPU" value={formatPercent(row.cpu)}>
          <Sparkline values={history?.cpu ?? []} max={100} capacity={60} height={32} />
        </MiniStat>
        <MiniStat label="Memory" value={formatBytes(row.memory)}>
          <Sparkline values={history?.memory ?? []} capacity={60} height={32} tone={2} />
        </MiniStat>
      </div>
      <Facts
        items={[
          [
            "Parent",
            d.parent ? (
              <button
                type="button"
                className="text-(--mt-accent) hover:underline"
                onClick={() => onSelectPid(d.parent!.pid)}
              >
                {d.parent.name} ({d.parent.pid})
              </button>
            ) : (
              "–"
            ),
          ],
          ["Started", `${formatDateTime(d.startTime)} (${formatDuration(d.runTime)} ago)`],
          ["CPU time", formatCpuTime(d.cpuTime)],
          ["Virtual memory", formatBytes(d.virtualMemory)],
          ["Disk read", formatBytes(d.totalDiskRead)],
          ["Disk written", formatBytes(d.totalDiskWritten)],
          [
            "Priority",
            d.priority
              ? `${PRIORITY_LABELS[d.priority]}${d.nice !== null ? ` (nice ${d.nice})` : ""}`
              : "–",
          ],
          ["Open files", d.openFiles ?? "–"],
          ["Threads", row.threads ?? "–"],
        ]}
      />
      <Block label="Executable">{d.exe ?? "–"}</Block>
      <Block label="Command line">{d.command.length > 0 ? d.command.join(" ") : "–"}</Block>
      <Block label="Working directory">{d.cwd ?? "–"}</Block>
    </div>
  );
}

function MiniStat({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-inset flex flex-col gap-1 overflow-hidden px-3 pt-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-(--mt-text-muted)">{label}</span>
        <span className="text-sm font-semibold tabular-nums">{value}</span>
      </div>
      <div className="-mx-3">{children}</div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="mt-eyebrow">{label}</span>
      <p className="mt-inset m-0 px-3 py-2 font-mono text-xs leading-relaxed break-all select-text">
        {children}
      </p>
    </div>
  );
}

function SimpleTable({
  head,
  rows,
  right = [],
}: {
  head: string[];
  rows: ReactNode[][];
  right?: number[];
}) {
  if (rows.length === 0) return <EmptyState title="Nothing here" />;
  return (
    <table className="mt-table table-fixed">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} scope="col" className={right.includes(i) ? "text-right" : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, r) => (
          <tr key={r}>
            {cells.map((c, i) => (
              <td key={i} className={right.includes(i) ? "text-right" : undefined}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProcessConnections({ pid, names }: { pid: number; names: ReadonlyMap<number, string> }) {
  const connections = usePolling(listConnections, 3000);
  const mine = useMemo(
    () => (connections.data ?? []).filter((c) => c.pids.includes(pid)),
    [connections.data, pid],
  );
  if (connections.error)
    return <EmptyState title="Can't list connections">{connections.error}</EmptyState>;
  if (!connections.data) return <div className="mt-skeleton m-4 h-5 rounded" />;
  if (mine.length === 0) {
    return (
      <EmptyState title="No open connections">This process has no TCP or UDP sockets.</EmptyState>
    );
  }
  return <ConnectionTable connections={mine} names={names} compact />;
}
