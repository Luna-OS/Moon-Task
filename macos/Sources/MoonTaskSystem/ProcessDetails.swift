import CDarwin
import Darwin
import Foundation
import MoonTaskCore

public struct EnvironmentVariable: Hashable, Sendable, Identifiable {
    public var id: String { name }
    public var name: String
    public var value: String
}

/// What the detail panel shows beyond the table's columns. Most of it is
/// only readable for the user's own processes (or as root).
public struct ProcessDetails: Sendable {
    public var arguments: [String]?
    public var environment: [EnvironmentVariable]?
    public var openFiles: [String]?
    public var connections: [Connection]?

    public init(
        arguments: [String]? = nil, environment: [EnvironmentVariable]? = nil,
        openFiles: [String]? = nil, connections: [Connection]? = nil
    ) {
        self.arguments = arguments
        self.environment = environment
        self.openFiles = openFiles
        self.connections = connections
    }
}

public enum ProcessInspector {
    public static func details(of row: ProcessRow) -> ProcessDetails {
        let (arguments, environment) = argumentsAndEnvironment(of: row.pid)
        return ProcessDetails(
            arguments: arguments,
            environment: environment,
            openFiles: openFiles(of: row.pid),
            connections: connections(of: row.pid, name: row.name)
        )
    }

    /// Parses the KERN_PROCARGS2 block: argc, the executable path, padding,
    /// the arguments, then the environment.
    static func argumentsAndEnvironment(of pid: Int32) -> ([String]?, [EnvironmentVariable]?) {
        let size = max(4096, Int(mt_sysctl_int("kern.argmax")))
        var buffer = [CChar](repeating: 0, count: size)
        let len = Int(buffer.withUnsafeMutableBufferPointer {
            mt_process_args(pid, $0.baseAddress, Int32($0.count))
        })
        guard len > MemoryLayout<Int32>.size else { return (nil, nil) }
        let bytes = buffer.prefix(len).map { UInt8(bitPattern: $0) }
        return parseProcArgs(bytes)
    }

    static func parseProcArgs(_ bytes: [UInt8]) -> ([String]?, [EnvironmentVariable]?) {
        guard bytes.count > 4 else { return (nil, nil) }
        let argc = Int(bytes.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) })
        var i = 4
        // Skip the executable path and the NULs after it.
        while i < bytes.count && bytes[i] != 0 { i += 1 }
        while i < bytes.count && bytes[i] == 0 { i += 1 }

        var strings: [String] = []
        var start = i
        while i < bytes.count {
            if bytes[i] == 0 {
                if i == start { break }  // two NULs: the end
                strings.append(String(decoding: bytes[start..<i], as: UTF8.self))
                start = i + 1
            }
            i += 1
        }
        let args = Array(strings.prefix(argc))
        let env: [EnvironmentVariable] = strings.dropFirst(argc).compactMap { entry in
            guard let eq = entry.firstIndex(of: "=") else { return nil }
            return EnvironmentVariable(
                name: String(entry[..<eq]), value: String(entry[entry.index(after: eq)...])
            )
        }
        return (args, env)
    }

    public static func openFiles(of pid: Int32) -> [String]? {
        var buffer = [CChar](repeating: 0, count: 256 * 1024)
        let len = Int(buffer.withUnsafeMutableBufferPointer {
            mt_open_files(pid, $0.baseAddress, Int32($0.count))
        })
        guard len >= 0 else { return nil }
        var files: [String] = []
        var start = 0
        for i in 0..<len where buffer[i] == 0 {
            let bytes = buffer[start..<i].map { UInt8(bitPattern: $0) }
            files.append(String(decoding: bytes, as: UTF8.self))
            start = i + 1
        }
        return Array(Set(files)).sorted()
    }

    public static func connections(of pid: Int32, name: String) -> [Connection]? {
        var sockets = [mt_socket](repeating: mt_socket(), count: 1024)
        let n = Int(sockets.withUnsafeMutableBufferPointer {
            mt_sockets(pid, $0.baseAddress, Int32($0.count))
        })
        guard n >= 0 else { return nil }
        return (0..<n).map { i in
            let s = sockets[i]
            let proto: TransportProtocol = s.protocol == 1 ? .tcp : .udp
            return Connection(
                pid: pid,
                processName: name,
                fd: s.fd,
                proto: proto,
                isIPv6: s.family == 6,
                localAddress: cString(s.local_address),
                localPort: Int(s.local_port),
                remoteAddress: cString(s.remote_address),
                remotePort: Int(s.remote_port),
                state: proto == .tcp ? tcpState(s.tcp_state) : (s.remote_port == 0 ? "Listen" : "")
            )
        }
    }

    /// Every connection MoonTask can see: all of the user's processes (and
    /// all processes when it runs as root).
    public static func allConnections(_ processes: [ProcessRow]) -> [Connection] {
        var out: [Connection] = []
        for p in processes where p.pid > 0 {
            if let c = connections(of: p.pid, name: p.name) { out.append(contentsOf: c) }
        }
        return out
    }

    static func tcpState(_ state: Int32) -> String {
        switch state {
        case 0: return "Closed"
        case 1: return "Listen"
        case 2: return "SYN sent"
        case 3: return "SYN received"
        case 4: return "Established"
        case 5: return "Close wait"
        case 6: return "FIN wait 1"
        case 7: return "Closing"
        case 8: return "Last ACK"
        case 9: return "FIN wait 2"
        case 10: return "Time wait"
        default: return "Unknown"
        }
    }
}
