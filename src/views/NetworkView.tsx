import { useMemo, useState } from "react";
import { listConnections } from "@/lib/ipc";
import { usePolling } from "@/hooks/usePolling";
import { filterConnections, isLocal, type ConnectionKind as Kind } from "@/lib/connections";
import type { Snapshot } from "@/types/models";
import { ConnectionTable } from "@/components/ConnectionTable";
import { RefreshIcon } from "@/components/icons";
import { Card, EmptyState, SearchField, Segmented } from "@/components/ui";
import { Banner } from "@/components/Banner";
import { InterfaceTable } from "@/views/PerformanceView";

export function NetworkView({
  snapshot,
  onOpenProcess,
}: {
  snapshot: Snapshot | null;
  onOpenProcess: (pid: number) => void;
}) {
  const connections = usePolling(listConnections, 3000);
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const names = useMemo(
    () => new Map((snapshot?.processes ?? []).map((p) => [p.pid, p.name])),
    [snapshot],
  );

  const shown = useMemo(() => {
    const list = filterConnections(connections.data ?? [], kind, query, names);
    return list.sort(
      (a, b) =>
        Number(isLocal(a.remoteAddress)) - Number(isLocal(b.remoteAddress)) ||
        (names.get(a.pids[0]) ?? "~").localeCompare(names.get(b.pids[0]) ?? "~") ||
        a.localPort - b.localPort,
    );
  }, [connections.data, kind, query, names]);

  const counts = useMemo(() => {
    const all = connections.data ?? [];
    return {
      established: all.filter((c) => c.state === "established").length,
      listening: all.filter((c) => c.state === "listen").length,
    };
  }, [connections.data]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {snapshot && (
        <Card title="Interfaces" bodyClassName="p-0 max-h-48 overflow-auto">
          <InterfaceTable snapshot={snapshot} />
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-64 flex-1">
          <SearchField
            value={query}
            onChange={setQuery}
            label="Search connections"
            placeholder="Search address, port or process"
          />
        </div>
        <Segmented
          label="Connection kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All" },
            { value: "established", label: `Established ${counts.established}` },
            { value: "listening", label: `Listening ${counts.listening}` },
            { value: "tcp", label: "TCP" },
            { value: "udp", label: "UDP" },
          ]}
        />
        <button
          type="button"
          className="mt-btn mt-btn-ghost"
          onClick={connections.reload}
          aria-label="Refresh connections"
          title="Refreshes every 3 seconds on its own"
        >
          <RefreshIcon />
        </button>
      </div>
      {connections.error && (
        <Banner tone="error">Could not list connections: {connections.error}</Banner>
      )}
      <Card
        className="min-h-0 flex-1"
        bodyClassName="min-h-0 h-full overflow-auto p-0"
        title={`${shown.length} connections`}
      >
        {!connections.data ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="mt-skeleton h-6 rounded" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState title="No matching connections" />
        ) : (
          <ConnectionTable connections={shown} names={names} onSelectPid={onOpenProcess} />
        )}
      </Card>
    </div>
  );
}
