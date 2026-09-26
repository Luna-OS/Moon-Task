import type { ReactNode } from "react";
import type { ActivityEvent, History } from "@/lib/history";
import {
  formatBytes,
  formatClock,
  formatDuration,
  formatFrequency,
  formatPercent,
  formatRate,
} from "@/lib/format";
import type { ProcessRow, Snapshot, SystemInfo } from "@/types/models";
import { MoonPhase } from "@/components/MoonPhase";
import { Meter, Sparkline } from "@/components/charts";
import { Card, EmptyState, Facts, OwnerDot } from "@/components/ui";

export function OverviewView({
  snapshot,
  history,
  activity,
  info,
  onOpenProcess,
}: {
  snapshot: Snapshot | null;
  history: History;
  activity: ActivityEvent[];
  info: SystemInfo | null;
  onOpenProcess: (pid: number) => void;
}) {
  if (!snapshot) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mt-glass mt-skeleton h-36" />
        ))}
      </div>
    );
  }

  const mem = snapshot.memory;
  const byCpu = [...snapshot.processes].sort((a, b) => b.cpu - a.cpu).slice(0, 6);
  const byMemory = [...snapshot.processes].sort((a, b) => b.memory - a.memory).slice(0, 6);
  const maxFrequency = Math.max(0, ...snapshot.cpu.cores.map((c) => c.frequency));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="CPU"
          value={formatPercent(snapshot.cpu.total)}
          sub={`${snapshot.cpu.cores.length} threads · ${formatFrequency(maxFrequency)}`}
          fraction={snapshot.cpu.total / 100}
        >
          <Sparkline values={history.cpu} max={100} />
        </StatTile>
        <StatTile
          label="Memory"
          value={formatBytes(mem.used)}
          sub={`of ${formatBytes(mem.total)} · ${formatBytes(mem.available)} free`}
          fraction={mem.total > 0 ? mem.used / mem.total : 0}
        >
          <Sparkline values={history.memory} max={mem.total} />
        </StatTile>
        <StatTile
          label="Disk"
          value={formatRate(snapshot.disk.readRate + snapshot.disk.writeRate)}
          sub={`read ${formatRate(snapshot.disk.readRate)} · write ${formatRate(snapshot.disk.writeRate)}`}
        >
          <Sparkline values={history.diskRead.map((r, i) => r + (history.diskWrite[i] ?? 0))} />
        </StatTile>
        <StatTile
          label="Network"
          value={formatRate(snapshot.network.rxRate + snapshot.network.txRate)}
          sub={`↓ ${formatRate(snapshot.network.rxRate)} · ↑ ${formatRate(snapshot.network.txRate)}`}
        >
          <Sparkline values={history.netRx.map((r, i) => r + (history.netTx[i] ?? 0))} tone={2} />
        </StatTile>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Busiest right now" bodyClassName="p-2">
          <TopList
            rows={byCpu}
            value={(p) => formatPercent(p.cpu)}
            share={(p) => p.cpu / 100}
            onOpen={onOpenProcess}
          />
        </Card>
        <Card title="Most memory" bodyClassName="p-2">
          <TopList
            rows={byMemory}
            value={(p) => formatBytes(p.memory)}
            share={(p) => (mem.total > 0 ? p.memory / mem.total : 0)}
            onOpen={onOpenProcess}
          />
        </Card>
        <Card title="This machine">
          <Facts
            items={[
              ["Host", info?.hostName ?? "–"],
              ["System", info?.osVersion ?? info?.osName ?? "–"],
              ["Kernel", info?.kernelVersion ?? "–"],
              ["CPU", info?.cpuBrand || "–"],
              [
                "Cores",
                info
                  ? `${info.physicalCores ?? "?"} cores · ${info.logicalCores} threads · ${info.arch}`
                  : "–",
              ],
              ["Uptime", formatDuration(snapshot.uptime)],
              [
                "Load",
                snapshot.load
                  ? `${snapshot.load.one.toFixed(2)} · ${snapshot.load.five.toFixed(2)} · ${snapshot.load.fifteen.toFixed(2)}`
                  : "–",
              ],
              ["Processes", `${snapshot.processCount} processes · ${snapshot.threadCount} threads`],
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Activity" bodyClassName="max-h-72 overflow-auto p-2">
          {activity.length === 0 ? (
            <EmptyState title="All quiet">
              Processes that start or end while MoonTask is open appear here.
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {activity.map((e, i) => (
                <li key={`${e.at}-${e.kind}-${e.pid}-${i}`}>
                  <button
                    type="button"
                    disabled={e.kind === "ended"}
                    onClick={() => onOpenProcess(e.pid)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm enabled:hover:bg-(--mt-hover)"
                  >
                    <span className="w-20 text-xs text-(--mt-text-faint) tabular-nums">
                      {formatClock(e.at)}
                    </span>
                    <span
                      className={`mt-chip ${e.kind === "started" ? "mt-chip-mint" : "mt-chip-danger"}`}
                    >
                      {e.kind === "started" ? "Started" : "Ended"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    <span className="text-xs text-(--mt-text-muted) tabular-nums">{e.pid}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Storage" bodyClassName="max-h-72 overflow-auto p-4">
          <Volumes snapshot={snapshot} />
        </Card>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  fraction,
  children,
}: {
  label: string;
  value: string;
  sub: string;
  fraction?: number;
  children: ReactNode;
}) {
  return (
    <section className="mt-glass flex flex-col overflow-hidden" aria-label={`${label}: ${value}`}>
      <div className="flex items-center gap-3 px-4 pt-4">
        {fraction !== undefined && <MoonPhase fraction={fraction} size={42} />}
        <div className="min-w-0">
          <h2 className="mt-eyebrow">{label}</h2>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        </div>
      </div>
      <p className="truncate px-4 pt-1 text-xs text-(--mt-text-muted)">{sub}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function TopList({
  rows,
  value,
  share,
  onOpen,
}: {
  rows: ProcessRow[];
  value: (p: ProcessRow) => string;
  share: (p: ProcessRow) => number;
  onOpen: (pid: number) => void;
}) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rows.map((p) => (
        <li key={p.pid}>
          <button
            type="button"
            onClick={() => onOpen(p.pid)}
            className="flex w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-left hover:bg-(--mt-hover)"
          >
            <span className="flex w-full items-center gap-2 text-sm">
              <OwnerDot owner={p.owner} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <span className="tabular-nums">{value(p)}</span>
            </span>
            <Meter fraction={share(p)} label={`${p.name}: ${value(p)}`} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Volumes({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.disk.volumes.length === 0) {
    return <EmptyState title="No volumes found" />;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {snapshot.disk.volumes.map((v) => {
        const used = v.total - v.available;
        return (
          <li key={`${v.name}-${v.mountPoint}`} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-medium">{v.mountPoint}</span>{" "}
                <span className="text-xs text-(--mt-text-muted)">
                  {v.name} · {v.fileSystem}
                  {v.kind !== "unknown" ? ` · ${v.kind.toUpperCase()}` : ""}
                  {v.removable ? " · removable" : ""}
                </span>
              </span>
              <span className="text-xs whitespace-nowrap text-(--mt-text-muted) tabular-nums">
                {formatBytes(used)} of {formatBytes(v.total)}
              </span>
            </div>
            <Meter fraction={v.total > 0 ? used / v.total : 0} label={`${v.mountPoint} used`} />
          </li>
        );
      })}
    </ul>
  );
}
