import Foundation

/// Who a process belongs to, which decides its color and how careful
/// MoonTask is with it.
public enum Owner: String, Sendable, CaseIterable {
    /// The signed-in user.
    case current
    /// root and the system's service accounts (_windowserver, _mdnsresponder …).
    case system
    /// Another person's account.
    case other
    /// kernel_task.
    case kernel

    public var label: String {
        switch self {
        case .current: return "You"
        case .system: return "System"
        case .other: return "Other user"
        case .kernel: return "Kernel"
        }
    }
}

public enum ProcessState: String, Sendable {
    case running, sleeping, stopped, zombie, idle, unknown

    public var label: String {
        switch self {
        case .running: return "Running"
        case .sleeping: return "Sleeping"
        case .stopped: return "Suspended"
        case .zombie: return "Zombie"
        case .idle: return "Starting"
        case .unknown: return "Unknown"
        }
    }

    /// From the BSD `p_stat` value.
    public init(bsdState: Int32) {
        switch bsdState {
        case 1: self = .idle
        case 2: self = .running
        case 3: self = .sleeping
        case 4: self = .stopped
        case 5: self = .zombie
        default: self = .unknown
        }
    }
}

public struct ProcessRow: Identifiable, Hashable, Sendable {
    public var id: Int32 { pid }
    public var pid: Int32
    public var parentPid: Int32?
    public var name: String
    public var user: String?
    public var uid: UInt32
    public var owner: Owner
    public var state: ProcessState
    /// Share of the whole machine, 0–100, so the column adds up to the total.
    public var cpu: Double
    /// Physical footprint in bytes (Activity Monitor's "Memory").
    public var memory: UInt64
    public var threads: Int?
    /// Bytes per second.
    public var diskRead: Double
    public var diskWrite: Double
    public var nice: Int32
    /// Seconds since 1970.
    public var startTime: Double
    /// Total CPU time used, seconds.
    public var cpuTime: Double
    public var path: String?
    /// Ending it would take the system (or MoonTask) down.
    public var isProtected: Bool

    public init(
        pid: Int32, parentPid: Int32?, name: String, user: String?, uid: UInt32, owner: Owner,
        state: ProcessState, cpu: Double = 0, memory: UInt64 = 0, threads: Int? = nil,
        diskRead: Double = 0, diskWrite: Double = 0, nice: Int32 = 0, startTime: Double = 0,
        cpuTime: Double = 0, path: String? = nil, isProtected: Bool = false
    ) {
        self.pid = pid
        self.parentPid = parentPid
        self.name = name
        self.user = user
        self.uid = uid
        self.owner = owner
        self.state = state
        self.cpu = cpu
        self.memory = memory
        self.threads = threads
        self.diskRead = diskRead
        self.diskWrite = diskWrite
        self.nice = nice
        self.startTime = startTime
        self.cpuTime = cpuTime
        self.path = path
        self.isProtected = isProtected
    }

    /// Identifies this process instance: a PID with its start time, so a
    /// PID the system has since handed to another process never matches.
    public var identity: ProcessIdentity { ProcessIdentity(pid: pid, startTime: startTime) }
}

public struct ProcessIdentity: Hashable, Sendable {
    public var pid: Int32
    public var startTime: Double

    public init(pid: Int32, startTime: Double) {
        self.pid = pid
        self.startTime = startTime
    }
}

public struct CPUStats: Sendable {
    /// 0–100
    public var total: Double
    public var perCore: [Double]
    public var user: Double
    public var system: Double

    public init(total: Double = 0, perCore: [Double] = [], user: Double = 0, system: Double = 0) {
        self.total = total
        self.perCore = perCore
        self.user = user
        self.system = system
    }
}

public struct MemoryStats: Sendable {
    public var total: UInt64
    public var app: UInt64
    public var wired: UInt64
    public var compressed: UInt64
    public var cached: UInt64
    public var free: UInt64
    public var swapTotal: UInt64
    public var swapUsed: UInt64

    public init(
        total: UInt64 = 0, app: UInt64 = 0, wired: UInt64 = 0, compressed: UInt64 = 0,
        cached: UInt64 = 0, free: UInt64 = 0, swapTotal: UInt64 = 0, swapUsed: UInt64 = 0
    ) {
        self.total = total
        self.app = app
        self.wired = wired
        self.compressed = compressed
        self.cached = cached
        self.free = free
        self.swapTotal = swapTotal
        self.swapUsed = swapUsed
    }

    /// "Memory Used" as Activity Monitor counts it: app + wired + compressed.
    public var used: UInt64 { app + wired + compressed }
    public var fraction: Double { total > 0 ? min(1, Double(used) / Double(total)) : 0 }
}

public struct GPUStats: Identifiable, Sendable {
    public var id: Int
    public var name: String
    /// 0–100, nil when the driver doesn't report it.
    public var utilization: Double?
    public var memoryUsed: UInt64?
    public var cores: Int?

    public init(id: Int, name: String, utilization: Double?, memoryUsed: UInt64?, cores: Int?) {
        self.id = id
        self.name = name
        self.utilization = utilization
        self.memoryUsed = memoryUsed
        self.cores = cores
    }
}

public struct Volume: Identifiable, Sendable {
    public var id: String { mountPoint }
    public var name: String
    public var mountPoint: String
    public var total: UInt64
    public var available: UInt64
    public var isInternal: Bool

    public init(name: String, mountPoint: String, total: UInt64, available: UInt64, isInternal: Bool) {
        self.name = name
        self.mountPoint = mountPoint
        self.total = total
        self.available = available
        self.isInternal = isInternal
    }

    public var used: UInt64 { total > available ? total - available : 0 }
    public var fraction: Double { total > 0 ? Double(used) / Double(total) : 0 }
}

public enum ThermalLevel: String, Sendable {
    case nominal, fair, serious, critical

    public var label: String {
        switch self {
        case .nominal: return "Normal"
        case .fair: return "Warm"
        case .serious: return "Hot — slowed down"
        case .critical: return "Critical"
        }
    }
}

/// One refresh worth of machine data.
public struct Snapshot: Sendable {
    public var timestamp: Date
    public var cpu: CPUStats
    public var memory: MemoryStats
    /// Bytes per second.
    public var diskRead: Double
    public var diskWrite: Double
    public var networkIn: Double
    public var networkOut: Double
    public var gpus: [GPUStats]
    public var volumes: [Volume]
    public var processes: [ProcessRow]
    public var thermal: ThermalLevel
    public var uptime: TimeInterval

    public init(
        timestamp: Date = Date(), cpu: CPUStats = CPUStats(), memory: MemoryStats = MemoryStats(),
        diskRead: Double = 0, diskWrite: Double = 0, networkIn: Double = 0, networkOut: Double = 0,
        gpus: [GPUStats] = [], volumes: [Volume] = [], processes: [ProcessRow] = [],
        thermal: ThermalLevel = .nominal, uptime: TimeInterval = 0
    ) {
        self.timestamp = timestamp
        self.cpu = cpu
        self.memory = memory
        self.diskRead = diskRead
        self.diskWrite = diskWrite
        self.networkIn = networkIn
        self.networkOut = networkOut
        self.gpus = gpus
        self.volumes = volumes
        self.processes = processes
        self.thermal = thermal
        self.uptime = uptime
    }

    /// The GPU to feature: the busiest one.
    public var primaryGPU: GPUStats? {
        gpus.max { ($0.utilization ?? -1) < ($1.utilization ?? -1) }
    }
}

public struct SystemInfo: Sendable {
    public var hostName: String
    public var osVersion: String
    public var model: String
    public var chip: String
    public var cores: Int
    public var performanceCores: Int?
    public var efficiencyCores: Int?
    public var memory: UInt64
    public var bootTime: Date?

    public init(
        hostName: String = "", osVersion: String = "", model: String = "", chip: String = "",
        cores: Int = 0, performanceCores: Int? = nil, efficiencyCores: Int? = nil,
        memory: UInt64 = 0, bootTime: Date? = nil
    ) {
        self.hostName = hostName
        self.osVersion = osVersion
        self.model = model
        self.chip = chip
        self.cores = cores
        self.performanceCores = performanceCores
        self.efficiencyCores = efficiencyCores
        self.memory = memory
        self.bootTime = bootTime
    }
}

public enum TransportProtocol: String, Sendable {
    case tcp = "TCP"
    case udp = "UDP"
}

public struct Connection: Identifiable, Hashable, Sendable {
    public var id: String { "\(pid):\(fd):\(proto.rawValue)" }
    public var pid: Int32
    public var processName: String
    public var fd: Int32
    public var proto: TransportProtocol
    public var isIPv6: Bool
    public var localAddress: String
    public var localPort: Int
    public var remoteAddress: String
    public var remotePort: Int
    public var state: String

    public init(
        pid: Int32, processName: String, fd: Int32, proto: TransportProtocol, isIPv6: Bool,
        localAddress: String, localPort: Int, remoteAddress: String, remotePort: Int, state: String
    ) {
        self.pid = pid
        self.processName = processName
        self.fd = fd
        self.proto = proto
        self.isIPv6 = isIPv6
        self.localAddress = localAddress
        self.localPort = localPort
        self.remoteAddress = remoteAddress
        self.remotePort = remotePort
        self.state = state
    }

    public var isListening: Bool {
        state == "Listen" || (proto == .udp && remotePort == 0)
    }
}

/// A launchd job of the user's session.
public struct LaunchJob: Identifiable, Hashable, Sendable {
    public var id: String { label }
    public var label: String
    public var pid: Int32?
    /// The last exit status; nil while running or never run.
    public var lastExitStatus: Int32?

    public init(label: String, pid: Int32?, lastExitStatus: Int32?) {
        self.label = label
        self.pid = pid
        self.lastExitStatus = lastExitStatus
    }

    public var isRunning: Bool { pid != nil }
    /// Apple's own jobs, which are part of macOS.
    public var isApple: Bool {
        label.hasPrefix("com.apple.") || label.hasPrefix("application.com.apple.")
    }
}
