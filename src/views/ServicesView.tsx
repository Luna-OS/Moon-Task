import { useMemo, useState } from "react";
import { listServices } from "@/lib/ipc";
import { usePolling } from "@/hooks/usePolling";
import { filterServices, SERVICE_STATE_LABELS, type StateFilter } from "@/lib/services";
import type { Platform, Service, ServiceAction, ServiceState } from "@/types/models";
import { RefreshIcon } from "@/components/icons";
import { Card, EmptyState, SearchField, Segmented } from "@/components/ui";
import { Banner } from "@/components/Banner";

const STATE_TONE: Record<ServiceState, string> = {
  running: "mt-chip-mint",
  stopped: "mt-chip-muted",
  starting: "",
  stopping: "",
  failed: "mt-chip-danger",
  other: "mt-chip-muted",
};

export function ServicesView({
  platform,
  reloadKey,
  onAction,
  onOpenProcess,
}: {
  platform: Platform;
  /** Changes after a service action, to reload the list. */
  reloadKey: number;
  onAction: (service: Service, action: ServiceAction) => void;
  onOpenProcess: (pid: number) => void;
}) {
  const services = usePolling(listServices, 10000);
  const [state, setState] = useState<StateFilter>("all");
  const [query, setQuery] = useState("");
  const [seenKey, setSeenKey] = useState(reloadKey);
  if (seenKey !== reloadKey) {
    setSeenKey(reloadKey);
    services.reload();
  }

  const all = useMemo(() => services.data ?? [], [services.data]);
  const shown = useMemo(() => filterServices(all, state, query), [all, state, query]);
  const failed = all.filter((s) => s.state === "failed").length;
  const managerName =
    platform === "windows"
      ? "Windows services"
      : platform === "macos"
        ? "launchd jobs"
        : "systemd services";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-64 flex-1">
          <SearchField
            value={query}
            onChange={setQuery}
            label="Search services"
            placeholder="Search name or description"
          />
        </div>
        <Segmented
          label="Service state"
          value={state}
          onChange={setState}
          options={[
            { value: "all", label: "All" },
            { value: "running", label: "Running" },
            { value: "stopped", label: "Stopped" },
            { value: "failed", label: `Failed${failed > 0 ? ` ${failed}` : ""}` },
          ]}
        />
        <button
          type="button"
          className="mt-btn mt-btn-ghost"
          onClick={services.reload}
          aria-label="Refresh services"
        >
          <RefreshIcon />
        </button>
      </div>
      {services.error && <Banner tone="error">Could not list services: {services.error}</Banner>}
      <Card
        className="min-h-0 flex-1"
        bodyClassName="min-h-0 h-full overflow-auto p-0"
        title={`${shown.length} ${managerName}`}
      >
        {!services.data && !services.error ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="mt-skeleton h-6 rounded" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState title="No matching services" />
        ) : (
          <table className="mt-table table-fixed">
            <colgroup>
              <col style={{ width: "30%" }} />
              <col />
              <col style={{ width: "7.5rem" }} />
              <col style={{ width: "6.5rem" }} />
              <col style={{ width: "5.5rem" }} />
              <col style={{ width: "13.5rem" }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Description</th>
                <th scope="col">State</th>
                <th scope="col">Startup</th>
                <th scope="col" className="text-right">
                  PID
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.name}>
                  <td title={s.name}>
                    <span className="font-medium">{s.displayName}</span>
                    {s.displayName !== s.name && (
                      <span className="ml-2 text-xs text-(--mt-text-faint)">{s.name}</span>
                    )}
                  </td>
                  <td className="text-(--mt-text-muted)" title={s.description ?? undefined}>
                    {s.description ?? "–"}
                  </td>
                  <td title={s.rawState}>
                    <span className={`mt-chip ${STATE_TONE[s.state]}`}>
                      {SERVICE_STATE_LABELS[s.state]}
                    </span>
                  </td>
                  <td className="text-(--mt-text-muted)">{s.startup ?? "–"}</td>
                  <td className="text-right">
                    {s.pid !== null ? (
                      <button
                        type="button"
                        className="text-(--mt-accent) hover:underline"
                        onClick={() => onOpenProcess(s.pid!)}
                      >
                        {s.pid}
                      </button>
                    ) : (
                      <span className="text-(--mt-text-faint)">–</span>
                    )}
                  </td>
                  <td>
                    <span className="flex justify-end gap-1">
                      {s.state !== "running" && (
                        <button
                          type="button"
                          className="mt-btn mt-btn-ghost mt-btn-sm"
                          onClick={() => onAction(s, "start")}
                        >
                          Start
                        </button>
                      )}
                      {s.state === "running" && (
                        <>
                          <button
                            type="button"
                            className="mt-btn mt-btn-ghost mt-btn-sm"
                            onClick={() => onAction(s, "restart")}
                          >
                            Restart
                          </button>
                          <button
                            type="button"
                            className="mt-btn mt-btn-danger mt-btn-sm"
                            onClick={() => onAction(s, "stop")}
                          >
                            Stop
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
