/**
 * Hand-written mirror of the Rust models in src-tauri/src/models/. Field
 * names are the camelCase JSON the backend sends. Byte counts are plain
 * numbers: they stay exact up to 8 PiB.
 */

export type Platform = "windows" | "linux" | "macos";

export type Owner = "current" | "other" | "system" | "kernel";

export type ProcessState =
  "running" | "sleeping" | "idle" | "waiting" | "stopped" | "zombie" | "dead" | "unknown";

export type Priority = "idle" | "belowNormal" | "normal" | "aboveNormal" | "high" | "realtime";

export interface SystemInfo {
  appVersion: string;
  platform: Platform;
  hostName: string | null;
  osName: string | null;
  osVersion: string | null;
  kernelVersion: string | null;
  arch: string;
  cpuBrand: string;
  physicalCores: number | null;
  logicalCores: number;
  totalMemory: number;
  bootTime: number;
  selfPid: number;
}

export interface ProcessRow {
  pid: number;
  parentPid: number | null;
  name: string;
  exe: string | null;
  command: string;
  user: string | null;
  owner: Owner;
  status: ProcessState;
  /** Share of the whole machine, 0–100. */
  cpu: number;
  memory: number;
  virtualMemory: number;
  threads: number | null;
  /** Bytes per second. */
  diskRead: number;
  diskWrite: number;
  /** Unix seconds. */
  startTime: number;
  protected: boolean;
}

export interface CoreStats {
  usage: number;
  frequency: number;
}

export interface Snapshot {
  timestamp: number;
  intervalMs: number;
  uptime: number;
  cpu: { total: number; cores: CoreStats[] };
  memory: {
    total: number;
    used: number;
    available: number;
    swapTotal: number;
    swapUsed: number;
  };
  load: { one: number; five: number; fifteen: number } | null;
  network: {
    rxRate: number;
    txRate: number;
    interfaces: NetworkInterface[];
  };
  disk: { readRate: number; writeRate: number; volumes: Volume[] };
  sensors: Sensor[];
  processes: ProcessRow[];
  processCount: number;
  threadCount: number;
}

export interface NetworkInterface {
  name: string;
  rxRate: number;
  txRate: number;
  totalRx: number;
  totalTx: number;
  loopback: boolean;
}

export interface Volume {
  name: string;
  mountPoint: string;
  fileSystem: string;
  total: number;
  available: number;
  removable: boolean;
  kind: "ssd" | "hdd" | "unknown";
}

export interface Sensor {
  label: string;
  temperature: number;
  critical: number | null;
}

export interface ThreadRow {
  tid: number;
  name: string | null;
  state: string | null;
  cpuTime: number | null;
  priority: number | null;
}

export interface ModuleRow {
  name: string;
  path: string;
  base: string | null;
  size: number | null;
}

export type HandleKind = "file" | "directory" | "device" | "socket" | "pipe" | "other";

export interface HandleRow {
  fd: number;
  kind: HandleKind;
  target: string;
}

export interface ProcessDetails {
  pid: number;
  name: string;
  exe: string | null;
  command: string[];
  cwd: string | null;
  environment: { key: string; value: string }[];
  parent: { pid: number; name: string } | null;
  user: string | null;
  owner: Owner;
  status: ProcessState;
  startTime: number;
  runTime: number;
  cpuTime: number;
  memory: number;
  virtualMemory: number;
  priority: Priority | null;
  nice: number | null;
  openFiles: number | null;
  totalDiskRead: number;
  totalDiskWritten: number;
  threads: ThreadRow[] | null;
  modules: ModuleRow[] | null;
  handles: HandleRow[] | null;
  protected: boolean;
}

export type ProcessAction =
  | { type: "terminate" }
  | { type: "kill" }
  | { type: "killTree" }
  | { type: "suspend" }
  | { type: "resume" }
  | { type: "setPriority"; priority: Priority };

export interface ActionRequest {
  pid: number;
  startTime: number;
  action: ProcessAction;
}

export interface ActionOutcome {
  affected: number;
  failures: string[];
}

export type Protocol = "tcp" | "tcp6" | "udp" | "udp6";

export interface Connection {
  protocol: Protocol;
  localAddress: string;
  localPort: number;
  remoteAddress: string | null;
  remotePort: number | null;
  state: string | null;
  pids: number[];
}

export type ServiceState = "running" | "stopped" | "starting" | "stopping" | "failed" | "other";

export interface Service {
  name: string;
  displayName: string;
  description: string | null;
  state: ServiceState;
  rawState: string;
  startup: string | null;
  pid: number | null;
}

export type ServiceAction = "start" | "stop" | "restart";
