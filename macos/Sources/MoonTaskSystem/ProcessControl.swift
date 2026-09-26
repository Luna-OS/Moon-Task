import CDarwin
import Darwin
import Foundation
import MoonTaskCore

public enum ControlError: LocalizedError, Equatable {
    case protected(String)
    case gone(String)
    case permission(String)
    case failed(String, Int32)

    public var errorDescription: String? {
        switch self {
        case .protected(let name):
            return "\(name) is protected: ending it would take macOS or MoonTask down."
        case .gone(let name):
            return "\(name) has already ended."
        case .permission(let name):
            return "macOS doesn't allow MoonTask to do that to \(name). Processes of other users and the system need administrator rights."
        case .failed(let name, let code):
            return "That didn't work for \(name): \(String(cString: strerror(code)))."
        }
    }
}

/// Acts on processes. Every action names the process by PID *and* start
/// time and checks both right before it runs, so a PID macOS has meanwhile
/// given to another process is never touched.
public enum ProcessControl {
    public static func perform(_ action: ProcessAction, on row: ProcessRow, tree: [ProcessRow] = []) throws {
        guard Safety.isAllowed(action, on: row) else { throw ControlError.protected(row.name) }
        switch action {
        case .end: try signal(SIGTERM, row)
        case .forceQuit: try signal(SIGKILL, row)
        case .suspend: try signal(SIGSTOP, row)
        case .resume: try signal(SIGCONT, row)
        case .setPriority(let nice):
            try verify(row)
            errno = 0
            if setpriority(PRIO_PROCESS, id_t(row.pid), nice) != 0 { throw error(for: row) }
        case .endTree:
            // Children first, so a parent can't restart what just ended.
            var firstError: Error?
            for member in descendantsFirst(tree, of: row.pid) {
                guard Safety.isAllowed(.end, on: member) else { continue }
                do { try signal(SIGTERM, member) } catch ControlError.gone(_) {
                } catch {
                    if firstError == nil { firstError = error }
                }
            }
            if let firstError { throw firstError }
        }
    }

    private static func signal(_ sig: Int32, _ row: ProcessRow) throws {
        try verify(row)
        if kill(row.pid, sig) != 0 { throw error(for: row) }
    }

    /// Is `row` still the process it was when it was listed?
    static func verify(_ row: ProcessRow) throws {
        var kinfo = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, row.pid]
        let ok = sysctl(&mib, 4, &kinfo, &size, nil, 0) == 0 && size > 0
        guard ok, kinfo.kp_proc.p_pid == row.pid else { throw ControlError.gone(row.name) }
        // p_starttime is a C macro for this field.
        let start = kinfo.kp_proc.p_un.__p_starttime
        let startTime = Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000
        if abs(startTime - row.startTime) > 0.001 { throw ControlError.gone(row.name) }
    }

    private static func error(for row: ProcessRow) -> ControlError {
        switch errno {
        case ESRCH: return .gone(row.name)
        case EPERM, EACCES: return .permission(row.name)
        default: return .failed(row.name, errno)
        }
    }

    /// Shows the executable in Finder.
    public static func revealInFinder(_ path: String) -> URL {
        URL(fileURLWithPath: path)
    }
}
