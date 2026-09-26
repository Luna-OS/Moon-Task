import AppKit
import MoonTaskCore
import SwiftUI

@main
struct MoonTaskApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = AppModel()
    @AppStorage(SettingKey.theme) private var theme = ThemeChoice.dark.rawValue

    var body: some Scene {
        Window("MoonTask", id: "main") {
            ContentView()
                .environment(model)
                .preferredColorScheme(ThemeChoice(rawValue: theme)?.colorScheme)
                .frame(minWidth: 980, minHeight: 620)
                .onAppear { model.start() }
        }
        .defaultSize(width: 1280, height: 800)
        .commands { MoonTaskCommands(model: model) }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Also a regular app when started as a bare executable (swift run).
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        UserDefaults.standard.register(defaults: [
            SettingKey.refreshInterval: 1.0,
            SettingKey.showKernel: true,
            SettingKey.confirmOwn: true,
        ])
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

struct MoonTaskCommands: Commands {
    var model: AppModel

    var body: some Commands {
        CommandGroup(before: .sidebar) {
            ForEach(Array(AppSection.allCases.enumerated()), id: \.element) { index, section in
                Button(section.title) { model.section = section }
                    .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
            }
            Divider()
        }
        CommandMenu("Monitor") {
            Button(model.paused ? "Resume Updates" : "Pause Updates") { model.paused.toggle() }
                .keyboardShortcut("p", modifiers: [.command, .shift])
            Button("Refresh Now") { Task { await model.refresh(force: true) } }
                .keyboardShortcut("r", modifiers: .command)
        }
    }
}
