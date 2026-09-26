import MoonTaskCore
import SwiftUI

struct OverviewView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let s = model.snapshot
        let h = model.history
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 14)], spacing: 14) {
                    StatTile(
                        label: "CPU",
                        value: Format.percent(s.cpu.total),
                        detail: "\(model.systemInfo.cores) cores · user \(Format.percent(s.cpu.user, digits: 0)) · system \(Format.percent(s.cpu.system, digits: 0))",
                        fraction: s.cpu.total / 100,
                        series: h.cpu.values,
                        max: 100
                    )
                    StatTile(
                        label: "Memory",
                        value: Format.bytes(s.memory.used),
                        detail: "of \(Format.bytes(s.memory.total, precision: 0)) · \(Format.bytes(s.memory.cached)) cached",
                        fraction: s.memory.fraction,
                        series: h.memory.values,
                        max: Double(s.memory.total)
                    )
                    StatTile(
                        label: "Disk",
                        value: Format.rate(s.diskRead + s.diskWrite),
                        detail: "read \(Format.rate(s.diskRead)) · write \(Format.rate(s.diskWrite))",
                        fraction: min(1, (s.diskRead + s.diskWrite) / 200_000_000),
                        series: zip(h.diskRead.values, h.diskWrite.values).map { $0 + $1 },
                        max: nil
                    )
                    StatTile(
                        label: "Network",
                        value: Format.rate(s.networkIn + s.networkOut),
                        detail: "↓ \(Format.rate(s.networkIn)) · ↑ \(Format.rate(s.networkOut))",
                        fraction: min(1, (s.networkIn + s.networkOut) / 12_500_000),
                        series: zip(h.networkIn.values, h.networkOut.values).map { $0 + $1 },
                        max: nil,
                        tone: Palette.chart2
                    )
                    if let gpu = s.primaryGPU {
                        StatTile(
                            label: "GPU",
                            value: gpu.utilization.map { Format.percent($0) } ?? "–",
                            detail: [gpu.name, gpu.cores.map { "\($0) cores" }]
                                .compactMap { $0 }.joined(separator: " · "),
                            fraction: (gpu.utilization ?? 0) / 100,
                            series: h.gpu[gpu.id]?.values ?? [],
                            max: 100
                        )
                    }
                }

                HStack(alignment: .top, spacing: 14) {
                    GlassCard(title: "Busiest right now") {
                        TopList(rows: Array(s.processes.sorted { $0.cpu > $1.cpu }.prefix(6))) {
                            Format.percent($0.cpu)
                        }
                    }
                    GlassCard(title: "Largest in memory") {
                        TopList(rows: Array(s.processes.sorted { $0.memory > $1.memory }.prefix(6))) {
                            Format.bytes($0.memory)
                        }
                    }
                    GlassCard(title: "This Mac") {
                        Facts(items: machineFacts(s))
                    }
                }

                HStack(alignment: .top, spacing: 14) {
                    GlassCard(title: "Storage") {
                        if s.volumes.isEmpty {
                            Text("No volumes found.").foregroundStyle(Palette.textMuted)
                        }
                        ForEach(s.volumes) { v in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack {
                                    Image(systemName: v.isInternal ? "internaldrive" : "externaldrive")
                                        .foregroundStyle(Palette.lavender)
                                    Text(v.name).foregroundStyle(Palette.text)
                                    Spacer()
                                    Text("\(Format.bytes(v.available)) free of \(Format.bytes(v.total, precision: 0))")
                                        .font(.figure(11.5, weight: .regular))
                                        .foregroundStyle(Palette.textMuted)
                                }
                                .font(.system(size: 12.5))
                                Meter(fraction: v.fraction, tone: v.fraction > 0.9 ? Palette.warning : Palette.lavender)
                            }
                        }
                    }
                    GlassCard(title: "Coming and going") {
                        if model.events.isEmpty {
                            Text("Processes that start or end show up here.")
                                .font(.callout)
                                .foregroundStyle(Palette.textMuted)
                        }
                        ForEach(model.events.prefix(8)) { e in
                            HStack(spacing: 8) {
                                Image(systemName: e.kind == .started ? "arrow.up.right.circle.fill" : "xmark.circle")
                                    .foregroundStyle(e.kind == .started ? Palette.success : Palette.textFaint)
                                Text(e.name).foregroundStyle(Palette.text).lineLimit(1)
                                Text(String(e.pid)).font(.figure(11, weight: .regular)).foregroundStyle(Palette.textFaint)
                                Spacer()
                                Text(e.time, style: .time)
                                    .font(.figure(11, weight: .regular))
                                    .foregroundStyle(Palette.textMuted)
                            }
                            .font(.system(size: 12.5))
                        }
                    }
                }
            }
            .padding(20)
        }
    }

    private func machineFacts(_ s: Snapshot) -> [(String, String)] {
        let info = model.systemInfo
        var facts: [(String, String)] = [
            ("Name", info.hostName),
            ("System", info.osVersion),
            ("Chip", info.chip.isEmpty ? info.model : info.chip),
        ]
        if let p = info.performanceCores, let e = info.efficiencyCores {
            facts.append(("Cores", "\(info.cores) (\(p) performance, \(e) efficiency)"))
        } else {
            facts.append(("Cores", "\(info.cores)"))
        }
        facts.append(("Memory", Format.bytes(info.memory, precision: 0)))
        facts.append(("Up for", Format.duration(s.uptime)))
        facts.append(("Processes", Format.count(s.processes.count)))
        facts.append(("Temperature", s.thermal.label))
        return facts
    }
}

/// A short ranked list of processes with one measure.
struct TopList: View {
    var rows: [ProcessRow]
    var value: (ProcessRow) -> String

    init(rows: [ProcessRow], value: @escaping (ProcessRow) -> String) {
        self.rows = rows
        self.value = value
    }

    var body: some View {
        VStack(spacing: 6) {
            ForEach(rows) { p in
                HStack(spacing: 8) {
                    OwnerDot(owner: p.owner)
                    Text(p.name).foregroundStyle(Palette.text).lineLimit(1)
                    Spacer()
                    Text(value(p))
                        .font(.figure(12))
                        .foregroundStyle(Palette.text)
                }
                .font(.system(size: 12.5))
            }
        }
    }
}
