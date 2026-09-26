import Darwin
import Foundation
import MoonTaskCore

/// The launchd jobs of the user's session — macOS' counterpart of Windows
/// services and systemd units — through `launchctl`, the supported way.
public enum LaunchAgents {
    public static func list() -> [LaunchJob] {
        guard let output = run(["list"]) else { return [] }
        return parseList(output)
    }

    /// `launchctl list` prints "PID\tStatus\tLabel" with "-" for none.
    static func parseList(_ output: String) -> [LaunchJob] {
        output.split(separator: "\n").dropFirst().compactMap { line in
            let parts = line.split(separator: "\t", omittingEmptySubsequences: false)
            guard parts.count >= 3 else { return nil }
            let label = String(parts[2]).trimmingCharacters(in: .whitespaces)
            guard !label.isEmpty else { return nil }
            return LaunchJob(
                label: label,
                pid: Int32(parts[0].trimmingCharacters(in: .whitespaces)),
                lastExitStatus: Int32(parts[1].trimmingCharacters(in: .whitespaces))
            )
        }
        .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }

    private static var domain: String { "gui/\(getuid())" }

    /// Starts the job, or restarts it when it runs.
    public static func start(_ job: LaunchJob) -> Bool {
        run(["kickstart", job.isRunning ? "-k" : "", "\(domain)/\(job.label)"].filter { !$0.isEmpty }) != nil
    }

    public static func stop(_ job: LaunchJob) -> Bool {
        run(["kill", "SIGTERM", "\(domain)/\(job.label)"]) != nil
    }

    /// Runs launchctl; nil when it fails.
    private static func run(_ arguments: [String]) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
        } catch {
            return nil
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        return String(decoding: data, as: UTF8.self)
    }
}
