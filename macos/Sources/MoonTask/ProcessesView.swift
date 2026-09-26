import AppKit
import MoonTaskCore
import MoonTaskSystem
import SwiftUI

struct ProcessesView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(SettingKey.showKernel) private var showKernel = true
    @AppStorage(SettingKey.confirmOwn) private var confirmOwn = true

    @State private var mode: ViewMode = .tree
    @State private var owner: OwnerFilter = .all
    @State private var query = ""
    @State private var sort = SortState(key: .cpu, ascending: false)
    @State private var sortOrder = [KeyPathComparator(\VisibleRow.sortCPU, order: .reverse)]
    @State private var collapsed: Set<Int32> = []
    @State private var openGroups: Set<String> = []
    @State private var selection: VisibleRow.ID?
    @State private var showDetail = true
    @State private var pending: PendingAction?

    struct PendingAction: Identifiable {
        let id = UUID()
        let action: ProcessAction
        let row: ProcessRow
        let descendants: Int
    }

    var body: some View {
        let processes = model.snapshot.processes
        let rows = visibleRows(processes, VisibleOptions(
            mode: mode, sort: sort, query: query, owner: owner, showKernel: showKernel,
            collapsed: collapsed, openGroups: openGroups
        ))
        let selected = rows.first { $0.id == selection }

        table(rows)
            .scrollContentBackground(.hidden)
            .alternatingRowBackgrounds(.disabled)
            .glass(cornerRadius: 14)
            .padding(16)
            .searchable(text: $query, placement: .toolbar, prompt: "Name, PID, user or path")
            .toolbar { toolbar(selected) }
            .inspector(isPresented: $showDetail) {
                Group {
                    if let selected, selected.kind == .process {
                        ProcessDetailView(row: selected.process, onAction: request)
                    } else if let selected {
                        GroupDetailView(row: selected)
                    } else {
                        EmptyNote(
                            symbol: "cursorarrow.click",
                            title: "No process selected",
                            text: "Select a process to see what it is, what it has open and what you can do with it."
                        )
                    }
                }
                .inspectorColumnWidth(min: 280, ideal: 330, max: 460)
            }
            .onChange(of: sortOrder) { _, order in
                if let first = order.first { sort = SortState(key: key(for: first.keyPath), ascending: first.order == .forward) }
            }
            .onDeleteCommand {
                if let selected, selected.kind == .process { request(.end, selected.process) }
            }
            .confirmationDialog(
                pending.map { "\($0.action.label) \($0.row.name)?" } ?? "",
                isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
                presenting: pending
            ) { p in
                Button(p.action.label, role: .destructive) { model.perform(p.action, on: p.row) }
                Button("Cancel", role: .cancel) {}
            } message: { p in
                Text(Safety.consequence(p.action, on: p.row, descendants: p.descendants)
                    + (p.row.owner == .current ? "" : "\n\nIt belongs to \(p.row.user ?? p.row.owner.label.lowercased()), not to you."))
            }
    }

    // MARK: - Table

    private func table(_ rows: [VisibleRow]) -> some View {
        Table(rows, selection: $selection, sortOrder: $sortOrder) {
            TableColumn("Name", value: \VisibleRow.sortName) { row in
                NameCell(row: row, isFresh: model.fresh.contains(row.process.identity)) { toggle(row) }
            }
            .width(min: 160, ideal: 220)
            TableColumn("PID", value: \VisibleRow.sortPid) { row in
                Text(row.kind == .group ? "" : String(row.process.pid))
                    .font(.figure(12, weight: .regular))
                    .foregroundStyle(Palette.textMuted)
            }
            .width(min: 50, ideal: 64, max: 80)
            TableColumn("CPU", value: \VisibleRow.sortCPU) { row in
                HeatCell(text: row.process.cpu < 0.05 ? "0.0" : String(format: "%.1f", row.process.cpu), load: row.process.cpu)
            }
            .width(min: 54, ideal: 64, max: 90)
            TableColumn("Memory", value: \VisibleRow.sortMemory) { row in
                Text(Format.bytes(row.process.memory))
                    .font(.figure(12, weight: .regular))
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 70, ideal: 86, max: 120)
            TableColumn("Threads", value: \VisibleRow.sortThreads) { row in
                Text(row.process.threads.map(String.init) ?? "–")
                    .font(.figure(12, weight: .regular))
                    .foregroundStyle(Palette.textMuted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 50, ideal: 60, max: 80)
            TableColumn("Disk", value: \VisibleRow.sortDisk) { row in
                let total = row.process.diskRead + row.process.diskWrite
                Text(total > 0 ? Format.rate(total) : "")
                    .font(.figure(12, weight: .regular))
                    .foregroundStyle(Palette.textMuted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 60, ideal: 80, max: 110)
            TableColumn("User", value: \VisibleRow.sortUser) { row in
                Text(row.process.user ?? "–").foregroundStyle(Palette.textMuted).lineLimit(1)
            }
            .width(min: 60, ideal: 84, max: 160)
            TableColumn("State", value: \VisibleRow.sortState) { row in
                Text(row.process.state.label)
                    .foregroundStyle(row.process.state.tone)
            }
            .width(min: 60, ideal: 80, max: 100)
        }
        .contextMenu(forSelectionType: VisibleRow.ID.self) { ids in
            if let id = ids.first, let row = rows.first(where: { $0.id == id }), row.kind == .process {
                actionMenu(row.process)
            }
        } primaryAction: { ids in
            if let id = ids.first, let row = rows.first(where: { $0.id == id }) { toggle(row) }
        }
    }

    private static let sortKeys: [PartialKeyPath<VisibleRow>: SortKey] = [
        \VisibleRow.sortName: .name,
        \VisibleRow.sortPid: .pid,
        \VisibleRow.sortUser: .user,
        \VisibleRow.sortCPU: .cpu,
        \VisibleRow.sortMemory: .memory,
        \VisibleRow.sortThreads: .threads,
        \VisibleRow.sortDisk: .disk,
        \VisibleRow.sortState: .state,
    ]

    private func key(for keyPath: PartialKeyPath<VisibleRow>) -> SortKey {
        Self.sortKeys[keyPath] ?? .cpu
    }

    private func toggle(_ row: VisibleRow) {
        guard row.hasChildren else { return }
        if row.kind == .group {
            if openGroups.contains(row.id) { openGroups.remove(row.id) } else { openGroups.insert(row.id) }
        } else {
            let pid = row.process.pid
            if collapsed.contains(pid) { collapsed.remove(pid) } else { collapsed.insert(pid) }
        }
    }

    // MARK: - Actions

    @ViewBuilder private func actionMenu(_ p: ProcessRow) -> some View {
        Button("End") { request(.end, p) }.disabled(!Safety.isAllowed(.end, on: p))
        Button("Force Quit") { request(.forceQuit, p) }.disabled(!Safety.isAllowed(.forceQuit, on: p))
        Button("End Process Tree") { request(.endTree, p) }.disabled(!Safety.isAllowed(.endTree, on: p))
        Divider()
        if p.state == .stopped {
            Button("Resume") { request(.resume, p) }
        } else {
            Button("Suspend") { request(.suspend, p) }.disabled(!Safety.isAllowed(.suspend, on: p))
        }
        Menu("Priority") {
            ForEach(PriorityLevel.allCases) { level in
                Button(level.label) { request(.setPriority(level.nice), p) }
            }
        }
        .disabled(p.isProtected)
        Divider()
        if let path = p.path {
            Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) }
        }
        Button("Copy PID") { copy("\(p.pid)") }
    }

    private func request(_ action: ProcessAction, _ row: ProcessRow) {
        guard Safety.isAllowed(action, on: row) else {
            model.message = ControlError.protected(row.name).errorDescription
            return
        }
        if Safety.needsConfirmation(action, on: row, confirmOwn: confirmOwn) {
            pending = PendingAction(
                action: action, row: row,
                descendants: countDescendants(model.snapshot.processes, of: row.pid)
            )
        } else {
            model.perform(action, on: row)
        }
    }

    @ToolbarContentBuilder private func toolbar(_ selected: VisibleRow?) -> some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Picker("View", selection: $mode) {
                ForEach(ViewMode.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .help("Tree: parents and children · List: flat · Apps: grouped by name")
        }
        ToolbarItem {
            Picker("Owner", selection: $owner) {
                ForEach(OwnerFilter.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .help("Whose processes to show")
        }
        ToolbarItem {
            Button {
                if let p = selected?.process, selected?.kind == .process { request(.end, p) }
            } label: {
                Label("End", systemImage: "xmark.circle")
            }
            .disabled(selected?.kind != .process || !(selected.map { Safety.isAllowed(.end, on: $0.process) } ?? false))
            .help("End the selected process (⌫)")
        }
        ToolbarItem {
            Button { showDetail.toggle() } label: { Label("Details", systemImage: "sidebar.right") }
                .help("Show or hide the details")
        }
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

enum PriorityLevel: Int32, CaseIterable, Identifiable {
    case normal = 0, belowNormal = 5, low = 10, lowest = 20
    var id: Int32 { rawValue }
    var nice: Int32 { rawValue }

    var label: String {
        switch self {
        case .normal: return "Normal"
        case .belowNormal: return "Below normal"
        case .low: return "Low"
        case .lowest: return "Lowest (background)"
        }
    }
}

/// The name column: indentation, disclosure, owner dot, name and badges.
private struct NameCell: View {
    var row: VisibleRow
    var isFresh: Bool
    var onToggle: () -> Void

    var body: some View {
        HStack(spacing: 5) {
            if row.depth > 0 { Spacer().frame(width: CGFloat(row.depth) * 14) }
            if row.hasChildren {
                Button(action: onToggle) {
                    Image(systemName: row.isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Palette.textMuted)
                        .frame(width: 12)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(row.isExpanded ? "Collapse \(row.process.name)" : "Expand \(row.process.name)")
            } else {
                Spacer().frame(width: 12)
            }
            OwnerDot(owner: row.process.owner)
            Text(row.process.name)
                .fontWeight(.medium)
                .foregroundStyle(Palette.text)
                .lineLimit(1)
            if row.kind == .group {
                Chip(text: "\(row.members.count)")
            }
            if row.process.isProtected && row.kind == .process {
                Image(systemName: "lock.shield")
                    .font(.system(size: 10))
                    .foregroundStyle(Palette.textFaint)
                    .help("Protected — ending it would take macOS or MoonTask down")
            }
        }
        .opacity(row.isDimmed ? 0.45 : 1)
        .padding(.vertical, 1)
        .background(isFresh ? Palette.fresh : Color.clear)
        .help(row.process.path ?? row.process.name)
    }
}

/// A load cell with a calm heat tint, like Task Manager's columns.
private struct HeatCell: View {
    var text: String
    var load: Double

    var body: some View {
        Text(text)
            .font(.figure(12, weight: .regular))
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.horizontal, 4)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(Palette.chart1.opacity(load < 0.5 ? 0 : 0.08 + min(load, 50) * 0.008))
            )
    }
}
