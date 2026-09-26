import Foundation
import MoonTaskCore
import MoonTaskSystem
import Observation
import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case overview, processes, performance, network, services, settings
    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "Overview"
        case .processes: return "Processes"
        case .performance: return "Performance"
        case .network: return "Network"
        case .services: return "Services"
        case .settings: return "Settings"
        }
    }

    var subtitle: String {
        switch self {
        case .overview: return "Your Mac at a glance"
        case .processes: return "Everything that runs, as a tree, a list or by app"
        case .performance: return "CPU, memory, GPU, disk and network over time"
        case .network: return "Open connections and listening ports"
        case .services: return "The launchd agents of your session"
        case .settings: return "How MoonTask looks and behaves"
        }
    }

    var symbol: String {
        switch self {
        case .overview: return "moon.stars"
        case .processes: return "list.bullet.indent"
        case .performance: return "waveform.path.ecg"
        case .network: return "network"
        case .services: return "gearshape.2"
        case .settings: return "slider.horizontal.3"
        }
    }
}

/// The app's live state: the latest snapshot, its history, and what's
/// selected. Sampling runs on a background queue; everything the views read
/// is updated on the main actor.
@MainActor
@Observable
final class AppModel {
    var section: AppSection = .overview
    private(set) var snapshot = Snapshot()
    private(set) var hasSnapshot = false
    private(set) var history = History()
    private(set) var systemInfo = SystemInfo()
    private(set) var events: [ActivityEvent] = []
    /// Processes that started in the last few seconds (highlighted).
    private(set) var fresh: Set<ProcessIdentity> = []
    private(set) var connections: [Connection] = []
    private(set) var jobs: [LaunchJob] = []
    var paused = false
    var message: String?

    private let sampler = Sampler()
    private let queue = DispatchQueue(label: "io.moontask.sampler", qos: .utility)
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var freshSince: [ProcessIdentity: Date] = [:]

    init() {}

    func start() {
        guard loop == nil else { return }
        systemInfo = SystemInfoReader.read()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                let interval = UserDefaults.standard.double(forKey: SettingKey.refreshInterval)
                try? await Task.sleep(for: .milliseconds(Int((interval > 0 ? interval : 1) * 1000)))
            }
        }
    }

    func refresh(force: Bool = false) async {
        if paused && !force { return }
        let sampler = self.sampler
        let next = await withCheckedContinuation { (continuation: CheckedContinuation<Snapshot, Never>) in
            queue.async { continuation.resume(returning: sampler.sample()) }
        }
        apply(next)
        if section == .network { await refreshConnections() }
        if section == .services && jobs.isEmpty { await refreshJobs() }
    }

    private func apply(_ next: Snapshot) {
        let now = next.timestamp
        if hasSnapshot {
            let new = activity(from: snapshot.processes, to: next.processes, at: now)
            if !new.isEmpty {
                events = Array((new + events).prefix(60))
                for event in new where event.kind == .started {
                    if let p = next.processes.first(where: { $0.pid == event.pid }) {
                        freshSince[p.identity] = now
                    }
                }
            }
        }
        freshSince = freshSince.filter { now.timeIntervalSince($0.value) < 3 }
        fresh = Set(freshSince.keys)
        history.record(next)
        snapshot = next
        hasSnapshot = true
    }

    func refreshConnections() async {
        let processes = snapshot.processes
        connections = await Task.detached(priority: .utility) {
            ProcessInspector.allConnections(processes)
        }.value
    }

    func refreshJobs() async {
        jobs = await Task.detached(priority: .utility) { LaunchAgents.list() }.value
    }

    // MARK: - Actions

    func perform(_ action: ProcessAction, on row: ProcessRow) {
        let tree = snapshot.processes
        do {
            try ProcessControl.perform(action, on: row, tree: tree)
            message = nil
        } catch {
            message = error.localizedDescription
        }
        Task { await refresh(force: true) }
    }

    func startJob(_ job: LaunchJob) {
        if !LaunchAgents.start(job) { message = "launchd couldn't start \(job.label)." }
        Task { await refreshJobs() }
    }

    func stopJob(_ job: LaunchJob) {
        if !LaunchAgents.stop(job) { message = "launchd couldn't stop \(job.label)." }
        Task { await refreshJobs() }
    }

    func process(pid: Int32) -> ProcessRow? {
        snapshot.processes.first { $0.pid == pid }
    }
}

