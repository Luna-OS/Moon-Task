/**
 * When to ask before acting on a process. Mirrors
 * src-tauri/src/control/guard.rs, which re-checks every request and is the
 * copy that counts — this one only decides when to show the dialog.
 */
import type { ProcessAction, ProcessRow } from "@/types/models";

export type ActionType = ProcessAction["type"];

/** Protected processes can only be resumed. */
export function isAllowed(row: Pick<ProcessRow, "protected">, action: ActionType): boolean {
  return !row.protected || action === "resume";
}

/** High risk: the backend refuses without `confirmed = true`. */
export function isHighRisk(row: Pick<ProcessRow, "owner">, action: ActionType): boolean {
  switch (action) {
    case "resume":
    case "setPriority":
      return false;
    case "killTree":
      return true;
    case "terminate":
    case "kill":
    case "suspend":
      return row.owner !== "current";
  }
}

/**
 * Whether to show the confirmation dialog. `confirmOwn` is the user's
 * setting "also ask before ending my own processes" (on by default).
 */
export function needsConfirmation(
  row: Pick<ProcessRow, "owner">,
  action: ActionType,
  confirmOwn: boolean,
): boolean {
  if (isHighRisk(row, action)) return true;
  return confirmOwn && (action === "terminate" || action === "kill");
}

export const ACTION_LABELS: Record<ActionType, string> = {
  terminate: "End process",
  kill: "Force kill",
  killTree: "End process tree",
  suspend: "Suspend",
  resume: "Resume",
  setPriority: "Change priority",
};
