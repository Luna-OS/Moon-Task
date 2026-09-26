import Foundation

/// Turns the flat process list of a snapshot into the rows the process table
/// shows: as a parent/child tree, as a flat list, or grouped by app —
/// filtered, sorted and with collapsed branches left out. Pure functions, so
/// every rule here is unit-tested (the same rules as the Windows/Linux app).

public enum ViewMode: String, CaseIterable, Sendable {
    case tree, list, apps

    public var label: String {
        switch self {
        case .tree: return "Tree"
        case .list: return "List"
        case .apps: return "Apps"
        }
    }
}

public enum SortKey: String, CaseIterable, Sendable {
    case name, pid, user, cpu, memory, threads, disk, state
}

public struct SortState: Equatable, Sendable {
    public var key: SortKey
    public var ascending: Bool

    public init(key: SortKey, ascending: Bool) {
        self.key = key
        self.ascending = ascending
    }

    /// What a click on a column header does: the same column flips the
    /// direction, a new one starts with the natural direction (numbers
    /// largest first, text A–Z).
    public func toggled(_ newKey: SortKey) -> SortState {
        if newKey == key { return SortState(key: key, ascending: !ascending) }
        let text: Set<SortKey> = [.name, .user, .state, .pid]
        return SortState(key: newKey, ascending: text.contains(newKey))
    }
}

public enum OwnerFilter: String, CaseIterable, Sendable {
    case all, mine, others

    public var label: String {
        switch self {
        case .all: return "Everyone"
        case .mine: return "Mine"
        case .others: return "System & others"
        }
    }
}

public struct VisibleRow: Identifiable, Hashable, Sendable {
    public enum Kind: Hashable, Sendable { case process, group }

    /// `p:<pid>` for a process, `g:<name>` for an app group.
    public var id: String
    public var kind: Kind
    public var depth: Int
    /// For groups: a synthesized row with the members' sums.
    public var process: ProcessRow
    public var hasChildren: Bool
    public var isExpanded: Bool
    /// Only shown as the ancestor of a match, not a match itself.
    public var isDimmed: Bool
    /// Group members (groups only).
    public var members: [ProcessRow]

    // Sort values for SwiftUI's table columns.
    public var sortName: String { process.name.lowercased() }
    public var sortPid: Int32 { process.pid }
    public var sortUser: String { (process.user ?? "").lowercased() }
    public var sortCPU: Double { process.cpu }
    public var sortMemory: UInt64 { process.memory }
    public var sortThreads: Int { process.threads ?? 0 }
    public var sortDisk: Double { process.diskRead + process.diskWrite }
    public var sortState: String { process.state.rawValue }
}

public struct VisibleOptions: Sendable {
    public var mode: ViewMode
    public var sort: SortState
    public var query: String
    public var owner: OwnerFilter
    public var showKernel: Bool
    /// Tree mode: PIDs whose children are hidden.
    public var collapsed: Set<Int32>
    /// App mode: group ids that are open.
    public var openGroups: Set<String>

    public init(
        mode: ViewMode = .tree, sort: SortState = SortState(key: .cpu, ascending: false),
        query: String = "", owner: OwnerFilter = .all, showKernel: Bool = true,
        collapsed: Set<Int32> = [], openGroups: Set<String> = []
    ) {
        self.mode = mode
        self.sort = sort
        self.query = query
        self.owner = owner
        self.showKernel = showKernel
        self.collapsed = collapsed
        self.openGroups = openGroups
    }
}

public func processRowID(_ pid: Int32) -> String { "p:\(pid)" }
public func groupRowID(_ name: String) -> String { "g:\(name.lowercased())" }

/// Case-insensitive search over name, PID, user and executable path.
public func matchesQuery(_ row: ProcessRow, _ query: String) -> Bool {
    let q = query.trimmingCharacters(in: .whitespaces).lowercased()
    if q.isEmpty { return true }
    return row.name.lowercased().contains(q)
        || String(row.pid) == q
        || (row.user?.lowercased().contains(q) ?? false)
        || (row.path?.lowercased().contains(q) ?? false)
}

func matchesOwner(_ row: ProcessRow, _ owner: OwnerFilter) -> Bool {
    switch owner {
    case .all: return true
    case .mine: return row.owner == .current
    case .others: return row.owner != .current
    }
}

/// Orders two rows by the sort state; equal values fall back to the PID so
/// rows don't jump around between refreshes.
public func compareRows(_ a: ProcessRow, _ b: ProcessRow, _ sort: SortState) -> Bool {
    let result: Int
    switch sort.key {
    case .name: result = compare(a.name.lowercased(), b.name.lowercased())
    case .pid: result = compare(a.pid, b.pid)
    case .user: result = compare((a.user ?? "").lowercased(), (b.user ?? "").lowercased())
    case .cpu: result = compare(a.cpu, b.cpu)
    case .memory: result = compare(a.memory, b.memory)
    case .threads: result = compare(a.threads ?? 0, b.threads ?? 0)
    case .disk: result = compare(a.diskRead + a.diskWrite, b.diskRead + b.diskWrite)
    case .state: result = compare(a.state.rawValue, b.state.rawValue)
    }
    if result != 0 { return sort.ascending ? result < 0 : result > 0 }
    return a.pid < b.pid
}

private func compare<T: Comparable>(_ a: T, _ b: T) -> Int {
    a < b ? -1 : (a > b ? 1 : 0)
}

/// A process' children, keyed by parent PID; processes whose parent isn't
/// listed (or is themselves) are roots.
public func buildChildren(_ rows: [ProcessRow]) -> (roots: [ProcessRow], children: [Int32: [ProcessRow]]) {
    let pids = Set(rows.map(\.pid))
    var children: [Int32: [ProcessRow]] = [:]
    var roots: [ProcessRow] = []
    for row in rows {
        if let parent = row.parentPid, parent != row.pid, pids.contains(parent) {
            children[parent, default: []].append(row)
        } else {
            roots.append(row)
        }
    }
    // PID reuse can produce parent cycles that no root reaches; promote one
    // member of each such cycle to a root so nothing silently disappears.
    var reached = Set<Int32>()
    func reach(from start: [ProcessRow]) {
        var stack = start
        while let row = stack.popLast() {
            if !reached.insert(row.pid).inserted { continue }
            stack.append(contentsOf: children[row.pid] ?? [])
        }
    }
    reach(from: roots)
    for row in rows where !reached.contains(row.pid) {
        roots.append(row)
        reach(from: [row])
    }
    return (roots, children)
}

public func visibleRows(_ rows: [ProcessRow], _ opts: VisibleOptions) -> [VisibleRow] {
    let pool = opts.showKernel ? rows : rows.filter { $0.owner != .kernel }
    let filtering = !opts.query.trimmingCharacters(in: .whitespaces).isEmpty || opts.owner != .all
    let isMatch: (ProcessRow) -> Bool = { matchesQuery($0, opts.query) && matchesOwner($0, opts.owner) }
    let less: (ProcessRow, ProcessRow) -> Bool = { compareRows($0, $1, opts.sort) }

    switch opts.mode {
    case .list:
        return pool.filter(isMatch).sorted(by: less).map { processRow($0, depth: 0) }
    case .apps:
        return appRows(pool.filter(isMatch), opts, less)
    case .tree:
        return treeRows(pool, opts, filtering, isMatch, less)
    }
}

private func processRow(
    _ process: ProcessRow, depth: Int, hasChildren: Bool = false, expanded: Bool = false,
    dimmed: Bool = false
) -> VisibleRow {
    VisibleRow(
        id: processRowID(process.pid), kind: .process, depth: depth, process: process,
        hasChildren: hasChildren, isExpanded: expanded, isDimmed: dimmed, members: []
    )
}

private func treeRows(
    _ pool: [ProcessRow], _ opts: VisibleOptions, _ filtering: Bool,
    _ isMatch: (ProcessRow) -> Bool, _ less: @escaping (ProcessRow, ProcessRow) -> Bool
) -> [VisibleRow] {
    let (roots, children) = buildChildren(pool)

    // While filtering, keep each match plus the chain of its ancestors (as
    // dimmed context) and show every branch open.
    var keep: Set<Int32>? = nil
    var matched = Set<Int32>()
    if filtering {
        var kept = Set<Int32>()
        let byPid = Dictionary(pool.map { ($0.pid, $0) }, uniquingKeysWith: { a, _ in a })
        for row in pool where isMatch(row) {
            matched.insert(row.pid)
            var current: ProcessRow? = row
            while let c = current, !kept.contains(c.pid) {
                kept.insert(c.pid)
                if let parent = c.parentPid, parent != c.pid {
                    current = byPid[parent]
                } else {
                    current = nil
                }
            }
        }
        keep = kept
    }

    var out: [VisibleRow] = []
    var visited = Set<Int32>()
    func walk(_ row: ProcessRow, _ depth: Int) {
        if !visited.insert(row.pid).inserted { return }
        let kids = (children[row.pid] ?? []).filter { keep?.contains($0.pid) ?? true }
        let expanded = filtering || !opts.collapsed.contains(row.pid)
        out.append(processRow(
            row, depth: depth, hasChildren: !kids.isEmpty, expanded: expanded,
            dimmed: filtering && !matched.contains(row.pid)
        ))
        if !expanded { return }
        for kid in kids.sorted(by: less) { walk(kid, depth + 1) }
    }
    for root in roots.filter({ keep?.contains($0.pid) ?? true }).sorted(by: less) {
        walk(root, 0)
    }
    return out
}

/// Sums a group of processes into one synthetic row.
public func aggregate(_ name: String, _ members: [ProcessRow]) -> ProcessRow {
    var summary = members.min { $0.pid < $1.pid }!
    let users = Set(members.map { $0.user ?? "" })
    summary.name = name
    summary.user = users.count == 1 ? summary.user : "\(users.count) users"
    if members.contains(where: { $0.state == .running }) { summary.state = .running }
    summary.cpu = members.reduce(0) { $0 + $1.cpu }
    summary.memory = members.reduce(0) { $0 + $1.memory }
    summary.threads = members.reduce(0) { $0 + ($1.threads ?? 0) }
    summary.diskRead = members.reduce(0) { $0 + $1.diskRead }
    summary.diskWrite = members.reduce(0) { $0 + $1.diskWrite }
    summary.cpuTime = members.reduce(0) { $0 + $1.cpuTime }
    summary.isProtected = members.allSatisfy(\.isProtected)
    return summary
}

private func appRows(
    _ matches: [ProcessRow], _ opts: VisibleOptions,
    _ less: @escaping (ProcessRow, ProcessRow) -> Bool
) -> [VisibleRow] {
    var groups: [String: [ProcessRow]] = [:]
    var order: [String] = []
    for row in matches {
        let key = row.name.lowercased()
        if groups[key] == nil { order.append(key) }
        groups[key, default: []].append(row)
    }
    let entries: [(members: [ProcessRow], summary: ProcessRow)] = order.map { key in
        let members = groups[key]!
        return (members, members.count == 1 ? members[0] : aggregate(members[0].name, members))
    }

    var out: [VisibleRow] = []
    for entry in entries.sorted(by: { less($0.summary, $1.summary) }) {
        if entry.members.count == 1 {
            out.append(processRow(entry.summary, depth: 0))
            continue
        }
        let id = groupRowID(entry.summary.name)
        let open = opts.openGroups.contains(id)
        out.append(VisibleRow(
            id: id, kind: .group, depth: 0, process: entry.summary, hasChildren: true,
            isExpanded: open, isDimmed: false, members: entry.members
        ))
        if open {
            for member in entry.members.sorted(by: less) {
                out.append(processRow(member, depth: 1))
            }
        }
    }
    return out
}

/// How many processes `pid` started, directly or indirectly.
public func countDescendants(_ rows: [ProcessRow], of pid: Int32) -> Int {
    let (_, children) = buildChildren(rows)
    var count = 0
    var seen: Set<Int32> = [pid]
    var stack = children[pid] ?? []
    while let row = stack.popLast() {
        if !seen.insert(row.pid).inserted { continue }
        count += 1
        stack.append(contentsOf: children[row.pid] ?? [])
    }
    return count
}

/// `pid` and everything it started, children before their parents — the
/// order to end a tree in.
public func descendantsFirst(_ rows: [ProcessRow], of pid: Int32) -> [ProcessRow] {
    let (_, children) = buildChildren(rows)
    guard let root = rows.first(where: { $0.pid == pid }) else { return [] }
    var out: [ProcessRow] = []
    var seen = Set<Int32>()
    func visit(_ row: ProcessRow) {
        if !seen.insert(row.pid).inserted { return }
        for child in children[row.pid] ?? [] { visit(child) }
        out.append(row)
    }
    visit(root)
    return out
}
