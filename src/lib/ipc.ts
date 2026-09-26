/**
 * Typed wrappers around every Tauri command MoonTask uses. This is the
 * *only* file that talks to `@tauri-apps/api`: no direct network access
 * and no business logic in the frontend. Components import from here,
 * never from `@tauri-apps/api` directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ActionOutcome,
  ActionRequest,
  Connection,
  ProcessDetails,
  Service,
  ServiceAction,
  Snapshot,
  SystemInfo,
} from "@/types/models";

export function getSystemInfo(): Promise<SystemInfo> {
  return invoke("system_info");
}

export function getSnapshot(): Promise<Snapshot> {
  return invoke("snapshot");
}

export function getProcessDetails(pid: number): Promise<ProcessDetails> {
  return invoke("process_details", { pid });
}

/** `confirmed` must be true for high-risk actions (see lib/risk.ts); the
 * backend re-checks and refuses otherwise. */
export function runProcessAction(
  request: ActionRequest,
  confirmed: boolean,
): Promise<ActionOutcome> {
  return invoke("process_action", { request, confirmed });
}

/** Shows the process' executable in the system file manager. */
export function revealProcess(pid: number): Promise<void> {
  return invoke("process_reveal", { pid });
}

export function listConnections(): Promise<Connection[]> {
  return invoke("connections_list");
}

export function listServices(): Promise<Service[]> {
  return invoke("services_list");
}

/** Always needs the user's confirmation first. */
export function runServiceAction(name: string, action: ServiceAction): Promise<void> {
  return invoke("service_action", { name, action, confirmed: true });
}
