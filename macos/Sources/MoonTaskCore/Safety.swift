import Foundation

/// What MoonTask can do to a process.
public enum ProcessAction: Hashable, Sendable {
    /// SIGTERM: ask it to quit, so it can save its work.
    case end
    /// SIGKILL: stop it at once.
    case forceQuit
    /// End it and everything it started.
    case endTree
    /// SIGSTOP
    case suspend
    /// SIGCONT
    case resume
    /// A new nice value, -20 (highest) … 20 (lowest).
    case setPriority(Int32)

    public var label: String {
        switch self {
        case .end: return "End"
        case .forceQuit: return "Force Quit"
        case .endTree: return "End Process Tree"
        case .suspend: return "Suspend"
        case .resume: return "Resume"
        case .setPriority: return "Change Priority"
        }
    }
}

/// The safety rules, shared by the menus (which grey actions out) and the
/// system layer (which refuses them again right before acting).
public enum Safety {
    /// Processes whose end takes the whole session down.
    public static let protectedNames: Set<String> = [
        "kernel_task", "launchd", "WindowServer", "loginwindow", "logind", "opendirectoryd",
        "configd", "notifyd", "securityd", "syslogd", "UserEventAgent", "coreservicesd",
    ]

    public static func isProtected(pid: Int32, name: String, ownPid: Int32) -> Bool {
        pid <= 1 || pid == ownPid || protectedNames.contains(name)
    }

    public static func isAllowed(_ action: ProcessAction, on row: ProcessRow) -> Bool {
        if row.isProtected { return false }
        if case .setPriority(let nice) = action {
            // Raising priority (a lower nice value) needs root; MoonTask
            // never tries to go below 0 on its own.
            return nice >= -20 && nice <= 20
        }
        return true
    }

    /// Actions that always ask first, whatever the settings say.
    public static func isHighRisk(_ action: ProcessAction, on row: ProcessRow) -> Bool {
        switch action {
        case .endTree:
            return true
        case .end, .forceQuit, .suspend:
            return row.owner != .current
        case .resume, .setPriority:
            return false
        }
    }

    public static func needsConfirmation(
        _ action: ProcessAction, on row: ProcessRow, confirmOwn: Bool
    ) -> Bool {
        if isHighRisk(action, on: row) { return true }
        switch action {
        case .end, .forceQuit, .suspend: return confirmOwn
        default: return false
        }
    }

    /// Human words for what the action will do, for the confirmation.
    public static func consequence(_ action: ProcessAction, on row: ProcessRow, descendants: Int) -> String {
        switch action {
        case .end:
            return "\(row.name) is asked to quit and can save its work first."
        case .forceQuit:
            return "\(row.name) stops at once. Anything it hasn't saved is lost."
        case .endTree:
            let others = descendants == 1 ? "1 process it started" : "\(descendants) processes it started"
            return "\(row.name) and \(others) are asked to quit."
        case .suspend:
            return "\(row.name) is paused until you resume it. Windows of a paused app stop responding."
        case .resume:
            return "\(row.name) continues where it was paused."
        case .setPriority:
            return "\(row.name) gets a different share of the CPU when it's busy."
        }
    }
}
