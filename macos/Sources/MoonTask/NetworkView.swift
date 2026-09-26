import MoonTaskCore
import SwiftUI

struct NetworkView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var listeningOnly = false
    @State private var sortOrder = [KeyPathComparator(\Connection.processName)]

    var body: some View {
        let rows = model.connections
            .filter { !listeningOnly || $0.isListening }
            .filter { matches($0) }
            .sorted(using: sortOrder)

        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Chip(text: "\(model.connections.filter { $0.proto == .tcp }.count) TCP")
                Chip(text: "\(model.connections.filter { $0.proto == .udp }.count) UDP", tone: Palette.ownerSystem)
                Chip(text: "\(model.connections.filter(\.isListening).count) listening", tone: Palette.success)
                Spacer()
                Toggle("Listening only", isOn: $listeningOnly)
                    .toggleStyle(.switch)
                    .controlSize(.small)
            }
            if model.connections.isEmpty {
                GlassCard {
                    EmptyNote(
                        symbol: "network",
                        title: "Looking for connections …",
                        text: "MoonTask lists the sockets of your own processes. The system's and other users' connections need administrator rights on macOS."
                    )
                }
            } else {
                Table(rows, sortOrder: $sortOrder) {
                    TableColumn("Process", value: \Connection.processName) { c in
                        HStack(spacing: 6) {
                            Text(c.processName).foregroundStyle(Palette.text)
                            Text(String(c.pid)).font(.figure(11, weight: .regular)).foregroundStyle(Palette.textFaint)
                        }
                    }
                    .width(min: 140, ideal: 200)
                    TableColumn("Protocol", value: \Connection.proto.rawValue) { c in
                        Chip(text: c.proto.rawValue + (c.isIPv6 ? "6" : ""), tone: c.proto == .tcp ? Palette.lavender : Palette.ownerSystem)
                    }
                    .width(70)
                    TableColumn("Local", value: \Connection.localPort) { c in
                        Text(endpoint(c.localAddress, c.localPort))
                            .font(.system(size: 11.5, design: .monospaced))
                            .textSelection(.enabled)
                    }
                    .width(min: 140, ideal: 200)
                    TableColumn("Remote", value: \Connection.remoteAddress) { c in
                        Text(c.remotePort == 0 ? "–" : endpoint(c.remoteAddress, c.remotePort))
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundStyle(c.remotePort == 0 ? Palette.textFaint : Palette.text)
                            .textSelection(.enabled)
                    }
                    .width(min: 140, ideal: 220)
                    TableColumn("State", value: \Connection.state) { c in
                        Text(c.state).foregroundStyle(c.isListening ? Palette.success : Palette.textMuted)
                    }
                    .width(min: 80, ideal: 100)
                }
                .scrollContentBackground(.hidden)
                .alternatingRowBackgrounds(.disabled)
                .glass(cornerRadius: 14)
            }
        }
        .padding(16)
        .searchable(text: $query, placement: .toolbar, prompt: "Process, address or port")
        .task { await model.refreshConnections() }
    }

    private func matches(_ c: Connection) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return true }
        return c.processName.lowercased().contains(q)
            || c.localAddress.contains(q) || c.remoteAddress.contains(q)
            || String(c.localPort) == q || String(c.remotePort) == q || String(c.pid) == q
    }
}
