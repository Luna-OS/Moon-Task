import CDarwin
import Darwin
import Foundation
import MoonTaskCore

/// Reads the machine once per refresh. Rates (CPU %, bytes/s) are the
/// difference to the previous call, so the first call reports zeros.
///
/// Not thread-safe: one sampler is used by one background queue.
public final class Sampler {
    private var lastCPUTicks: [UInt64] = []
    private var lastProcessCPU: [ProcessIdentity: UInt64] = [:]
    private var lastProcessDisk: [ProcessIdentity: (read: UInt64, written: UInt64)] = [:]
    private var lastDisk: (read: UInt64, written: UInt64)?
    private var lastNetwork: (received: UInt64, sent: UInt64)?
    private var lastTime: UInt64 = 0
    private var paths: [ProcessIdentity: String] = [:]
    private var userNames: [UInt32: String] = [:]
    private var volumes: [Volume] = []
    private var lastVolumeRead: Date = .distantPast
    private var kinfo = [mt_kinfo](repeating: mt_kinfo(), count: 8192)

    private let ownUID = getuid()
    private let ownPid = getpid()
    private let coreCount = max(1, Int(mt_sysctl_int("hw.logicalcpu")))

    public init() {}

    public func sample() -> Snapshot {
        let now = DispatchTime.now().uptimeNanoseconds
        let elapsed = lastTime == 0 ? 0 : Double(now - lastTime)
        lastTime = now

        var snapshot = Snapshot(timestamp: Date())
        snapshot.cpu = readCPU()
        snapshot.memory = readMemory()
        snapshot.processes = readProcesses(elapsedNs: elapsed)
        (snapshot.diskRead, snapshot.diskWrite) = readDisk(elapsedNs: elapsed)
        (snapshot.networkIn, snapshot.networkOut) = readNetwork(elapsedNs: elapsed)
        snapshot.gpus = readGPUs()
        snapshot.volumes = readVolumes()
        snapshot.thermal = Self.thermal()
        snapshot.uptime = ProcessInfo.processInfo.systemUptime
        return snapshot
    }

    // MARK: - CPU

    private func readCPU() -> CPUStats {
        var ticks = [UInt64](repeating: 0, count: 4 * 256)
        let cores = Int(ticks.withUnsafeMutableBufferPointer { mt_cpu_ticks($0.baseAddress, 256) })
        guard cores > 0 else { return CPUStats() }
        ticks = Array(ticks.prefix(4 * cores))
        defer { lastCPUTicks = ticks }
        guard lastCPUTicks.count == ticks.count else {
            return CPUStats(perCore: Array(repeating: 0, count: cores))
        }

        var perCore: [Double] = []
        var busy = 0.0, all = 0.0, user = 0.0, system = 0.0
        for core in 0..<cores {
            // Counters are 32-bit in the kernel and may wrap; a wrapped
            // interval simply counts as idle.
            func delta(_ i: Int) -> Double {
                let now = ticks[4 * core + i], before = lastCPUTicks[4 * core + i]
                return now >= before ? Double(now - before) : 0
            }
            let u = delta(0), s = delta(1), idle = delta(2), n = delta(3)
            let total = u + s + idle + n
            perCore.append(total > 0 ? (u + s + n) / total * 100 : 0)
            busy += u + s + n
            all += total
            user += u + n
            system += s
        }
        return CPUStats(
            total: all > 0 ? busy / all * 100 : 0,
            perCore: perCore,
            user: all > 0 ? user / all * 100 : 0,
            system: all > 0 ? system / all * 100 : 0
        )
    }

    // MARK: - Memory

    private func readMemory() -> MemoryStats {
        var m = mt_memory()
        guard mt_memory_stats(&m) == 0 else { return MemoryStats() }
        return MemoryStats(
            total: m.total, app: m.app, wired: m.wired, compressed: m.compressed,
            cached: m.cached, free: m.free, swapTotal: m.swap_total, swapUsed: m.swap_used
        )
    }

    // MARK: - Processes

    private func readProcesses(elapsedNs: Double) -> [ProcessRow] {
        let count = Int(kinfo.withUnsafeMutableBufferPointer {
            mt_list_processes($0.baseAddress, Int32($0.count))
        })
        guard count > 0 else { return [] }

        // macOS only shows the resource usage of other users' processes to
        // root. /bin/ps is allowed to read it (it's setuid root), so for
        // those processes MoonTask asks ps, once per refresh.
        var others: [Int32: PSUsage]?

        var rows: [ProcessRow] = []
        rows.reserveCapacity(count)
        var cpuNow: [ProcessIdentity: UInt64] = [:]
        var diskNow: [ProcessIdentity: (read: UInt64, written: UInt64)] = [:]
        let machineNs = elapsedNs * Double(coreCount)

        for i in 0..<count {
            let k = kinfo[i]
            let pid = k.pid
            let name = cString(k.comm)
            let start = Double(k.start_sec) + Double(k.start_usec) / 1_000_000
            let identity = ProcessIdentity(pid: pid, startTime: start)

            var usage = mt_usage()
            mt_process_usage(pid, &usage)
            if usage.ok == 0 && pid != 0 {
                if others == nil { others = Self.psUsage() }
                if let ps = others?[pid] {
                    usage.ok = 1
                    usage.cpu_ns = ps.cpuNs
                    usage.resident = ps.resident
                }
            }

            var cpu = 0.0
            var read = 0.0, written = 0.0
            if usage.ok != 0 {
                cpuNow[identity] = usage.cpu_ns
                diskNow[identity] = (usage.disk_read, usage.disk_written)
                if machineNs > 0, let before = lastProcessCPU[identity], usage.cpu_ns >= before {
                    cpu = min(100, Double(usage.cpu_ns - before) / machineNs * 100)
                }
                if elapsedNs > 0, let before = lastProcessDisk[identity] {
                    let seconds = elapsedNs / 1e9
                    if usage.disk_read >= before.read {
                        read = Double(usage.disk_read - before.read) / seconds
                    }
                    if usage.disk_written >= before.written {
                        written = Double(usage.disk_written - before.written) / seconds
                    }
                }
            }

            let owner: Owner
            if pid == 0 {
                owner = .kernel
            } else if k.uid == ownUID {
                owner = .current
            } else if k.uid < 500 {
                owner = .system
            } else {
                owner = .other
            }

            rows.append(ProcessRow(
                pid: pid,
                parentPid: pid == 0 ? nil : k.ppid,
                name: pid == 0 ? "kernel_task" : name,
                user: userName(k.uid),
                uid: k.uid,
                owner: owner,
                state: ProcessState(bsdState: k.state),
                cpu: cpu,
                memory: usage.footprint > 0 ? usage.footprint : usage.resident,
                threads: usage.threads >= 0 ? Int(usage.threads) : nil,
                diskRead: read,
                diskWrite: written,
                nice: k.nice,
                startTime: start,
                cpuTime: Double(usage.cpu_ns) / 1e9,
                path: path(for: identity),
                isProtected: Safety.isProtected(pid: pid, name: pid == 0 ? "kernel_task" : name, ownPid: ownPid)
            ))
        }
        lastProcessCPU = cpuNow
        lastProcessDisk = diskNow
        let alive = Set(rows.map(\.identity))
        paths = paths.filter { alive.contains($0.key) }
        return rows
    }

    struct PSUsage {
        var resident: UInt64
        var cpuNs: UInt64
    }

    /// Resident memory and CPU time of every process, from `ps`.
    static func psUsage() -> [Int32: PSUsage] {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-axo", "pid=,rss=,time="]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return [:] }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return parsePS(String(decoding: data, as: UTF8.self))
    }

    static func parsePS(_ output: String) -> [Int32: PSUsage] {
        var out: [Int32: PSUsage] = [:]
        for line in output.split(separator: "\n") {
            let fields = line.split(separator: " ", omittingEmptySubsequences: true)
            guard fields.count >= 3, let pid = Int32(fields[0]), let rssKB = UInt64(fields[1]),
                  let seconds = parseCPUTime(String(fields[2]))
            else { continue }
            out[pid] = PSUsage(resident: rssKB * 1024, cpuNs: UInt64(seconds * 1e9))
        }
        return out
    }

    /// ps' CPU time: "[[dd-]hh:]mm:ss.ss".
    static func parseCPUTime(_ text: String) -> Double? {
        var days = 0.0
        var rest = Substring(text)
        if let dash = rest.firstIndex(of: "-") {
            guard let d = Double(rest[..<dash]) else { return nil }
            days = d
            rest = rest[rest.index(after: dash)...]
        }
        var total = 0.0
        for part in rest.split(separator: ":") {
            guard let v = Double(part) else { return nil }
            total = total * 60 + v
        }
        return days * 86_400 + total
    }

    private func path(for identity: ProcessIdentity) -> String? {
        if let known = paths[identity] { return known.isEmpty ? nil : known }
        var buffer = [CChar](repeating: 0, count: 4096)
        let len = buffer.withUnsafeMutableBufferPointer {
            mt_process_path(identity.pid, $0.baseAddress, Int32($0.count))
        }
        let path = len > 0 ? String(cString: buffer) : ""
        paths[identity] = path
        return path.isEmpty ? nil : path
    }

    private func userName(_ uid: UInt32) -> String? {
        if let known = userNames[uid] { return known }
        guard let pw = getpwuid(uid) else { return nil }
        let name = String(cString: pw.pointee.pw_name)
        userNames[uid] = name
        return name
    }

    // MARK: - Disk & network

    private func readDisk(elapsedNs: Double) -> (Double, Double) {
        var read: UInt64 = 0, written: UInt64 = 0
        guard mt_disk_totals(&read, &written) == 0 else { return (0, 0) }
        defer { lastDisk = (read, written) }
        guard let last = lastDisk, elapsedNs > 0 else { return (0, 0) }
        let seconds = elapsedNs / 1e9
        return (
            read >= last.read ? Double(read - last.read) / seconds : 0,
            written >= last.written ? Double(written - last.written) / seconds : 0
        )
    }

    private func readNetwork(elapsedNs: Double) -> (Double, Double) {
        var received: UInt64 = 0, sent: UInt64 = 0
        guard mt_network_totals(&received, &sent) == 0 else { return (0, 0) }
        defer { lastNetwork = (received, sent) }
        guard let last = lastNetwork, elapsedNs > 0 else { return (0, 0) }
        let seconds = elapsedNs / 1e9
        return (
            received >= last.received ? Double(received - last.received) / seconds : 0,
            sent >= last.sent ? Double(sent - last.sent) / seconds : 0
        )
    }

    // MARK: - GPU, volumes, thermal state

    private func readGPUs() -> [GPUStats] {
        var gpus = [mt_gpu](repeating: mt_gpu(), count: 8)
        let n = Int(gpus.withUnsafeMutableBufferPointer { mt_gpus($0.baseAddress, 8) })
        guard n > 0 else { return [] }
        return (0..<n).map { i in
            let g = gpus[i]
            let name = cString(g.name)
            return GPUStats(
                id: i,
                name: name.isEmpty ? "GPU" : name,
                utilization: g.utilization >= 0 ? g.utilization : nil,
                memoryUsed: g.memory_used >= 0 ? UInt64(g.memory_used) : nil,
                cores: g.cores > 0 ? Int(g.cores) : nil
            )
        }
    }

    private func readVolumes() -> [Volume] {
        // Volume sizes change slowly; every 10 s is plenty.
        guard Date().timeIntervalSince(lastVolumeRead) > 10 else { return volumes }
        lastVolumeRead = Date()
        let keys: [URLResourceKey] = [
            .volumeNameKey, .volumeTotalCapacityKey, .volumeAvailableCapacityForImportantUsageKey,
            .volumeAvailableCapacityKey, .volumeIsInternalKey, .volumeIsBrowsableKey,
        ]
        let urls = FileManager.default.mountedVolumeURLs(
            includingResourceValuesForKeys: keys, options: [.skipHiddenVolumes]
        ) ?? []
        volumes = urls.compactMap { url in
            guard let v = try? url.resourceValues(forKeys: Set(keys)),
                  v.volumeIsBrowsable ?? true,
                  let total = v.volumeTotalCapacity, total > 0
            else { return nil }
            let available = v.volumeAvailableCapacityForImportantUsage.map { UInt64(max(0, $0)) }
                ?? UInt64(max(0, v.volumeAvailableCapacity ?? 0))
            return Volume(
                name: v.volumeName ?? url.lastPathComponent,
                mountPoint: url.path,
                total: UInt64(total),
                available: min(UInt64(total), available),
                isInternal: v.volumeIsInternal ?? false
            )
        }
        return volumes
    }

    static func thermal() -> ThermalLevel {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: return .nominal
        case .fair: return .fair
        case .serious: return .serious
        case .critical: return .critical
        @unknown default: return .nominal
        }
    }
}

// The sampler is only ever used from one queue at a time (see above).
extension Sampler: @unchecked Sendable {}

/// A C `char[N]` field (imported as a tuple) as a String.
func cString<T>(_ tuple: T) -> String {
    withUnsafeBytes(of: tuple) { raw in
        let bytes = raw.bindMemory(to: UInt8.self)
        let end = bytes.firstIndex(of: 0) ?? bytes.count
        return String(decoding: bytes[..<end], as: UTF8.self)
    }
}
