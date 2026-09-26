import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getSystemInfo, revealProcess, runProcessAction, runServiceAction } from "@/lib/ipc";
import { useMonitor } from "@/hooks/useMonitor";
import { countDescendants, processId, type SortState, type ViewMode } from "@/lib/processes";
import { ACTION_LABELS, isAllowed, needsConfirmation } from "@/lib/risk";
import { loadSettings, resolveTheme, saveSettings, type Settings } from "@/lib/settings";
import { formatBytes, formatDuration, formatPercent } from "@/lib/format";
import { PRIORITY_LABELS } from "@/lib/labels";
import { primaryGpu } from "@/lib/gpu";
import type {
  Platform,
  ProcessAction,
  ProcessRow,
  Service,
  ServiceAction,
  SystemInfo,
} from "@/types/models";
import { Sky } from "@/components/Sky";
import { MoonPhase } from "@/components/MoonPhase";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Banner } from "@/components/Banner";
import {
  AlertIcon,
  CheckIcon,
  NetworkIcon,
  OverviewIcon,
  PauseIcon,
  PerformanceIcon,
  PlayIcon,
  ProcessesIcon,
  RefreshIcon,
  ServicesIcon,
  SettingsIcon,
} from "@/components/icons";
import { OverviewView } from "@/views/OverviewView";
import { ProcessesView } from "@/views/ProcessesView";
import { PerformanceView } from "@/views/PerformanceView";
import { NetworkView } from "@/views/NetworkView";
import { ServicesView } from "@/views/ServicesView";
import { SettingsView } from "@/views/SettingsView";

type View = "overview" | "processes" | "performance" | "network" | "services" | "settings";

const VIEWS: { id: View; label: string; subtitle: string; icon: ReactNode }[] = [
  {
    id: "overview",
    label: "Overview",
    subtitle: "Your machine at a glance.",
    icon: <OverviewIcon />,
  },
  {
    id: "processes",
    label: "Processes",
    subtitle: "Everything that runs — as a tree, a list or by app.",
    icon: <ProcessesIcon />,
  },
  {
    id: "performance",
    label: "Performance",
    subtitle: "CPU, memory, disks and network over time.",
    icon: <PerformanceIcon />,
  },
  {
    id: "network",
    label: "Network",
    subtitle: "Open connections and who holds them.",
    icon: <NetworkIcon />,
  },
  {
    id: "services",
    label: "Services",
    subtitle: "Background services of your system.",
    icon: <ServicesIcon />,
  },
  { id: "settings", label: "Settings", subtitle: "Make MoonTask yours.", icon: <SettingsIcon /> },
];

interface Pending {
  title: string;
  consequence: string;
  summary: string;
  confirmLabel: string;
  /** Runs the confirmed action and returns the success message. */
  run: () => Promise<string>;
}

type Toast = { kind: "success" | "error"; text: string };

function processSummary(row: ProcessRow): string {
  return [
    `Process: ${row.name} (PID ${row.pid})`,
    `User:    ${row.user ?? "unknown"}`,
    row.command ? `Command: ${row.command}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function consequenceOf(row: ProcessRow, action: ProcessAction, children: number): string {
  const foreign = row.owner !== "current" ? ` It belongs to ${row.user ?? "another user"}.` : "";
  switch (action.type) {
    case "terminate":
      return `The process is asked to quit. Unsaved work in it may be lost.${foreign}`;
    case "kill":
      return `The process is ended immediately. Unsaved work in it will be lost.${foreign}`;
    case "killTree":
      return `The process and ${children} process${children === 1 ? "" : "es"} it started are ended immediately. Unsaved work in them will be lost.`;
    case "suspend":
      return `The process freezes until you resume it. Suspending a system process can make other programs hang.${foreign}`;
    default:
      return "";
  }
}

function successText(row: ProcessRow, action: ProcessAction, platform: Platform, affected: number) {
  switch (action.type) {
    case "terminate":
      return platform === "windows" ? `Ended ${row.name}.` : `Asked ${row.name} to quit.`;
    case "kill":
      return `Killed ${row.name}.`;
    case "killTree":
      return `Ended ${row.name} and ${affected - 1} child process${affected === 2 ? "" : "es"}.`;
    case "suspend":
      return `Suspended ${row.name}.`;
    case "resume":
      return `Resumed ${row.name}.`;
    case "setPriority":
      return `${row.name} now runs at ${PRIORITY_LABELS[action.priority].toLowerCase()} priority.`;
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)
  );
}

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [paused, setPaused] = useState(false);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [serviceReload, setServiceReload] = useState(0);
  const [prefersLight, setPrefersLight] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false,
  );
  const searchRef = useRef<HTMLInputElement>(null);

  const monitor = useMonitor(settings.refreshMs, paused);
  const { snapshot, refreshNow } = monitor;
  const platform: Platform = info?.platform ?? "linux";

  useEffect(() => {
    getSystemInfo().then(setInfo, (e: unknown) => setInfoError(String(e)));
  }, []);

  // Theme: explicit choice, or follow the OS.
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!media) return;
    const onChange = (e: MediaQueryListEvent) => setPrefersLight(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const theme = resolveTheme(settings.theme, prefersLight);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (toast?.kind !== "success") return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const openProcess = useCallback((pid: number) => {
    setView("processes");
    setQuery("");
    setSelectedId(processId(pid));
  }, []);

  // ---- Process actions ----

  async function execute(row: ProcessRow, action: ProcessAction, confirmed: boolean) {
    const outcome = await runProcessAction(
      { pid: row.pid, startTime: row.startTime, action },
      confirmed,
    );
    refreshNow();
    let text = successText(row, action, platform, outcome.affected);
    if (outcome.failures.length > 0) {
      text += ` ${outcome.failures.length} could not be ended: ${outcome.failures.join("; ")}`;
    }
    return text;
  }

  function requestAction(row: ProcessRow, action: ProcessAction) {
    if (!isAllowed(row, action.type)) {
      setToast({
        kind: "error",
        text: `${row.name} is protected — ending or suspending it would crash the system or MoonTask itself.`,
      });
      return;
    }
    if (needsConfirmation(row, action.type, settings.confirmOwn)) {
      const children =
        action.type === "killTree" ? countDescendants(snapshot?.processes ?? [], row.pid) : 0;
      setConfirmError(null);
      setPending({
        title: `${ACTION_LABELS[action.type]}?`,
        consequence: consequenceOf(row, action, children),
        summary: processSummary(row),
        confirmLabel: ACTION_LABELS[action.type],
        run: () => execute(row, action, true),
      });
      return;
    }
    execute(row, action, false).then(
      (text) => setToast({ kind: "success", text }),
      (e: unknown) =>
        setToast({ kind: "error", text: `${ACTION_LABELS[action.type]} failed: ${String(e)}` }),
    );
  }

  function requestEndGroup(name: string, members: ProcessRow[]) {
    const endable = members.filter((m) => !m.protected);
    if (endable.length === 0) return;
    setConfirmError(null);
    setPending({
      title: `End all ${endable.length} ${name} processes?`,
      consequence:
        "Every process of this program is asked to quit. Unsaved work in them may be lost.",
      summary: endable
        .map((m) => `${m.pid.toString().padStart(7)}  ${m.command || m.name}`)
        .join("\n"),
      confirmLabel: `End ${endable.length} processes`,
      run: async () => {
        const failures: string[] = [];
        for (const m of endable) {
          try {
            await runProcessAction(
              { pid: m.pid, startTime: m.startTime, action: { type: "terminate" } },
              true,
            );
          } catch (e) {
            failures.push(`${m.pid}: ${String(e)}`);
          }
        }
        refreshNow();
        const ended = endable.length - failures.length;
        return failures.length === 0
          ? `Ended ${ended} ${name} processes.`
          : `Ended ${ended} of ${endable.length}; ${failures.join("; ")}`;
      },
    });
  }

  function requestServiceAction(service: Service, action: ServiceAction) {
    const verb = action === "start" ? "Start" : action === "stop" ? "Stop" : "Restart";
    setConfirmError(null);
    setPending({
      title: `${verb} ${service.displayName}?`,
      consequence:
        action === "start"
          ? "The service starts running in the background."
          : "Programs that depend on this service may stop working until it runs again.",
      summary: [
        `Service: ${service.name}`,
        `State:   ${service.rawState}`,
        service.description ? `About:   ${service.description}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      confirmLabel: verb,
      run: async () => {
        await runServiceAction(service.name, action);
        setServiceReload((n) => n + 1);
        return `${verb === "Stop" ? "Stopped" : verb === "Start" ? "Started" : "Restarted"} ${service.displayName}.`;
      },
    });
  }

  async function confirmPending() {
    if (!pending) return;
    setBusy(true);
    setConfirmError(null);
    try {
      const text = await pending.run();
      setPending(null);
      setToast({ kind: "success", text });
    } catch (e) {
      setConfirmError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function reveal(row: ProcessRow) {
    revealProcess(row.pid).catch((e: unknown) =>
      setToast({ kind: "error", text: `Could not open the file location: ${String(e)}` }),
    );
  }

  // ---- Keyboard shortcuts ----

  const latest = useRef({ query, selectedId, pending });
  useEffect(() => {
    latest.current = { query, selectedId, pending };
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (latest.current.pending) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        setView(VIEWS[Number(e.key) - 1].id);
        return;
      }
      if ((mod && e.key.toLowerCase() === "f") || (e.key === "/" && !isTyping(e.target))) {
        e.preventDefault();
        setView("processes");
        requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        refreshNow();
        return;
      }
      if (e.key === " " && !isTyping(e.target)) {
        e.preventDefault();
        setPaused((p) => !p);
        return;
      }
      if (e.key === "Escape") {
        if (latest.current.query) setQuery("");
        else if (latest.current.selectedId) setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshNow]);

  const current = VIEWS.find((v) => v.id === view)!;
  const mem = snapshot?.memory;
  const memFraction = mem && mem.total > 0 ? mem.used / mem.total : 0;
  const gpu = snapshot ? primaryGpu(snapshot) : null;

  const content = view;

  return (
    <div className="relative h-full">
      <Sky />
      <div className="relative z-10 grid h-full grid-cols-[14.5rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-6 border-r border-(--mt-border) bg-(--mt-glass-bottom) px-3 py-5 backdrop-blur-md">
          <div className="flex items-center gap-3 px-2">
            <img
              src="/moontask-logo.svg"
              alt=""
              className="size-10 drop-shadow-[0_0_14px_rgb(185_174_251/0.45)]"
            />
            <div>
              <h1 className="mt-title text-xl leading-tight font-semibold tracking-tight">
                MoonTask
              </h1>
              <p className="text-[0.6875rem] text-(--mt-text-muted)">calmly under the moon</p>
            </div>
          </div>

          <nav aria-label="Sections" className="flex flex-col gap-0.5">
            {VIEWS.map((v, i) => {
              const selected = v.id === view;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => setView(v.id)}
                  className={`group flex h-9 items-center gap-3 rounded-[0.7rem] px-3 text-sm font-medium transition-colors duration-150 ${
                    selected
                      ? "bg-(--mt-selected) text-(--mt-accent) shadow-[inset_0_0_0_1px_rgb(185_174_251/0.3)]"
                      : "text-(--mt-text-muted) hover:bg-(--mt-hover) hover:text-(--mt-text)"
                  }`}
                >
                  {v.icon}
                  <span className="flex-1 text-left">{v.label}</span>
                  <span className="text-[0.625rem] text-(--mt-text-faint) opacity-0 transition-opacity group-hover:opacity-100">
                    Ctrl {i + 1}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-auto flex flex-col gap-2">
            <SideGauge
              label="CPU"
              value={snapshot ? formatPercent(snapshot.cpu.total, 0) : "–"}
              fraction={(snapshot?.cpu.total ?? 0) / 100}
            />
            <SideGauge
              label="Memory"
              value={mem ? `${formatBytes(mem.used)} / ${formatBytes(mem.total, 0)}` : "–"}
              fraction={memFraction}
            />
            {gpu && gpu.card.utilization !== null && (
              <SideGauge
                label="GPU"
                value={formatPercent(gpu.card.utilization, 0)}
                fraction={gpu.card.utilization / 100}
              />
            )}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col">
          <header className="flex items-center justify-between gap-4 px-6 pt-5 pb-4">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight">{current.label}</h2>
              <p className="text-sm text-(--mt-text-muted)">{current.subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              {paused && <span className="mt-chip mt-chip-warning">Paused</span>}
              <button
                type="button"
                className="mt-btn mt-btn-ghost"
                aria-pressed={paused}
                onClick={() => setPaused((p) => !p)}
                title="Pause or resume live updates (Space)"
              >
                {paused ? <PlayIcon /> : <PauseIcon />}
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                className="mt-btn mt-btn-ghost mt-btn-icon"
                onClick={refreshNow}
                title="Refresh now (F5)"
                aria-label="Refresh now"
              >
                <RefreshIcon />
              </button>
            </div>
          </header>

          <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-6 pb-4">
            {(monitor.error || infoError) && (
              <Banner tone="error" icon={<AlertIcon />}>
                MoonTask can't read the system right now: {monitor.error ?? infoError}
              </Banner>
            )}
            <div className="min-h-0 flex-1">
              {content === "overview" && (
                <OverviewView
                  snapshot={snapshot}
                  history={monitor.history}
                  activity={monitor.activity}
                  info={info}
                  onOpenProcess={openProcess}
                />
              )}
              {content === "processes" && (
                <ProcessesView
                  snapshot={snapshot}
                  history={monitor.history}
                  fresh={monitor.fresh}
                  platform={platform}
                  mode={settings.viewMode}
                  onModeChange={(viewMode: ViewMode) => updateSettings({ viewMode })}
                  sort={settings.sort}
                  onSortChange={(sort: SortState) => updateSettings({ sort })}
                  showKernel={settings.showKernel}
                  query={query}
                  onQueryChange={setQuery}
                  searchRef={searchRef}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onAction={requestAction}
                  onEndGroup={requestEndGroup}
                  onReveal={reveal}
                />
              )}
              {content === "performance" && (
                <PerformanceView snapshot={snapshot} history={monitor.history} info={info} />
              )}
              {content === "network" && (
                <NetworkView snapshot={snapshot} onOpenProcess={openProcess} />
              )}
              {content === "services" && (
                <ServicesView
                  platform={platform}
                  reloadKey={serviceReload}
                  onAction={requestServiceAction}
                  onOpenProcess={openProcess}
                />
              )}
              {content === "settings" && (
                <SettingsView settings={settings} onChange={updateSettings} info={info} />
              )}
            </div>
          </main>

          <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-(--mt-border) bg-(--mt-glass-bottom) px-6 py-2 text-xs text-(--mt-text-muted) tabular-nums backdrop-blur-md">
            {snapshot ? (
              <>
                <span>{snapshot.processCount} processes</span>
                <span>{snapshot.threadCount.toLocaleString("en-US")} threads</span>
                <span>CPU {formatPercent(snapshot.cpu.total)}</span>
                <span>
                  Memory {formatBytes(snapshot.memory.used)} of {formatBytes(snapshot.memory.total)}
                </span>
                <span>Up {formatDuration(snapshot.uptime)}</span>
              </>
            ) : (
              <span>Reading the system …</span>
            )}
            <span className="ml-auto">
              {paused
                ? "Updates paused"
                : `Updating every ${settings.refreshMs < 1000 ? `${settings.refreshMs} ms` : `${settings.refreshMs / 1000} s`}`}
              {info && ` · v${info.appVersion}`}
            </span>
          </footer>
        </div>
      </div>

      {toast && (
        <div className="fixed right-6 bottom-12 z-20 w-[min(30rem,calc(100vw-3rem))] shadow-[0_18px_50px_-12px_rgb(0_0_0/0.6)]">
          <Banner
            tone={toast.kind}
            icon={toast.kind === "success" ? <CheckIcon /> : <AlertIcon />}
            onClose={() => setToast(null)}
          >
            {toast.text}
          </Banner>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ""}
        consequence={pending?.consequence ?? ""}
        targetSummary={pending?.summary ?? ""}
        confirmLabel={pending?.confirmLabel}
        busy={busy}
        error={confirmError}
        onCancel={() => {
          setPending(null);
          setConfirmError(null);
        }}
        onConfirm={() => void confirmPending()}
      />
    </div>
  );
}

function SideGauge({ label, value, fraction }: { label: string; value: string; fraction: number }) {
  return (
    <div className="mt-inset flex items-center gap-3 px-3 py-2">
      <MoonPhase fraction={fraction} size={30} />
      <div className="min-w-0">
        <div className="mt-eyebrow">{label}</div>
        <div className="truncate text-sm font-medium tabular-nums">{value}</div>
      </div>
    </div>
  );
}
