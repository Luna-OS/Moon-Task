import { describe, expect, it } from "vitest";
import {
  aggregate,
  buildChildren,
  countDescendants,
  matchesQuery,
  visibleRows,
  type VisibleOptions,
} from "@/lib/processes";
import { PROCESSES, proc } from "@/test/fixtures";

const base: VisibleOptions = {
  mode: "tree",
  sort: { key: "pid", dir: "asc" },
  query: "",
  owner: "all",
  showKernel: false,
  collapsed: new Set(),
  openGroups: new Set(),
};

function names(opts: Partial<VisibleOptions>) {
  return visibleRows(PROCESSES, { ...base, ...opts }).map(
    (r) => `${"  ".repeat(r.depth)}${r.process.pid}${r.dimmed ? "~" : ""}`,
  );
}

describe("tree mode", () => {
  it("nests children under their parents and hides kernel threads", () => {
    expect(names({})).toEqual([
      "1",
      "  100",
      "    200",
      "      300",
      "  400",
      "    401",
      "    402",
    ]);
  });

  it("shows kernel threads on request", () => {
    expect(names({ showKernel: true })).toContain("  3");
  });

  it("leaves out the children of collapsed branches", () => {
    expect(names({ collapsed: new Set([100]) })).toEqual([
      "1",
      "  100",
      "  400",
      "    401",
      "    402",
    ]);
  });

  it("sorts siblings, not the whole list", () => {
    const rows = visibleRows(PROCESSES, { ...base, sort: { key: "cpu", dir: "desc" } });
    expect(rows.map((r) => r.process.pid)).toEqual([1, 400, 401, 402, 100, 200, 300]);
  });

  it("keeps the ancestors of a match as dimmed context and opens them", () => {
    expect(names({ query: "vim", collapsed: new Set([1, 100]) })).toEqual([
      "1~",
      "  100~",
      "    200~",
      "      300",
    ]);
  });

  it("filters by owner the same way", () => {
    expect(names({ owner: "others" })).toEqual(["1", "  100"]);
  });

  it("survives parent cycles from reused PIDs", () => {
    const cyclic = [proc({ pid: 10, parentPid: 11 }), proc({ pid: 11, parentPid: 10 })];
    const rows = visibleRows(cyclic, base);
    expect(rows.map((r) => r.process.pid).sort()).toEqual([10, 11]);
  });

  it("treats a process that is its own parent as a root", () => {
    const { roots } = buildChildren([proc({ pid: 0, parentPid: 0 })]);
    expect(roots.map((r) => r.pid)).toEqual([0]);
  });
});

describe("list mode", () => {
  it("is flat and globally sorted", () => {
    const rows = visibleRows(PROCESSES, {
      ...base,
      mode: "list",
      sort: { key: "memory", dir: "desc" },
    });
    expect(rows.every((r) => r.depth === 0)).toBe(true);
    expect(rows[0].process.pid).toBe(400);
  });

  it("drops non-matches instead of dimming them", () => {
    const rows = visibleRows(PROCESSES, { ...base, mode: "list", query: "vim" });
    expect(rows.map((r) => r.process.pid)).toEqual([300]);
  });
});

describe("apps mode", () => {
  it("groups processes of the same program and sums them", () => {
    const rows = visibleRows(PROCESSES, {
      ...base,
      mode: "apps",
      sort: { key: "cpu", dir: "desc" },
    });
    const firefox = rows[0];
    expect(firefox.kind).toBe("group");
    expect(firefox.members).toHaveLength(3);
    expect(firefox.process.cpu).toBe(18);
    expect(firefox.process.threads).toBe(120);
    expect(firefox.expanded).toBe(false);
  });

  it("opens a group to show its members", () => {
    const rows = visibleRows(PROCESSES, {
      ...base,
      mode: "apps",
      openGroups: new Set(["g:firefox"]),
    });
    const i = rows.findIndex((r) => r.id === "g:firefox");
    expect(rows.slice(i + 1, i + 4).map((r) => [r.depth, r.process.pid])).toEqual([
      [1, 400],
      [1, 401],
      [1, 402],
    ]);
  });

  it("keeps single processes as plain rows", () => {
    const rows = visibleRows(PROCESSES, { ...base, mode: "apps" });
    expect(rows.find((r) => r.process.name === "vim")?.kind).toBe("process");
  });

  it("marks a group protected only if every member is", () => {
    expect(aggregate("x", [proc({ pid: 1, protected: true }), proc({ pid: 2 })]).protected).toBe(
      false,
    );
  });
});

describe("search", () => {
  it("matches name, exact PID, user and command line, case-insensitively", () => {
    const vim = PROCESSES.find((p) => p.pid === 300)!;
    expect(matchesQuery(vim, "VIM")).toBe(true);
    expect(matchesQuery(vim, "300")).toBe(true);
    expect(matchesQuery(vim, "30")).toBe(false);
    expect(matchesQuery(vim, "luna")).toBe(true);
    expect(matchesQuery(vim, "notes.md")).toBe(true);
    expect(matchesQuery(vim, "  ")).toBe(true);
  });
});

describe("countDescendants", () => {
  it("counts children and grandchildren", () => {
    expect(countDescendants(PROCESSES, 1)).toBe(6);
    expect(countDescendants(PROCESSES, 400)).toBe(2);
    expect(countDescendants(PROCESSES, 300)).toBe(0);
  });
});
