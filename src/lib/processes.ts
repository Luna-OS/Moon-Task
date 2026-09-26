/**
 * Turns the flat process list from a snapshot into the rows the process
 * table shows: as a parent/child tree, as a flat list, or grouped by app —
 * filtered, sorted and with collapsed branches left out. Pure functions,
 * no React, so every rule here is unit-tested.
 */
import type { ProcessRow } from "@/types/models";

export type ViewMode = "tree" | "list" | "apps";
export type SortKey =
  "name" | "pid" | "user" | "cpu" | "gpu" | "memory" | "threads" | "disk" | "status";
export type SortDir = "asc" | "desc";
export interface SortState {
  key: SortKey;
  dir: SortDir;
}
export type OwnerFilter = "all" | "mine" | "others";

export interface VisibleRow {
  /** `p:<pid>` for a process, `g:<name>` for an app group. */
  id: string;
  kind: "process" | "group";
  depth: number;
  /** For groups: a synthesized row with the members' sums. */
  process: ProcessRow;
  hasChildren: boolean;
  expanded: boolean;
  /** Only shown as the ancestor of a match, not a match itself. */
  dimmed: boolean;
  /** Group members (groups only). */
  members?: ProcessRow[];
}

export interface VisibleOptions {
  mode: ViewMode;
  sort: SortState;
  query: string;
  owner: OwnerFilter;
  showKernel: boolean;
  /** Tree mode: PIDs whose children are hidden. */
  collapsed: ReadonlySet<number>;
  /** App mode: group ids that are open. */
  openGroups: ReadonlySet<string>;
}

export function processId(pid: number): string {
  return `p:${pid}`;
}

export function groupId(name: string): string {
  return `g:${name.toLowerCase()}`;
}

/** Case-insensitive search over name, PID, user, executable and command line. */
export function matchesQuery(row: ProcessRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    row.name.toLowerCase().includes(q) ||
    String(row.pid) === q ||
    (row.user?.toLowerCase().includes(q) ?? false) ||
    (row.exe?.toLowerCase().includes(q) ?? false) ||
    row.command.toLowerCase().includes(q)
  );
}

function matchesOwner(row: ProcessRow, owner: OwnerFilter): boolean {
  if (owner === "mine") return row.owner === "current";
  if (owner === "others") return row.owner !== "current";
  return true;
}

function sortValue(row: ProcessRow, key: SortKey): number | string {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "pid":
      return row.pid;
    case "user":
      return (row.user ?? "").toLowerCase();
    case "cpu":
      return row.cpu;
    case "gpu":
      return row.gpu ?? -1;
    case "memory":
      return row.memory;
    case "threads":
      return row.threads ?? 0;
    case "disk":
      return row.diskRead + row.diskWrite;
    case "status":
      return row.status;
  }
}

export function compareRows(a: ProcessRow, b: ProcessRow, sort: SortState): number {
  const va = sortValue(a, sort.key);
  const vb = sortValue(b, sort.key);
  let result: number;
  if (typeof va === "string" && typeof vb === "string") {
    result = va.localeCompare(vb);
  } else {
    result = (va as number) - (vb as number);
  }
  if (sort.dir === "desc") result = -result;
  // Stable order for equal values, so rows don't jump between refreshes.
  return result !== 0 ? result : a.pid - b.pid;
}

/** A process' children, keyed by parent PID; processes whose parent isn't
 * listed (or is themselves) are roots. */
export function buildChildren(rows: ProcessRow[]): {
  roots: ProcessRow[];
  children: Map<number, ProcessRow[]>;
} {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const children = new Map<number, ProcessRow[]>();
  const roots: ProcessRow[] = [];
  for (const row of rows) {
    const parent = row.parentPid;
    if (parent !== null && parent !== row.pid && byPid.has(parent)) {
      const list = children.get(parent);
      if (list) list.push(row);
      else children.set(parent, [row]);
    } else {
      roots.push(row);
    }
  }
  // PID reuse can produce parent cycles that no root reaches; promote one
  // member of each such cycle to a root so nothing silently disappears.
  const reached = new Set<number>();
  const stack = [...roots];
  while (stack.length > 0) {
    const row = stack.pop()!;
    if (reached.has(row.pid)) continue;
    reached.add(row.pid);
    stack.push(...(children.get(row.pid) ?? []));
  }
  for (const row of rows) {
    if (reached.has(row.pid)) continue;
    roots.push(row);
    const cycle = [row];
    while (cycle.length > 0) {
      const r = cycle.pop()!;
      if (reached.has(r.pid)) continue;
      reached.add(r.pid);
      cycle.push(...(children.get(r.pid) ?? []));
    }
  }
  return { roots, children };
}

export function visibleRows(rows: ProcessRow[], opts: VisibleOptions): VisibleRow[] {
  const pool = opts.showKernel ? rows : rows.filter((r) => r.owner !== "kernel");
  const filtering = opts.query.trim() !== "" || opts.owner !== "all";
  const isMatch = (r: ProcessRow) => matchesQuery(r, opts.query) && matchesOwner(r, opts.owner);
  const cmp = (a: ProcessRow, b: ProcessRow) => compareRows(a, b, opts.sort);

  if (opts.mode === "list") {
    return pool
      .filter(isMatch)
      .sort(cmp)
      .map((process) => processRow(process, 0, false, false, false));
  }
  if (opts.mode === "apps") {
    return appRows(pool.filter(isMatch), opts, cmp);
  }
  return treeRows(pool, opts, filtering, isMatch, cmp);
}

function processRow(
  process: ProcessRow,
  depth: number,
  hasChildren: boolean,
  expanded: boolean,
  dimmed: boolean,
): VisibleRow {
  return {
    id: processId(process.pid),
    kind: "process",
    depth,
    process,
    hasChildren,
    expanded,
    dimmed,
  };
}

function treeRows(
  pool: ProcessRow[],
  opts: VisibleOptions,
  filtering: boolean,
  isMatch: (r: ProcessRow) => boolean,
  cmp: (a: ProcessRow, b: ProcessRow) => number,
): VisibleRow[] {
  const { roots, children } = buildChildren(pool);

  // While filtering, keep each match plus the chain of its ancestors (as
  // dimmed context) and show every branch open.
  let keep: Set<number> | null = null;
  const matched = new Set<number>();
  if (filtering) {
    keep = new Set();
    const byPid = new Map(pool.map((r) => [r.pid, r]));
    for (const row of pool) {
      if (!isMatch(row)) continue;
      matched.add(row.pid);
      let current: ProcessRow | undefined = row;
      while (current && !keep.has(current.pid)) {
        keep.add(current.pid);
        const parent: number | null = current.parentPid;
        current = parent !== null && parent !== current.pid ? byPid.get(parent) : undefined;
      }
    }
  }

  const out: VisibleRow[] = [];
  const visited = new Set<number>();
  const walk = (row: ProcessRow, depth: number) => {
    if (visited.has(row.pid)) return;
    visited.add(row.pid);
    const kids = (children.get(row.pid) ?? []).filter((k) => keep === null || keep.has(k.pid));
    const expanded = filtering || !opts.collapsed.has(row.pid);
    out.push(processRow(row, depth, kids.length > 0, expanded, filtering && !matched.has(row.pid)));
    if (!expanded) return;
    for (const kid of kids.sort(cmp)) walk(kid, depth + 1);
  };
  for (const root of roots.filter((r) => keep === null || keep.has(r.pid)).sort(cmp)) {
    walk(root, 0);
  }
  return out;
}

/** Sums a group of processes into one synthetic row. */
export function aggregate(name: string, members: ProcessRow[]): ProcessRow {
  const first = members.reduce((a, b) => (a.pid < b.pid ? a : b));
  const users = new Set(members.map((m) => m.user));
  const running = members.some((m) => m.status === "running");
  return {
    ...first,
    name,
    user: users.size === 1 ? first.user : `${users.size} users`,
    status: running ? "running" : first.status,
    cpu: members.reduce((s, m) => s + m.cpu, 0),
    gpu: members.some((m) => m.gpu !== null)
      ? Math.min(
          100,
          members.reduce((s, m) => s + (m.gpu ?? 0), 0),
        )
      : null,
    memory: members.reduce((s, m) => s + m.memory, 0),
    virtualMemory: members.reduce((s, m) => s + m.virtualMemory, 0),
    threads: members.reduce((s, m) => s + (m.threads ?? 0), 0),
    diskRead: members.reduce((s, m) => s + m.diskRead, 0),
    diskWrite: members.reduce((s, m) => s + m.diskWrite, 0),
    protected: members.every((m) => m.protected),
  };
}

function appRows(
  matches: ProcessRow[],
  opts: VisibleOptions,
  cmp: (a: ProcessRow, b: ProcessRow) => number,
): VisibleRow[] {
  const groups = new Map<string, ProcessRow[]>();
  for (const row of matches) {
    const key = row.name.toLowerCase();
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const entries = [...groups.values()].map((members) => {
    const summary = members.length === 1 ? members[0] : aggregate(members[0].name, members);
    return { members, summary };
  });
  entries.sort((a, b) => cmp(a.summary, b.summary));

  const out: VisibleRow[] = [];
  for (const { members, summary } of entries) {
    if (members.length === 1) {
      out.push(processRow(summary, 0, false, false, false));
      continue;
    }
    const id = groupId(summary.name);
    const open = opts.openGroups.has(id);
    out.push({
      id,
      kind: "group",
      depth: 0,
      process: summary,
      hasChildren: true,
      expanded: open,
      dimmed: false,
      members,
    });
    if (open) {
      for (const m of [...members].sort(cmp)) out.push(processRow(m, 1, false, false, false));
    }
  }
  return out;
}

/** How many processes `pid` started, directly or indirectly. */
export function countDescendants(rows: ProcessRow[], pid: number): number {
  const { children } = buildChildren(rows);
  let count = 0;
  const seen = new Set<number>([pid]);
  const stack = [...(children.get(pid) ?? [])];
  while (stack.length > 0) {
    const row = stack.pop()!;
    if (seen.has(row.pid)) continue;
    seen.add(row.pid);
    count += 1;
    stack.push(...(children.get(row.pid) ?? []));
  }
  return count;
}
