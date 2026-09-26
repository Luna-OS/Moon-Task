/**
 * Rolling history for the charts, plus the "what started / what ended"
 * activity feed. The backend only ever sends the present; the past lives
 * here. Pure functions over plain data, so they are easy to test.
 */
import type { ProcessRow, Snapshot } from "@/types/models";

/** Points kept per series: two minutes at the default 1 s refresh. */
export const HISTORY_LENGTH = 120;
/** Points kept per process, for the detail panel's sparklines. */
export const PROCESS_HISTORY_LENGTH = 60;

export interface ProcessHistory {
  cpu: number[];
  memory: number[];
}

export interface History {
  timestamps: number[];
  cpu: number[];
  cores: number[][];
  memory: number[];
  swap: number[];
  netRx: number[];
  netTx: number[];
  diskRead: number[];
  diskWrite: number[];
  /** Keyed by `processKey`, pruned when a process exits. */
  processes: Map<string, ProcessHistory>;
}

export function emptyHistory(): History {
  return {
    timestamps: [],
    cpu: [],
    cores: [],
    memory: [],
    swap: [],
    netRx: [],
    netTx: [],
    diskRead: [],
    diskWrite: [],
    processes: new Map(),
  };
}

/** PID plus start time: unique even when the OS reuses a PID. */
export function processKey(p: Pick<ProcessRow, "pid" | "startTime">): string {
  return `${p.pid}:${p.startTime}`;
}

function push(series: number[], value: number, max: number): number[] {
  const next = series.length >= max ? series.slice(series.length - max + 1) : series.slice();
  next.push(value);
  return next;
}

export function appendSnapshot(h: History, s: Snapshot, max = HISTORY_LENGTH): History {
  const processes = new Map<string, ProcessHistory>();
  for (const p of s.processes) {
    const key = processKey(p);
    const prev = h.processes.get(key);
    processes.set(key, {
      cpu: push(prev?.cpu ?? [], p.cpu, PROCESS_HISTORY_LENGTH),
      memory: push(prev?.memory ?? [], p.memory, PROCESS_HISTORY_LENGTH),
    });
  }
  return {
    timestamps: push(h.timestamps, s.timestamp, max),
    cpu: push(h.cpu, s.cpu.total, max),
    cores: s.cpu.cores.map((c, i) => push(h.cores[i] ?? [], c.usage, max)),
    memory: push(h.memory, s.memory.used, max),
    swap: push(h.swap, s.memory.swapUsed, max),
    netRx: push(h.netRx, s.network.rxRate, max),
    netTx: push(h.netTx, s.network.txRate, max),
    diskRead: push(h.diskRead, s.disk.readRate, max),
    diskWrite: push(h.diskWrite, s.disk.writeRate, max),
    processes,
  };
}

export interface ActivityEvent {
  kind: "started" | "ended";
  pid: number;
  name: string;
  /** Milliseconds since the epoch. */
  at: number;
}

export const ACTIVITY_LENGTH = 60;

/** Processes that appeared or disappeared between two snapshots. */
export function diffProcesses(
  prev: ProcessRow[] | null,
  next: ProcessRow[],
  at: number,
): ActivityEvent[] {
  if (prev === null) return [];
  const before = new Map(prev.map((p) => [processKey(p), p]));
  const after = new Map(next.map((p) => [processKey(p), p]));
  const events: ActivityEvent[] = [];
  for (const [key, p] of after) {
    if (!before.has(key)) events.push({ kind: "started", pid: p.pid, name: p.name, at });
  }
  for (const [key, p] of before) {
    if (!after.has(key)) events.push({ kind: "ended", pid: p.pid, name: p.name, at });
  }
  return events;
}

/** Newest first, capped. */
export function appendActivity(
  feed: ActivityEvent[],
  events: ActivityEvent[],
  max = ACTIVITY_LENGTH,
): ActivityEvent[] {
  if (events.length === 0) return feed;
  return [...events, ...feed].slice(0, max);
}
