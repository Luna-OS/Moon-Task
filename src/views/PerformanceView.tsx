import { useState, type ReactNode } from "react";
import type { History } from "@/lib/history";
import {
  formatBytes,
  formatFrequency,
  formatPercent,
  formatRate,
  formatTemperature,
} from "@/lib/format";
import type { Gpu, Snapshot, SystemInfo } from "@/types/models";
import { AreaChart, Meter, Sparkline } from "@/components/charts";
import {
  CpuIcon,
  DiskIcon,
  GpuIcon,
  MemoryIcon,
  NetworkIcon,
  ThermometerIcon,
} from "@/components/icons";
import { Card, EmptyState, Facts } from "@/components/ui";
import { Volumes } from "@/views/OverviewView";

type Section = "cpu" | "memory" | "disk" | "network" | "sensors" | `gpu-${number}`;

export function PerformanceView({
  snapshot,
  history,
  info,
}: {
  snapshot: Snapshot | null;
  history: History;
  info: SystemInfo | null;
}) {
  const [section, setSection] = useState<Section>("cpu");
  if (!snapshot) return <div className="mt-glass mt-skeleton h-96" />;

  const mem = snapshot.memory;
  const nav: { id: Section; label: string; icon: ReactNode; value: string; spark: ReactNode }[] = [
    {
      id: "cpu",
      label: "CPU",
      icon: <CpuIcon />,
      value: formatPercent(snapshot.cpu.total),
      spark: <Sparkline values={history.cpu} max={100} height={24} />,
    },
    {
      id: "memory",
      label: "Memory",
      icon: <MemoryIcon />,
      value: `${formatBytes(mem.used)} / ${formatBytes(mem.total)}`,
      spark: <Sparkline values={history.memory} max={mem.total} height={24} />,
    },
    {
      id: "disk",
      label: "Disk",
      icon: <DiskIcon />,
      value: formatRate(snapshot.disk.readRate + snapshot.disk.writeRate),
      spark: (
        <Sparkline
          values={history.diskRead.map((r, i) => r + (history.diskWrite[i] ?? 0))}
          height={24}
        />
      ),
    },
    {
      id: "network",
      label: "Network",
      icon: <NetworkIcon />,
      value: formatRate(snapshot.network.rxRate + snapshot.network.txRate),
      spark: (
        <Sparkline
          values={history.netRx.map((r, i) => r + (history.netTx[i] ?? 0))}
          height={24}
          tone={2}
        />
      ),
    },
  ];
  snapshot.gpus.forEach((gpu, i) => {
    nav.push({
      id: `gpu-${i}`,
      label: snapshot.gpus.length > 1 ? `GPU ${i}` : "GPU",
      icon: <GpuIcon />,
      value: [gpu.utilization === null ? null : formatPercent(gpu.utilization, 0), gpu.name]
        .filter(Boolean)
        .join(" · "),
      spark: <Sparkline values={history.gpu[i] ?? []} max={100} height={24} />,
    });
  });
  if (snapshot.sensors.length > 0) {
    const hottest = Math.max(...snapshot.sensors.map((s) => s.temperature));
    nav.push({
      id: "sensors",
      label: "Sensors",
      icon: <ThermometerIcon />,
      value: `${hottest.toFixed(0)} °C`,
      spark: null,
    });
  }

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Resources" className="flex flex-col gap-2">
        {nav.map((n) => (
          <button
            key={n.id}
            type="button"
            aria-pressed={section === n.id}
            onClick={() => setSection(n.id)}
            className={`mt-glass flex flex-col overflow-hidden text-left transition-[border-color,box-shadow] duration-200 ${
              section === n.id
                ? "border-lavender-300/60 shadow-[0_0_0_1px_rgb(214_207_253/0.3)]"
                : "hover:border-lavender-400/35"
            }`}
          >
            <span className="flex items-center gap-2 px-3 pt-2.5 text-sm font-medium">
              {n.icon}
              {n.label}
            </span>
            <span className="truncate px-3 pb-1 text-xs text-(--mt-text-muted) tabular-nums">
              {n.value}
            </span>
            {n.spark}
          </button>
        ))}
      </nav>

      <div className="min-h-0 overflow-auto">
        {section === "cpu" && <CpuSection snapshot={snapshot} history={history} info={info} />}
        {section === "memory" && <MemorySection snapshot={snapshot} history={history} />}
        {section === "disk" && <DiskSection snapshot={snapshot} history={history} />}
        {section === "network" && <NetworkSection snapshot={snapshot} history={history} />}
        {section === "sensors" && <SensorSection snapshot={snapshot} />}
        {section.startsWith("gpu-") && snapshot.gpus[Number(section.slice(4))] && (
          <GpuSection
            gpu={snapshot.gpus[Number(section.slice(4))]}
            index={Number(section.slice(4))}
            history={history}
          />
        )}
      </div>
    </div>
  );
}

function CpuSection({
  snapshot,
  history,
  info,
}: {
  snapshot: Snapshot;
  history: History;
  info: SystemInfo | null;
}) {
  const cores = snapshot.cpu.cores;
  const avgFreq = cores.length
    ? Math.round(cores.reduce((s, c) => s + c.frequency, 0) / cores.length)
    : 0;
  return (
    <div className="flex flex-col gap-4">
      <Card title={info?.cpuBrand || "CPU"}>
        <AreaChart
          label="CPU usage"
          series={[{ label: "CPU", values: history.cpu, tone: 1 }]}
          timestamps={history.timestamps}
          max={100}
          format={(v) => `${v.toFixed(0)} %`}
          height={200}
        />
        <div className="mt-4">
          <Facts
            items={[
              ["Usage", formatPercent(snapshot.cpu.total)],
              ["Speed", formatFrequency(avgFreq)],
              [
                "Cores",
                `${info?.physicalCores ?? "?"} physical · ${info?.logicalCores ?? cores.length} logical`,
              ],
              ["Processes", `${snapshot.processCount} · ${snapshot.threadCount} threads`],
              [
                "Load average",
                snapshot.load
                  ? `${snapshot.load.one.toFixed(2)} (1 min) · ${snapshot.load.five.toFixed(2)} (5 min) · ${snapshot.load.fifteen.toFixed(2)} (15 min)`
                  : "–",
              ],
            ]}
          />
        </div>
      </Card>
      <Card title="Per logical core">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
          {cores.map((c, i) => (
            <div key={i} className="mt-inset flex flex-col overflow-hidden pt-1.5">
              <div className="flex items-baseline justify-between px-2.5 text-xs">
                <span className="text-(--mt-text-muted)">Core {i}</span>
                <span className="font-medium tabular-nums">{c.usage.toFixed(0)} %</span>
              </div>
              <Sparkline values={history.cores[i] ?? []} max={100} height={34} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function MemorySection({ snapshot, history }: { snapshot: Snapshot; history: History }) {
  const m = snapshot.memory;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Memory">
        <AreaChart
          label="Memory in use"
          series={[{ label: "In use", values: history.memory, tone: 1 }]}
          timestamps={history.timestamps}
          max={m.total}
          format={(v) => formatBytes(v)}
          height={200}
        />
        <div className="mt-4">
          <Facts
            items={[
              ["In use", `${formatBytes(m.used)} (${formatPercent((m.used / m.total) * 100, 0)})`],
              ["Available", formatBytes(m.available)],
              ["Total", formatBytes(m.total)],
            ]}
          />
        </div>
      </Card>
      {m.swapTotal > 0 && (
        <Card title="Swap">
          <AreaChart
            label="Swap in use"
            series={[{ label: "Swap", values: history.swap, tone: 2 }]}
            timestamps={history.timestamps}
            max={m.swapTotal}
            format={(v) => formatBytes(v)}
            height={120}
          />
          <p className="mt-3 text-sm text-(--mt-text-muted)">
            {formatBytes(m.swapUsed)} of {formatBytes(m.swapTotal)} in use
          </p>
        </Card>
      )}
    </div>
  );
}

function DiskSection({ snapshot, history }: { snapshot: Snapshot; history: History }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Disk activity">
        <AreaChart
          label="Disk throughput"
          series={[
            { label: "Read", values: history.diskRead, tone: 1 },
            { label: "Write", values: history.diskWrite, tone: 2 },
          ]}
          timestamps={history.timestamps}
          format={formatRate}
          height={200}
        />
      </Card>
      <Card title="Volumes">
        <Volumes snapshot={snapshot} />
      </Card>
    </div>
  );
}

function NetworkSection({ snapshot, history }: { snapshot: Snapshot; history: History }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Network throughput">
        <AreaChart
          label="Network throughput"
          series={[
            { label: "Download", values: history.netRx, tone: 1 },
            { label: "Upload", values: history.netTx, tone: 2 },
          ]}
          timestamps={history.timestamps}
          format={formatRate}
          height={200}
        />
      </Card>
      <Card title="Interfaces" bodyClassName="p-0">
        <InterfaceTable snapshot={snapshot} />
      </Card>
    </div>
  );
}

export function InterfaceTable({ snapshot }: { snapshot: Snapshot }) {
  return (
    <table className="mt-table table-fixed">
      <thead>
        <tr>
          <th scope="col">Interface</th>
          <th scope="col" className="text-right">
            Download
          </th>
          <th scope="col" className="text-right">
            Upload
          </th>
          <th scope="col" className="text-right">
            Received
          </th>
          <th scope="col" className="text-right">
            Sent
          </th>
        </tr>
      </thead>
      <tbody>
        {snapshot.network.interfaces.map((i) => (
          <tr key={i.name} className={i.loopback ? "opacity-60" : undefined}>
            <td title={i.name}>
              {i.name}
              {i.loopback && <span className="ml-2 text-xs text-(--mt-text-faint)">loopback</span>}
            </td>
            <td className="text-right">{formatRate(i.rxRate)}</td>
            <td className="text-right">{formatRate(i.txRate)}</td>
            <td className="text-right text-(--mt-text-muted)">{formatBytes(i.totalRx)}</td>
            <td className="text-right text-(--mt-text-muted)">{formatBytes(i.totalTx)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SensorSection({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.sensors.length === 0) return <EmptyState title="No sensors found" />;
  return (
    <Card title="Temperatures">
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2 p-0">
        {snapshot.sensors.map((s, i) => {
          const hot = s.critical !== null && s.temperature >= s.critical - 10;
          return (
            <li
              key={`${s.label}-${i}`}
              className="mt-inset flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm" title={s.label}>
                {s.label}
              </span>
              <span
                className={`text-sm font-semibold tabular-nums ${hot ? "text-(--mt-warning)" : ""}`}
              >
                {s.temperature.toFixed(0)} °C
                {hot && <span className="sr-only"> (close to critical)</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function GpuSection({ gpu, index, history }: { gpu: Gpu; index: number; history: History }) {
  const facts: [string, string][] = [
    ["Load", gpu.utilization === null ? "not reported" : formatPercent(gpu.utilization)],
  ];
  if (gpu.memoryTotal !== null) {
    facts.push([
      "Dedicated memory",
      gpu.memoryUsed !== null
        ? `${formatBytes(gpu.memoryUsed)} of ${formatBytes(gpu.memoryTotal)}`
        : formatBytes(gpu.memoryTotal),
    ]);
  }
  if (gpu.sharedTotal !== null || gpu.sharedUsed !== null) {
    facts.push([
      "Shared memory",
      gpu.sharedTotal !== null
        ? `${formatBytes(gpu.sharedUsed ?? 0)} of ${formatBytes(gpu.sharedTotal)}`
        : formatBytes(gpu.sharedUsed ?? 0),
    ]);
  }
  if (gpu.temperature !== null) facts.push(["Temperature", formatTemperature(gpu.temperature)]);
  if (gpu.vendor) facts.push(["Vendor", gpu.vendor]);

  return (
    <div className="flex flex-col gap-4">
      <Card title={gpu.name}>
        {gpu.utilization === null ? (
          <p className="text-sm text-(--mt-text-muted)">
            This GPU's driver doesn't report its load. Name, memory and temperature are shown where
            available.
          </p>
        ) : (
          <AreaChart
            label="GPU load"
            series={[{ label: "GPU", values: history.gpu[index] ?? [], tone: 1 }]}
            timestamps={history.timestamps}
            max={100}
            format={(v) => `${v.toFixed(0)} %`}
            height={200}
          />
        )}
        <div className="mt-4">
          <Facts items={facts} />
        </div>
      </Card>
      {gpu.engines.length > 0 && (
        <Card title="Engines">
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3 p-0">
            {gpu.engines.map((e) => (
              <li key={e.name} className="flex flex-col gap-1.5">
                <span className="flex items-baseline justify-between text-sm">
                  <span>{e.name}</span>
                  <span className="font-medium tabular-nums">
                    {formatPercent(e.utilization, 0)}
                  </span>
                </span>
                <Meter fraction={e.utilization / 100} label={`${e.name} load`} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {gpu.memoryTotal !== null && gpu.memoryUsed !== null && (
        <Card title="Dedicated memory">
          <AreaChart
            label="Dedicated GPU memory in use"
            series={[{ label: "In use", values: history.gpuMemory[index] ?? [], tone: 2 }]}
            timestamps={history.timestamps}
            max={gpu.memoryTotal}
            format={(v) => formatBytes(v)}
            height={140}
          />
        </Card>
      )}
    </div>
  );
}
