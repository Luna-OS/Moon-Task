import { useCallback, useEffect, useRef, useState } from "react";
import { getSnapshot } from "@/lib/ipc";
import {
  appendActivity,
  appendSnapshot,
  diffProcesses,
  emptyHistory,
  processKey,
  type ActivityEvent,
  type History,
} from "@/lib/history";
import type { Snapshot } from "@/types/models";

/** How long a newly started process stays highlighted, in ms. */
const NEW_HIGHLIGHT_MS = 3000;

export interface MonitorState {
  snapshot: Snapshot | null;
  history: History;
  activity: ActivityEvent[];
  /** Process keys that appeared within the last few seconds. */
  fresh: ReadonlySet<string>;
  error: string | null;
  /** Fetch a snapshot right now (F5), independent of the timer. */
  refreshNow: () => void;
}

/**
 * Polls the backend for snapshots every `intervalMs` while not paused.
 * Uses a timeout chain instead of setInterval, so a slow refresh never
 * piles up overlapping requests.
 */
export function useMonitor(intervalMs: number, paused: boolean): MonitorState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<History>(emptyHistory);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const previous = useRef<Snapshot | null>(null);
  const firstSeen = useRef(new Map<string, number>());
  const inFlight = useRef(false);

  const tick = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await getSnapshot();
      const prev = previous.current;
      // The backend repeats a snapshot when asked too early; nothing new.
      if (prev && prev.timestamp === next.timestamp) return;
      previous.current = next;

      const now = next.timestamp;
      const seen = firstSeen.current;
      const alive = new Set<string>();
      for (const p of next.processes) {
        const key = processKey(p);
        alive.add(key);
        // Everything in the very first snapshot is old news.
        if (!seen.has(key)) seen.set(key, prev ? now : 0);
      }
      const recent = new Set<string>();
      for (const [key, at] of seen) {
        if (!alive.has(key)) seen.delete(key);
        else if (now - at < NEW_HIGHLIGHT_MS) recent.add(key);
      }

      setSnapshot(next);
      setHistory((h) => appendSnapshot(h, next));
      setActivity((feed) =>
        appendActivity(feed, diffProcesses(prev?.processes ?? null, next.processes, now)),
      );
      setFresh(recent);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await tick();
      if (!cancelled) timer = setTimeout(() => void loop(), intervalMs);
    };
    void loop();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [intervalMs, paused, tick]);

  const refreshNow = useCallback(() => void tick(), [tick]);

  return { snapshot, history, activity, fresh, error, refreshNow };
}
