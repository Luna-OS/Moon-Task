import AppKit
import MoonTaskCore
import MoonTaskSystem
import SwiftUI
import UniformTypeIdentifiers

/// The detail panel of the selected process.
struct ProcessDetailView: View {
    @Environment(AppModel.self) private var model
    var row: ProcessRow
    var onAction: (ProcessAction, ProcessRow) -> Void

    @State private var tab: DetailTab = .general
    @State private var details = ProcessDetails()
    @State private var loadedFor: ProcessIdentity?

    enum DetailTab: String, CaseIterable, Identifiable {
        case general = "General", files = "Files", network = "Network", environment = "Environment"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            actions
            Picker("", selection: $tab) {
                ForEach(DetailTab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    switch tab {
                    case .general: general
                    case .files: files
                    case .network: network
                    case .environment: environment
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(SkyBackground())
        .task(id: row.identity) { await load() }
        .task(id: tab) { await load() }
    }

    private func load() async {
        let current = row
        details = await Task.detached(priority: .userInitiated) {
            ProcessInspector.details(of: current)
        }.value
        loadedFor = current.identity
    }

    // MARK: - Parts

    private var header: some View {
        HStack(spacing: 12) {
            AppIcon(path: row.path)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.name)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Palette.text)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    OwnerDot(owner: row.owner)
                    Text(verbatim: "PID \(row.pid) · \(row.user ?? row.owner.label)")
                        .font(.system(size: 11.5))
                        .foregroundStyle(Palette.textMuted)
                    Chip(text: row.state.label, tone: row.state.tone)
                }
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button("End") { onAction(.end, row) }
                .disabled(!Safety.isAllowed(.end, on: row))
            Button("Force Quit") { onAction(.forceQuit, row) }
                .disabled(!Safety.isAllowed(.forceQuit, on: row))
            if row.state == .stopped {
                Button("Resume") { onAction(.resume, row) }
            } else {
                Button("Suspend") { onAction(.suspend, row) }
                    .disabled(!Safety.isAllowed(.suspend, on: row))
            }
            Menu("More") {
                Button("End Process Tree") { onAction(.endTree, row) }
                Menu("Priority") {
                    ForEach(PriorityLevel.allCases) { level in
                        Button(level.label) { onAction(.setPriority(level.nice), row) }
                    }
                }
                if let path = row.path {
                    Button("Show in Finder") {
                        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
                    }
                }
            }
            .disabled(row.isProtected)
            .fixedSize()
        }
        .controlSize(.small)
    }

    private var general: some View {
        let cpu = model.history.processCPU[row.identity]?.values ?? []
        let memory = model.history.processMemory[row.identity]?.values ?? []
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                MiniStat(label: "CPU", value: Format.percent(row.cpu), series: cpu, max: nil)
                MiniStat(label: "Memory", value: Format.bytes(row.memory), series: memory, max: nil, tone: Palette.chart2)
            }
            GlassCard(title: "About") {
                Facts(items: facts)
            }
            if let args = details.arguments, !args.isEmpty {
                GlassCard(title: "Command line") {
                    Text(args.joined(separator: " "))
                        .font(.system(size: 11.5, design: .monospaced))
                        .foregroundStyle(Palette.text)
                        .textSelection(.enabled)
                }
            }
            if row.isProtected {
                Label("Protected: ending it would take macOS or MoonTask down.", systemImage: "lock.shield")
                    .font(.callout)
                    .foregroundStyle(Palette.textMuted)
            }
        }
    }

    private var facts: [(String, String)] {
        var items: [(String, String)] = [
            ("Started", Format.dateTime(Date(timeIntervalSince1970: row.startTime))),
            ("Running for", Format.duration(Date().timeIntervalSince1970 - row.startTime)),
            ("CPU time", Format.cpuTime(row.cpuTime)),
            ("Threads", row.threads.map(String.init) ?? "not readable"),
            ("Disk", "read \(Format.rate(row.diskRead)) · write \(Format.rate(row.diskWrite))"),
            ("Priority", "nice \(row.nice)"),
        ]
        if let parent = row.parentPid {
            let name = model.process(pid: parent)?.name ?? "–"
            items.append(("Parent", "\(name) (\(parent))"))
        }
        items.append(("Path", row.path ?? "not readable"))
        return items
    }

    private var files: some View {
        Group {
            if let files = details.openFiles {
                if files.isEmpty {
                    EmptyNote(symbol: "doc", title: "No open files", text: "This process has no files open right now.")
                } else {
                    GlassCard(title: "\(files.count) open files") {
                        ForEach(files, id: \.self) { path in
                            Text(path)
                                .font(.system(size: 11.5, design: .monospaced))
                                .foregroundStyle(Palette.text)
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .help(path)
                                .textSelection(.enabled)
                        }
                    }
                }
            } else {
                notReadable
            }
        }
    }

    private var network: some View {
        Group {
            if let connections = details.connections {
                if connections.isEmpty {
                    EmptyNote(symbol: "network.slash", title: "No connections", text: "This process has no network sockets open.")
                } else {
                    GlassCard(title: "\(connections.count) sockets") {
                        ForEach(connections) { c in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Chip(text: c.proto.rawValue, tone: c.proto == .tcp ? Palette.lavender : Palette.ownerSystem)
                                    Text(c.state).foregroundStyle(Palette.textMuted)
                                }
                                Text("\(endpoint(c.localAddress, c.localPort)) → \(c.remotePort == 0 ? "–" : endpoint(c.remoteAddress, c.remotePort))")
                                    .font(.system(size: 11.5, design: .monospaced))
                                    .foregroundStyle(Palette.text)
                                    .textSelection(.enabled)
                            }
                            .font(.system(size: 11.5))
                        }
                    }
                }
            } else {
                notReadable
            }
        }
    }

    private var environment: some View {
        Group {
            if let env = details.environment {
                GlassCard(title: "\(env.count) variables") {
                    ForEach(env) { v in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(v.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.accent)
                            Text(v.value)
                                .font(.system(size: 11.5, design: .monospaced))
                                .foregroundStyle(Palette.text)
                                .lineLimit(3)
                                .textSelection(.enabled)
                        }
                    }
                }
            } else {
                notReadable
            }
        }
    }

    private var notReadable: some View {
        EmptyNote(
            symbol: "lock",
            title: "Not readable",
            text: "macOS shows this only for your own processes. Other users' and system processes need administrator rights."
        )
    }
}

func endpoint(_ address: String, _ port: Int) -> String {
    address.contains(":") ? "[\(address)]:\(port)" : "\(address):\(port)"
}

/// The details of an app group in the Apps view.
struct GroupDetailView: View {
    var row: VisibleRow

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                AppIcon(path: row.process.path)
                VStack(alignment: .leading) {
                    Text(row.process.name).font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.text)
                    Text("\(row.members.count) processes").font(.callout).foregroundStyle(Palette.textMuted)
                }
            }
            GlassCard(title: "Together") {
                Facts(items: [
                    ("CPU", Format.percent(row.process.cpu)),
                    ("Memory", Format.bytes(row.process.memory)),
                    ("Threads", "\(row.process.threads ?? 0)"),
                    ("Users", row.process.user ?? "–"),
                ])
            }
            Text("Open the group to act on single processes.")
                .font(.callout)
                .foregroundStyle(Palette.textMuted)
            Spacer()
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(SkyBackground())
    }
}

/// A process' app icon, or a generic one.
struct AppIcon: View {
    var path: String?

    var body: some View {
        Image(nsImage: icon)
            .resizable()
            .frame(width: 36, height: 36)
            .accessibilityHidden(true)
    }

    private var icon: NSImage {
        guard let path else { return NSWorkspace.shared.icon(for: .unixExecutable) }
        // Use the app bundle's icon for executables inside an .app.
        if let range = path.range(of: ".app/", options: .backwards) {
            return NSWorkspace.shared.icon(forFile: String(path[..<range.lowerBound]) + ".app")
        }
        return NSWorkspace.shared.icon(forFile: path)
    }
}

/// A small tile with a value and its sparkline.
struct MiniStat: View {
    var label: String
    var value: String
    var series: [Double]
    var max: Double?
    var tone: Color = Palette.chart1

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(text: label)
            Text(value).font(.figure(15, weight: .semibold)).foregroundStyle(Palette.text)
            Sparkline(values: series, max: max, tone: tone).frame(height: 26)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glass(cornerRadius: 12)
    }
}
