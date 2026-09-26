import MoonTaskCore
import SwiftUI

struct ServicesView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var hideApple = true
    @State private var selection: LaunchJob.ID?
    @State private var pending: (job: LaunchJob, stop: Bool)?

    var body: some View {
        let jobs = model.jobs
            .filter { !hideApple || !$0.isApple }
            .filter { query.isEmpty || $0.label.localizedCaseInsensitiveContains(query) }
        let selected = jobs.first { $0.id == selection }

        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Chip(text: "\(model.jobs.filter(\.isRunning).count) running", tone: Palette.success)
                Chip(text: "\(model.jobs.count) jobs")
                Spacer()
                Toggle("Hide Apple's", isOn: $hideApple)
                    .toggleStyle(.switch)
                    .controlSize(.small)
                Button("Start") { if let selected { pending = (selected, false) } }
                    .disabled(selected == nil)
                Button("Stop") { if let selected { pending = (selected, true) } }
                    .disabled(selected?.isRunning != true)
                Button { Task { await model.refreshJobs() } } label: { Image(systemName: "arrow.clockwise") }
                    .help("Reload")
            }
            .controlSize(.small)

            Table(jobs, selection: $selection) {
                TableColumn("Label") { job in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(job.isRunning ? Palette.success : Palette.textFaint)
                            .frame(width: 7, height: 7)
                        Text(job.label).foregroundStyle(Palette.text).lineLimit(1)
                    }
                }
                .width(min: 260, ideal: 420)
                TableColumn("State") { job in
                    Text(job.isRunning ? "Running" : "Not running")
                        .foregroundStyle(job.isRunning ? Palette.success : Palette.textMuted)
                }
                .width(min: 90, ideal: 110)
                TableColumn("PID") { job in
                    Text(job.pid.map(String.init) ?? "–").font(.figure(12, weight: .regular))
                }
                .width(min: 50, ideal: 70)
                TableColumn("Last exit") { job in
                    Text(job.lastExitStatus.map { $0 == 0 ? "OK" : "code \($0)" } ?? "–")
                        .foregroundStyle((job.lastExitStatus ?? 0) == 0 ? Palette.textMuted : Palette.warning)
                }
                .width(min: 70, ideal: 90)
            }
            .scrollContentBackground(.hidden)
            .alternatingRowBackgrounds(.disabled)
            .glass(cornerRadius: 14)
        }
        .padding(16)
        .searchable(text: $query, placement: .toolbar, prompt: "Label")
        .task { await model.refreshJobs() }
        .confirmationDialog(
            pending.map { ($0.stop ? "Stop " : "Start ") + $0.job.label + "?" } ?? "",
            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })
        ) {
            if let pending {
                Button(pending.stop ? "Stop" : "Start", role: pending.stop ? .destructive : nil) {
                    if pending.stop { model.stopJob(pending.job) } else { model.startJob(pending.job) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("launchd will \(pending?.stop == true ? "stop" : "start") this agent of your session. Agents that are set to keep running start again by themselves.")
        }
    }
}
