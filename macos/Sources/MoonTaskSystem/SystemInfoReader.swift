import CDarwin
import Foundation
import MoonTaskCore

public enum SystemInfoReader {
    public static func read() -> SystemInfo {
        let info = ProcessInfo.processInfo
        let perf = mt_sysctl_int("hw.perflevel0.logicalcpu")
        let eff = mt_sysctl_int("hw.perflevel1.logicalcpu")
        let memory = mt_sysctl_int("hw.memsize")
        return SystemInfo(
            hostName: Host.current().localizedName ?? info.hostName,
            osVersion: "macOS " + info.operatingSystemVersionString
                .replacingOccurrences(of: "Version ", with: ""),
            model: sysctlString("hw.model"),
            chip: sysctlString("machdep.cpu.brand_string"),
            cores: info.activeProcessorCount,
            performanceCores: perf > 0 ? Int(perf) : nil,
            efficiencyCores: eff > 0 ? Int(eff) : nil,
            memory: memory > 0 ? UInt64(memory) : 0,
            bootTime: Date(timeIntervalSinceNow: -info.systemUptime)
        )
    }

    static func sysctlString(_ name: String) -> String {
        var buffer = [CChar](repeating: 0, count: 256)
        _ = buffer.withUnsafeMutableBufferPointer {
            mt_sysctl_string(name, $0.baseAddress, Int32($0.count))
        }
        return String(cString: buffer)
    }
}
