/** Socket list helpers for the Network view and the detail panel. */
import type { Connection } from "@/types/models";

export type ConnectionKind = "all" | "tcp" | "udp" | "listening" | "established";

export const CONNECTION_STATE_LABELS: Record<string, string> = {
  listen: "Listening",
  established: "Established",
  synSent: "Connecting",
  synReceived: "Accepting",
  finWait: "Closing",
  closeWait: "Close wait",
  closing: "Closing",
  lastAck: "Closing",
  timeWait: "Time wait",
  closed: "Closed",
  unknown: "Unknown",
};

export function connectionKey(c: Connection): string {
  return `${c.protocol}|${c.localAddress}|${c.localPort}|${c.remoteAddress ?? ""}|${
    c.remotePort ?? ""
  }|${c.pids.join(",")}`;
}

/** Loopback and wildcard addresses sort after real peers. */
export function isLocal(address: string | null): boolean {
  return (
    address === null ||
    address === "0.0.0.0" ||
    address === "::" ||
    address.startsWith("127.") ||
    address === "::1"
  );
}

export function filterConnections(
  connections: Connection[],
  kind: ConnectionKind,
  query: string,
  names: ReadonlyMap<number, string>,
): Connection[] {
  const q = query.trim().toLowerCase();
  return connections.filter((c) => {
    if (kind === "tcp" && !c.protocol.startsWith("tcp")) return false;
    if (kind === "udp" && !c.protocol.startsWith("udp")) return false;
    if (kind === "listening" && c.state !== "listen") return false;
    if (kind === "established" && c.state !== "established") return false;
    if (q === "") return true;
    const haystack = [
      c.localAddress,
      String(c.localPort),
      c.remoteAddress ?? "",
      String(c.remotePort ?? ""),
      ...c.pids.map(String),
      ...c.pids.map((p) => names.get(p) ?? ""),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
