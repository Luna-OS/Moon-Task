import type { Connection } from "@/types/models";
import { CONNECTION_STATE_LABELS, connectionKey } from "@/lib/connections";

const PROTOCOL_LABELS: Record<Connection["protocol"], string> = {
  tcp: "TCP",
  tcp6: "TCP6",
  udp: "UDP",
  udp6: "UDP6",
};

function endpoint(address: string, port: number): string {
  return address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;
}

/** Sockets as a table; `compact` drops the process column (detail panel). */
export function ConnectionTable({
  connections,
  names,
  compact = false,
  onSelectPid,
}: {
  connections: Connection[];
  names: ReadonlyMap<number, string>;
  compact?: boolean;
  onSelectPid?: (pid: number) => void;
}) {
  return (
    <table className="mt-table table-fixed">
      <colgroup>
        <col style={{ width: "4.5rem" }} />
        <col />
        <col />
        <col style={{ width: "7.5rem" }} />
        {!compact && <col style={{ width: "14rem" }} />}
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Proto</th>
          <th scope="col">Local</th>
          <th scope="col">Remote</th>
          <th scope="col">State</th>
          {!compact && <th scope="col">Process</th>}
        </tr>
      </thead>
      <tbody>
        {connections.map((c) => (
          <tr key={connectionKey(c)}>
            <td className="text-(--mt-text-muted)">{PROTOCOL_LABELS[c.protocol]}</td>
            <td className="font-mono text-xs" title={endpoint(c.localAddress, c.localPort)}>
              {endpoint(c.localAddress, c.localPort)}
            </td>
            <td className="font-mono text-xs">
              {c.remoteAddress !== null && c.remotePort !== null ? (
                endpoint(c.remoteAddress, c.remotePort)
              ) : (
                <span className="text-(--mt-text-faint)">–</span>
              )}
            </td>
            <td>
              {c.state ? (
                <span
                  className={
                    c.state === "established"
                      ? "text-(--mt-success)"
                      : c.state === "listen"
                        ? "text-(--mt-accent)"
                        : "text-(--mt-text-muted)"
                  }
                >
                  {CONNECTION_STATE_LABELS[c.state] ?? c.state}
                </span>
              ) : (
                <span className="text-(--mt-text-faint)">–</span>
              )}
            </td>
            {!compact && (
              <td>
                {c.pids.length === 0 ? (
                  <span className="text-(--mt-text-faint)">–</span>
                ) : (
                  c.pids.map((pid, i) => (
                    <span key={pid}>
                      {i > 0 && ", "}
                      <button
                        type="button"
                        className="hover:text-(--mt-accent) hover:underline"
                        onClick={() => onSelectPid?.(pid)}
                      >
                        {names.get(pid) ?? "?"}{" "}
                        <span className="text-(--mt-text-faint)">{pid}</span>
                      </button>
                    </span>
                  ))
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
