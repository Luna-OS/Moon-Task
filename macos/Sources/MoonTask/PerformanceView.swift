import Charts
import MoonTaskCore
import SwiftUI

struct PerformanceView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let s = model.snapshot
        let h = model.history
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                GlassCard(title: "CPU") {
                    AreaChart(
                        series: [
                            ChartSeries(label: "User", values: h.cpuUser.values, color: Palette.chart1),
                            ChartSeries(label: "System", values: h.cpuSystem.values, color: Palette.chart2),
                        ],
                        stacked: true, max: 100, format: { Format.percent($0, digits: 0) }
                    )
                    .frame(height: 170)
                    Facts(items: [
                        ("Total", Format.percent(s.cpu.total)),
                        ("User", Format.percent(s.cpu.user)),
                        ("System", Format.percent(s.cpu.system)),
                        ("Chip", model.systemInfo.chip),
                    ])
                }

                GlassCard(title: "Cores") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 10)], spacing: 10) {
                        ForEach(Array(h.perCore.enumerated()), id: \.offset) { index, series in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("Core \(index + 1)").foregroundStyle(Palette.textMuted)
                                    Spacer()
                                    Text(Format.percent(series.last ?? 0, digits: 0)).foregroundStyle(Palette.text)
                                }
                                .font(.figure(11, weight: .regular))
                                Sparkline(values: series.values, max: 100)
                                    .frame(height: 30)
                            }
                            .padding(8)
                            .inset()
                        }
                    }
                }

                HStack(alignment: .top, spacing: 16) {
                    GlassCard(title: "Memory") {
                        AreaChart(
                            series: [ChartSeries(label: "Used", values: h.memory.values, color: Palette.chart1)],
                            stacked: false, max: Double(s.memory.total), format: { Format.bytes($0) }
                        )
                        .frame(height: 150)
                        Facts(items: [
                            ("Used", "\(Format.bytes(s.memory.used)) of \(Format.bytes(s.memory.total, precision: 0))"),
                            ("App memory", Format.bytes(s.memory.app)),
                            ("Wired", Format.bytes(s.memory.wired)),
                            ("Compressed", Format.bytes(s.memory.compressed)),
                            ("Cached files", Format.bytes(s.memory.cached)),
                            ("Swap", s.memory.swapTotal > 0
                                ? "\(Format.bytes(s.memory.swapUsed)) of \(Format.bytes(s.memory.swapTotal))"
                                : "not used"),
                        ])
                    }
                    ForEach(s.gpus) { gpu in
                        GlassCard(title: gpu.name) {
                            if gpu.utilization != nil {
                                AreaChart(
                                    series: [ChartSeries(label: "GPU", values: h.gpu[gpu.id]?.values ?? [], color: Palette.chart1)],
                                    stacked: false, max: 100, format: { Format.percent($0, digits: 0) }
                                )
                                .frame(height: 150)
                            } else {
                                Text("This GPU's driver doesn't report its load.")
                                    .foregroundStyle(Palette.textMuted)
                            }
                            Facts(items: gpuFacts(gpu))
                        }
                    }
                }

                HStack(alignment: .top, spacing: 16) {
                    GlassCard(title: "Disk") {
                        AreaChart(
                            series: [
                                ChartSeries(label: "Read", values: h.diskRead.values, color: Palette.chart1),
                                ChartSeries(label: "Write", values: h.diskWrite.values, color: Palette.chart2),
                            ],
                            stacked: false, max: nil, format: { Format.rate($0) }
                        )
                        .frame(height: 150)
                    }
                    GlassCard(title: "Network") {
                        AreaChart(
                            series: [
                                ChartSeries(label: "Received", values: h.networkIn.values, color: Palette.chart1),
                                ChartSeries(label: "Sent", values: h.networkOut.values, color: Palette.chart2),
                            ],
                            stacked: false, max: nil, format: { Format.rate($0) }
                        )
                        .frame(height: 150)
                    }
                }

                GlassCard(title: "Temperature") {
                    HStack(spacing: 10) {
                        Image(systemName: s.thermal == .nominal ? "thermometer.low" : "thermometer.high")
                            .foregroundStyle(s.thermal == .nominal ? Palette.success : Palette.warning)
                        Text(s.thermal.label).foregroundStyle(Palette.text)
                        Spacer()
                        Text("macOS reports how hot the Mac runs as a level, not in degrees.")
                            .font(.caption)
                            .foregroundStyle(Palette.textMuted)
                    }
                }
            }
            .padding(20)
        }
    }

    private func gpuFacts(_ gpu: GPUStats) -> [(String, String)] {
        var items: [(String, String)] = [("Load", gpu.utilization.map { Format.percent($0) } ?? "not reported")]
        if let used = gpu.memoryUsed { items.append(("Memory in use", Format.bytes(used))) }
        if let cores = gpu.cores { items.append(("Cores", "\(cores)")) }
        return items
    }
}

struct ChartSeries: Identifiable {
    var id: String { label }
    var label: String
    var values: [Double]
    var color: Color
}

/// A calm area chart over the last two minutes, with hover read-outs.
struct AreaChart: View {
    var series: [ChartSeries]
    var stacked: Bool
    var max: Double?
    var format: (Double) -> String

    @State private var hover: Int?

    private struct Point: Identifiable {
        var id: String { "\(series)-\(index)" }
        var series: String
        var index: Int
        var value: Double
    }

    var body: some View {
        let length = series.map(\.values.count).max() ?? 0
        let points = series.flatMap { s in
            s.values.enumerated().map { Point(series: s.label, index: length - s.values.count + $0.offset, value: $0.element) }
        }
        Chart {
            ForEach(points) { p in
                AreaMark(
                    x: .value("Time", p.index),
                    y: .value("Value", p.value),
                    stacking: stacked ? .standard : .unstacked
                )
                .foregroundStyle(by: .value("Series", p.series))
                .opacity(0.35)
                .interpolationMethod(.monotone)
                // Lines don't stack, so stacked charts show the areas only.
                if !stacked {
                    LineMark(x: .value("Time", p.index), y: .value("Value", p.value))
                        .foregroundStyle(by: .value("Series", p.series))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 1.5))
                }
            }
            if let hover {
                RuleMark(x: .value("Time", hover))
                    .foregroundStyle(Palette.borderStrong)
            }
        }
        .chartForegroundStyleScale(
            domain: series.map(\.label),
            range: series.map(\.color)
        )
        .chartXAxis(.hidden)
        .chartXScale(domain: 0...Swift.max(1, length - 1))
        .chartYScale(domain: 0...Swift.max(max ?? (points.map(\.value).max() ?? 0) * 1.15, 1e-9))
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine().foregroundStyle(Palette.grid)
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(format(v)).font(.system(size: 9.5)).foregroundStyle(Palette.textFaint)
                    }
                }
            }
        }
        .chartLegend(series.count > 1 ? .visible : .hidden)
        .chartOverlay { proxy in
            Rectangle().fill(.clear).contentShape(Rectangle())
                .onContinuousHover { phase in
                    switch phase {
                    case .active(let location):
                        hover = proxy.value(atX: location.x, as: Int.self)
                    case .ended:
                        hover = nil
                    }
                }
        }
        .overlay(alignment: .topTrailing) {
            if let hover {
                VStack(alignment: .trailing, spacing: 2) {
                    ForEach(series) { s in
                        let i = hover - (length - s.values.count)
                        if i >= 0 && i < s.values.count {
                            Text("\(s.label): \(format(s.values[i]))")
                        }
                    }
                }
                .font(.figure(10.5, weight: .regular))
                .foregroundStyle(Palette.text)
                .padding(6)
                .inset(cornerRadius: 6)
            }
        }
    }
}
