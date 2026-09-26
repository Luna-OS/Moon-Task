/** Service list helpers for the Services view. */
import type { Service, ServiceState } from "@/types/models";

export type StateFilter = "all" | "running" | "stopped" | "failed";

export const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  running: "Running",
  stopped: "Stopped",
  starting: "Starting",
  stopping: "Stopping",
  failed: "Failed",
  other: "Other",
};

export function filterServices(services: Service[], state: StateFilter, query: string): Service[] {
  const q = query.trim().toLowerCase();
  return services.filter((s) => {
    if (state === "running" && s.state !== "running") return false;
    if (state === "stopped" && s.state !== "stopped") return false;
    if (state === "failed" && s.state !== "failed") return false;
    if (q === "") return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.displayName.toLowerCase().includes(q) ||
      (s.description?.toLowerCase().includes(q) ?? false) ||
      String(s.pid ?? "") === q
    );
  });
}
