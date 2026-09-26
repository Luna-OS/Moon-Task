import MoonTaskCore
import SwiftUI

struct SettingsView: View {
    @AppStorage(SettingKey.theme) private var theme = ThemeChoice.dark.rawValue
    @AppStorage(SettingKey.refreshInterval) private var interval = 1.0
    @AppStorage(SettingKey.showKernel) private var showKernel = true
    @AppStorage(SettingKey.confirmOwn) private var confirmOwn = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                GlassCard(title: "Look") {
                    Picker("Theme", selection: $theme) {
                        ForEach(ThemeChoice.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 360)
                }
                GlassCard(title: "Updates") {
                    Picker("Refresh every", selection: $interval) {
                        Text("0.5 s").tag(0.5)
                        Text("1 s").tag(1.0)
                        Text("2 s").tag(2.0)
                        Text("5 s").tag(5.0)
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 360)
                    Text("MoonTask measures once per interval. Longer intervals use even less energy.")
                        .font(.callout)
                        .foregroundStyle(Palette.textMuted)
                }
                GlassCard(title: "Processes") {
                    Toggle("Show kernel_task", isOn: $showKernel)
                    Toggle("Ask before ending my own processes", isOn: $confirmOwn)
                    Text("Ending another user's or a system process, and ending a whole tree, always asks first. The kernel, launchd, WindowServer, loginwindow and MoonTask itself can't be ended at all.")
                        .font(.callout)
                        .foregroundStyle(Palette.textMuted)
                }
                GlassCard(title: "About") {
                    Facts(items: [
                        ("Version", Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"),
                        ("Source", "github.com/Luna-OS/Moon-Task"),
                        ("License", "MIT"),
                    ])
                    Text("No telemetry and no network access of its own. Everything MoonTask shows stays on your Mac.")
                        .font(.callout)
                        .foregroundStyle(Palette.textMuted)
                }
            }
            .padding(20)
            .frame(maxWidth: 720, alignment: .leading)
        }
    }
}
