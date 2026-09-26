import MoonTaskCore
import SwiftUI

struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 260)
        } detail: {
            ZStack {
                SkyBackground()
                detail
            }
            .navigationTitle(model.section.title)
            .navigationSubtitle(model.section.subtitle)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        model.paused.toggle()
                    } label: {
                        Label(model.paused ? "Resume" : "Pause", systemImage: model.paused ? "play.fill" : "pause.fill")
                    }
                    .help(model.paused ? "Resume live updates (⇧⌘P)" : "Pause live updates (⇧⌘P)")
                }
            }
        }
        .alert(
            "MoonTask",
            isPresented: Binding(get: { model.message != nil }, set: { if !$0 { model.message = nil } }),
            actions: { Button("OK") { model.message = nil } },
            message: { Text(model.message ?? "") }
        )
    }

    @ViewBuilder private var detail: some View {
        if !model.hasSnapshot {
            ProgressView("Looking at your Mac …")
                .foregroundStyle(Palette.textMuted)
        } else {
            switch model.section {
            case .overview: OverviewView()
            case .processes: ProcessesView()
            case .performance: PerformanceView()
            case .network: NetworkView()
            case .services: ServicesView()
            case .settings: SettingsView()
            }
        }
    }
}

struct Sidebar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        List(selection: Binding(get: { model.section }, set: { if let s = $0 { model.section = s } })) {
            SwiftUI.Section {
                ForEach(AppSection.allCases) { section in
                    Label(section.title, systemImage: section.symbol)
                        .tag(section)
                }
            } header: {
                HStack(spacing: 8) {
                    MoonPhase(fraction: 0.35, size: 22)
                    Text("MoonTask")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(Palette.text)
                }
                .padding(.bottom, 6)
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) { gauges }
    }

    private var gauges: some View {
        let s = model.snapshot
        return VStack(spacing: 6) {
            SideGauge(label: "CPU", value: Format.percent(s.cpu.total, digits: 0), fraction: s.cpu.total / 100)
            SideGauge(
                label: "Memory",
                value: "\(Format.bytes(s.memory.used)) / \(Format.bytes(s.memory.total, precision: 0))",
                fraction: s.memory.fraction
            )
            if let gpu = s.primaryGPU, let load = gpu.utilization {
                SideGauge(label: "GPU", value: Format.percent(load, digits: 0), fraction: load / 100)
            }
            if model.paused {
                Chip(text: "Paused", tone: Palette.warning)
            }
        }
        .padding(10)
    }
}
