import type { ProcessRow, Snapshot, SystemInfo } from "@/types/models";

const GIB = 1024 ** 3;

export function proc(overrides: Partial<ProcessRow> & { pid: number }): ProcessRow {
  return {
    parentPid: null,
    name: `proc-${overrides.pid}`,
    exe: null,
    command: "",
    user: "luna",
    owner: "current",
    status: "sleeping",
    cpu: 0,
    gpu: 0,
    memory: 1024 * 1024,
    virtualMemory: 4 * 1024 * 1024,
    threads: 1,
    diskRead: 0,
    diskWrite: 0,
    startTime: 1_700_000_000 + overrides.pid,
    protected: false,
    ...overrides,
  };
}

/**
 *   1 systemd (system)
 *   ├─ 100 sshd (system)
 *   │   └─ 200 bash
 *   │       └─ 300 vim
 *   └─ 400 firefox
 *       ├─ 401 firefox (content)
 *       └─ 402 firefox (content)
 *   2 kthreadd (kernel)
 *   └─ 3 kworker/0:1 (kernel)
 */
export const PROCESSES: ProcessRow[] = [
  proc({ pid: 1, name: "systemd", owner: "system", user: "root", protected: true, cpu: 0.1 }),
  proc({ pid: 100, parentPid: 1, name: "sshd", owner: "system", user: "root", cpu: 0.2 }),
  proc({ pid: 200, parentPid: 100, name: "bash", command: "-bash", cpu: 0.3 }),
  proc({ pid: 300, parentPid: 200, name: "vim", command: "vim notes.md", cpu: 1.5 }),
  proc({
    pid: 400,
    parentPid: 1,
    name: "firefox",
    command: "/usr/lib/firefox/firefox",
    cpu: 12,
    memory: 2 * GIB,
    status: "running",
    threads: 80,
  }),
  proc({ pid: 401, parentPid: 400, name: "firefox", cpu: 4, memory: GIB, threads: 20 }),
  proc({ pid: 402, parentPid: 400, name: "firefox", cpu: 2, memory: GIB / 2, threads: 20 }),
  proc({ pid: 2, name: "kthreadd", owner: "kernel", user: "root", protected: true }),
  proc({
    pid: 3,
    parentPid: 2,
    name: "kworker/0:1",
    owner: "kernel",
    user: "root",
    protected: true,
  }),
];

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    timestamp: 1_700_000_100_000,
    intervalMs: 1000,
    uptime: 3 * 86400 + 4 * 3600,
    cpu: {
      total: 23.5,
      cores: [
        { usage: 30, frequency: 3400 },
        { usage: 17, frequency: 3200 },
      ],
    },
    memory: {
      total: 16 * GIB,
      used: 6 * GIB,
      available: 10 * GIB,
      swapTotal: 2 * GIB,
      swapUsed: 0,
    },
    load: { one: 0.5, five: 0.4, fifteen: 0.3 },
    network: {
      rxRate: 125_000,
      txRate: 12_000,
      interfaces: [
        {
          name: "eth0",
          rxRate: 125_000,
          txRate: 12_000,
          totalRx: GIB,
          totalTx: GIB / 4,
          loopback: false,
        },
        { name: "lo", rxRate: 0, txRate: 0, totalRx: 1000, totalTx: 1000, loopback: true },
      ],
    },
    disk: {
      readRate: 2_000_000,
      writeRate: 500_000,
      volumes: [
        {
          name: "/dev/nvme0n1p2",
          mountPoint: "/",
          fileSystem: "ext4",
          total: 500 * GIB,
          available: 200 * GIB,
          removable: false,
          kind: "ssd",
        },
      ],
    },
    sensors: [{ label: "Package id 0", temperature: 48, critical: 100 }],
    gpus: [
      {
        name: "NVIDIA GeForce RTX 4070",
        vendor: "NVIDIA",
        utilization: 37,
        engines: [
          { name: "3D", utilization: 37 },
          { name: "Video Decode", utilization: 12 },
        ],
        memoryUsed: 3 * GIB,
        memoryTotal: 12 * GIB,
        sharedUsed: GIB / 4,
        sharedTotal: 8 * GIB,
        temperature: null,
      },
    ],
    processes: PROCESSES,
    processCount: PROCESSES.length,
    threadCount: 150,
    ...overrides,
  };
}

export const SYSTEM_INFO: SystemInfo = {
  appVersion: "0.1.0",
  platform: "linux",
  hostName: "moonbase",
  osName: "Linux",
  osVersion: "Linux 24.04 Ubuntu",
  kernelVersion: "6.8.0",
  arch: "x86_64",
  cpuBrand: "Lunaris L7 @ 3.4 GHz",
  physicalCores: 1,
  logicalCores: 2,
  totalMemory: 16 * GIB,
  bootTime: 1_699_000_000,
  selfPid: 999,
};
