import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCpuTime,
  formatDuration,
  formatFrequency,
  formatRate,
} from "@/lib/format";
import { isAllowed, isHighRisk, needsConfirmation } from "@/lib/risk";
import { DEFAULT_SETTINGS, resolveTheme, sanitize } from "@/lib/settings";
import {
  appendActivity,
  appendSnapshot,
  diffProcesses,
  emptyHistory,
  processKey,
} from "@/lib/history";
import { niceMax } from "@/lib/scale";
import { filterConnections, isLocal } from "@/lib/connections";
import { filterServices } from "@/lib/services";
import { PROCESSES, proc, snapshot } from "@/test/fixtures";
import type { Connection, Service } from "@/types/models";

describe("format", () => {
  it("formats bytes in IEC units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(1024 ** 3 * 16)).toBe("16.0 GiB");
    expect(formatBytes(1024 ** 3 * 500)).toBe("500 GiB");
  });

  it("formats rates and ignores sub-byte noise", () => {
    expect(formatRate(0.4)).toBe("0 B/s");
    expect(formatRate(2048)).toBe("2.0 KiB/s");
  });

  it("formats durations as the two largest units", () => {
    expect(formatDuration(5)).toBe("5s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3 * 86400 + 4 * 3600 + 59)).toBe("3d 4h");
  });

  it("formats CPU time like a classic task manager", () => {
    expect(formatCpuTime(3_723_450)).toBe("1:02:03.4");
  });

  it("formats frequencies", () => {
    expect(formatFrequency(3400)).toBe("3.40 GHz");
    expect(formatFrequency(800)).toBe("800 MHz");
    expect(formatFrequency(0)).toBe("–");
  });
});

describe("risk (mirrors control/guard.rs)", () => {
  const mine = proc({ pid: 5, owner: "current" });
  const system = proc({ pid: 6, owner: "system" });

  it("only lets protected processes be resumed", () => {
    const p = proc({ pid: 1, protected: true });
    expect(isAllowed(p, "terminate")).toBe(false);
    expect(isAllowed(p, "setPriority")).toBe(false);
    expect(isAllowed(p, "resume")).toBe(true);
  });

  it("rates foreign processes and trees as high risk", () => {
    expect(isHighRisk(mine, "terminate")).toBe(false);
    expect(isHighRisk(system, "terminate")).toBe(true);
    expect(isHighRisk(system, "suspend")).toBe(true);
    expect(isHighRisk(mine, "killTree")).toBe(true);
    expect(isHighRisk(system, "setPriority")).toBe(false);
  });

  it("asks before ending own processes only when the setting says so", () => {
    expect(needsConfirmation(mine, "terminate", true)).toBe(true);
    expect(needsConfirmation(mine, "terminate", false)).toBe(false);
    expect(needsConfirmation(mine, "suspend", true)).toBe(false);
    expect(needsConfirmation(system, "kill", false)).toBe(true);
  });
});

describe("settings", () => {
  it("falls back to defaults for unknown or broken values", () => {
    expect(sanitize({})).toEqual(DEFAULT_SETTINGS);
    const s = sanitize({
      refreshMs: 123,
      theme: "neon" as never,
      viewMode: "apps",
      sort: { key: "bogus" as never, dir: "asc" },
      confirmOwn: false,
    });
    expect(s.refreshMs).toBe(1000);
    expect(s.theme).toBe("dark");
    expect(s.viewMode).toBe("apps");
    expect(s.sort).toEqual(DEFAULT_SETTINGS.sort);
    expect(s.confirmOwn).toBe(false);
  });

  it("resolves the system theme", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
  });
});

describe("history", () => {
  it("appends and caps every series", () => {
    let h = emptyHistory();
    for (let i = 0; i < 5; i++) {
      h = appendSnapshot(h, snapshot({ timestamp: i }), 3);
    }
    expect(h.timestamps).toEqual([2, 3, 4]);
    expect(h.cpu).toHaveLength(3);
    expect(h.cores).toHaveLength(2);
    expect(h.processes.get(processKey(PROCESSES[4]))?.cpu).toEqual([12, 12, 12, 12, 12]);
  });

  it("drops the history of exited processes", () => {
    let h = appendSnapshot(emptyHistory(), snapshot());
    h = appendSnapshot(h, snapshot({ processes: PROCESSES.slice(0, 2) }));
    expect(h.processes.size).toBe(2);
  });

  it("reports started and ended processes, but nothing for the first snapshot", () => {
    expect(diffProcesses(null, PROCESSES, 1)).toEqual([]);
    const next = [...PROCESSES.slice(1), proc({ pid: 777, name: "new" })];
    const events = diffProcesses(PROCESSES, next, 42);
    expect(events).toEqual([
      { kind: "started", pid: 777, name: "new", at: 42 },
      { kind: "ended", pid: 1, name: "systemd", at: 42 },
    ]);
  });

  it("treats a reused PID as a new process", () => {
    const old = proc({ pid: 50, startTime: 1 });
    const reused = proc({ pid: 50, startTime: 2 });
    expect(diffProcesses([old], [reused], 0).map((e) => e.kind)).toEqual(["started", "ended"]);
  });

  it("keeps the newest activity first and capped", () => {
    const a = { kind: "started" as const, pid: 1, name: "a", at: 1 };
    const b = { kind: "ended" as const, pid: 2, name: "b", at: 2 };
    expect(appendActivity([a], [b], 1)).toEqual([b]);
  });
});

describe("chart scale", () => {
  it("rounds up to 1-2-5 steps", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(130)).toBe(200);
    expect(niceMax(4100)).toBe(5000);
  });
});

describe("connections", () => {
  const conns: Connection[] = [
    {
      protocol: "tcp",
      localAddress: "0.0.0.0",
      localPort: 22,
      remoteAddress: null,
      remotePort: null,
      state: "listen",
      pids: [100],
    },
    {
      protocol: "tcp6",
      localAddress: "::1",
      localPort: 50000,
      remoteAddress: "2a00::1",
      remotePort: 443,
      state: "established",
      pids: [400],
    },
    {
      protocol: "udp",
      localAddress: "0.0.0.0",
      localPort: 5353,
      remoteAddress: null,
      remotePort: null,
      state: null,
      pids: [],
    },
  ];
  const names = new Map([
    [100, "sshd"],
    [400, "firefox"],
  ]);

  it("filters by kind", () => {
    expect(filterConnections(conns, "listening", "", names)).toHaveLength(1);
    expect(filterConnections(conns, "udp", "", names)).toHaveLength(1);
    expect(filterConnections(conns, "tcp", "", names)).toHaveLength(2);
  });

  it("searches ports, addresses and process names", () => {
    expect(filterConnections(conns, "all", "firefox", names)[0].remotePort).toBe(443);
    expect(filterConnections(conns, "all", "5353", names)).toHaveLength(1);
  });

  it("knows local addresses", () => {
    expect(isLocal("127.0.0.1")).toBe(true);
    expect(isLocal("::")).toBe(true);
    expect(isLocal("10.0.0.2")).toBe(false);
  });
});

describe("services", () => {
  const services: Service[] = [
    {
      name: "ssh.service",
      displayName: "ssh",
      description: "OpenBSD Secure Shell server",
      state: "running",
      rawState: "active (running)",
      startup: "enabled",
      pid: 100,
    },
    {
      name: "cups.service",
      displayName: "cups",
      description: "CUPS Scheduler",
      state: "failed",
      rawState: "failed (failed)",
      startup: "enabled",
      pid: null,
    },
  ];

  it("filters by state and text", () => {
    expect(filterServices(services, "failed", "")).toHaveLength(1);
    expect(filterServices(services, "all", "secure shell")[0].name).toBe("ssh.service");
    expect(filterServices(services, "all", "100")[0].name).toBe("ssh.service");
  });
});
