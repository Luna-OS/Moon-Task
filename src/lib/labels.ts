/** Display names for backend enums, shared by several views. */
import type { Owner, Priority, ProcessState } from "@/types/models";

export const OWNER_LABELS: Record<Owner, string> = {
  current: "You",
  other: "Other user",
  system: "System",
  kernel: "Kernel",
};

export const PROCESS_STATE_LABELS: Record<ProcessState, string> = {
  running: "Running",
  sleeping: "Sleeping",
  idle: "Idle",
  waiting: "Waiting",
  stopped: "Suspended",
  zombie: "Zombie",
  dead: "Dead",
  unknown: "–",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  idle: "Idle",
  belowNormal: "Below normal",
  normal: "Normal",
  aboveNormal: "Above normal",
  high: "High",
  realtime: "Realtime",
};
