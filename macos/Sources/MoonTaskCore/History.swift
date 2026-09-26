import Foundation

/// The last `capacity` values of a measure, oldest first — the data behind
/// every chart and sparkline.
public struct Series: Sendable, Equatable {
    public private(set) var values: [Double] = []
    public let capacity: Int

    public init(capacity: Int = 120) {
        self.capacity = capacity
    }

    public mutating func append(_ value: Double) {
        values.append(value)
        if values.count > capacity { values.removeFirst(values.count - capacity) }
    }

    public var last: Double? { values.last }
    public var peak: Double { values.max() ?? 0 }
}

/// Everything the charts keep between refreshes.
public struct History: Sendable {
    public var cpu = Series()
    public var cpuUser = Series()
    public var cpuSystem = Series()
    public var perCore: [Series] = []
    public var memory = Series()
    public var swap = Series()
    public var diskRead = Series()
    public var diskWrite = Series()
    public var networkIn = Series()
    public var networkOut = Series()
    public var gpu: [Int: Series] = [:]
    /// Per process (by identity), for the detail panel's sparklines.
    public var processCPU: [ProcessIdentity: Series] = [:]
    public var processMemory: [ProcessIdentity: Series] = [:]
    public var timestamps: [Date] = []

    public init() {}

    public mutating func record(_ s: Snapshot) {
        cpu.append(s.cpu.total)
        cpuUser.append(s.cpu.user)
        cpuSystem.append(s.cpu.system)
        if perCore.count != s.cpu.perCore.count {
            perCore = s.cpu.perCore.map { _ in Series() }
        }
        for (i, value) in s.cpu.perCore.enumerated() { perCore[i].append(value) }
        memory.append(Double(s.memory.used))
        swap.append(Double(s.memory.swapUsed))
        diskRead.append(s.diskRead)
        diskWrite.append(s.diskWrite)
        networkIn.append(s.networkIn)
        networkOut.append(s.networkOut)
        for gpu in s.gpus {
            self.gpu[gpu.id, default: Series()].append(gpu.utilization ?? 0)
        }
        timestamps.append(s.timestamp)
        if timestamps.count > cpu.capacity { timestamps.removeFirst(timestamps.count - cpu.capacity) }

        // Short per-process histories, only for processes still alive.
        var alive = Set<ProcessIdentity>()
        for p in s.processes {
            let id = p.identity
            alive.insert(id)
            processCPU[id, default: Series(capacity: 60)].append(p.cpu)
            processMemory[id, default: Series(capacity: 60)].append(Double(p.memory))
        }
        processCPU = processCPU.filter { alive.contains($0.key) }
        processMemory = processMemory.filter { alive.contains($0.key) }
    }
}

/// A process that started or ended, for the overview's activity feed.
public struct ActivityEvent: Identifiable, Sendable {
    public enum Kind: Sendable { case started, ended }
    public var id = UUID()
    public var kind: Kind
    public var name: String
    public var pid: Int32
    public var time: Date

    public init(kind: Kind, name: String, pid: Int32, time: Date) {
        self.kind = kind
        self.name = name
        self.pid = pid
        self.time = time
    }
}

/// Processes that appeared and disappeared between two snapshots.
public func activity(from old: [ProcessRow], to new: [ProcessRow], at time: Date) -> [ActivityEvent] {
    let before = Dictionary(old.map { ($0.identity, $0) }, uniquingKeysWith: { a, _ in a })
    let after = Dictionary(new.map { ($0.identity, $0) }, uniquingKeysWith: { a, _ in a })
    var events: [ActivityEvent] = []
    for (id, p) in after where before[id] == nil {
        events.append(ActivityEvent(kind: .started, name: p.name, pid: p.pid, time: time))
    }
    for (id, p) in before where after[id] == nil {
        events.append(ActivityEvent(kind: .ended, name: p.name, pid: p.pid, time: time))
    }
    return events.sorted { $0.name < $1.name }
}
