//! The live view of the machine. One [`Monitor`] owns every `sysinfo`
//! collection and turns each refresh into a [`Snapshot`]: totals, rates
//! and the process list, ready for the frontend.
//!
//! Rates (disk and network bytes per second) are measured over the real
//! time between two refreshes, not the nominal interval, so a late timer
//! never shows up as a fake spike.

pub mod classify;

use crate::models::{
    CoreStats, CpuStats, DiskStats, EnvVar, LoadAverage, MemoryStats, NetworkInterface,
    NetworkStats, Owner, ProcessDetails, ProcessRef, ProcessRow, Sensor, Snapshot, SystemInfo,
    Volume,
};
use crate::platform;
use classify::Os;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{
    Components, DiskKind, Disks, Networks, Pid, Process, ProcessRefreshKind, ProcessesToUpdate,
    System, UpdateKind, Users,
};

/// Below this, CPU usage deltas are meaningless (`sysinfo` needs ~200 ms);
/// a faster caller gets the previous snapshot again.
const MIN_INTERVAL: Duration = Duration::from_millis(250);

/// Sensors and the user list change rarely; refresh them every N ticks.
const SLOW_EVERY: u64 = 5;
const USERS_EVERY: u64 = 60;

/// A process as the control layer needs to know it: enough to decide
/// whether an action is allowed and to make sure it still is the process
/// the user clicked on.
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub pid: u32,
    pub name: String,
    pub owner: Owner,
    pub protected: bool,
    pub start_time: u64,
}

pub struct Monitor {
    system: System,
    networks: Networks,
    disks: Disks,
    components: Components,
    users: Users,
    self_pid: u32,
    self_uid: Option<String>,
    last_refresh: Instant,
    last: Option<Snapshot>,
    ticks: u64,
}

impl Default for Monitor {
    fn default() -> Self {
        Self::new()
    }
}

impl Monitor {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_cpu_all();
        system.refresh_memory();
        system.refresh_processes_specifics(ProcessesToUpdate::All, true, list_refresh_kind());

        let self_pid = std::process::id();
        let self_uid = system
            .process(Pid::from_u32(self_pid))
            .and_then(Process::user_id)
            .map(|uid| (**uid).to_string());

        Monitor {
            system,
            networks: Networks::new_with_refreshed_list(),
            disks: Disks::new_with_refreshed_list(),
            components: Components::new_with_refreshed_list(),
            users: Users::new_with_refreshed_list(),
            self_pid,
            self_uid,
            last_refresh: Instant::now(),
            last: None,
            ticks: 0,
        }
    }

    pub fn system_info(&self) -> SystemInfo {
        let cpus = self.system.cpus();
        SystemInfo {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            platform: platform::platform_name(),
            host_name: System::host_name(),
            os_name: System::name(),
            os_version: System::long_os_version().or_else(System::os_version),
            kernel_version: System::kernel_version(),
            arch: System::cpu_arch(),
            cpu_brand: cpus
                .first()
                .map(|c| c.brand().trim().to_string())
                .unwrap_or_default(),
            physical_cores: System::physical_core_count(),
            logical_cores: cpus.len(),
            total_memory: self.system.total_memory(),
            boot_time: System::boot_time(),
            self_pid: self.self_pid,
        }
    }

    pub fn snapshot(&mut self) -> Snapshot {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refresh);
        if elapsed < MIN_INTERVAL {
            if let Some(last) = &self.last {
                return last.clone();
            }
        }
        self.last_refresh = now;
        self.ticks += 1;
        let secs = elapsed.as_secs_f64().max(0.001);

        self.system.refresh_cpu_all();
        self.system.refresh_memory();
        self.system
            .refresh_processes_specifics(ProcessesToUpdate::All, true, list_refresh_kind());
        self.networks.refresh(true);
        self.disks.refresh(true);
        if self.ticks % SLOW_EVERY == 1 {
            self.components.refresh(true);
        }
        if self.ticks.is_multiple_of(USERS_EVERY) {
            self.users.refresh();
        }

        let (processes, thread_count) = self.process_rows(secs);
        let snapshot = Snapshot {
            timestamp: unix_millis(),
            interval_ms: elapsed.as_millis() as u64,
            uptime: System::uptime(),
            cpu: self.cpu_stats(),
            memory: MemoryStats {
                total: self.system.total_memory(),
                used: self.system.used_memory(),
                available: self.system.available_memory(),
                swap_total: self.system.total_swap(),
                swap_used: self.system.used_swap(),
            },
            load: load_average(),
            network: self.network_stats(secs),
            disk: self.disk_stats(secs),
            sensors: self.sensors(),
            process_count: processes.len(),
            thread_count,
            processes,
        };
        self.last = Some(snapshot.clone());
        snapshot
    }

    fn cpu_stats(&self) -> CpuStats {
        CpuStats {
            total: self.system.global_cpu_usage(),
            cores: self
                .system
                .cpus()
                .iter()
                .map(|c| CoreStats {
                    usage: c.cpu_usage(),
                    frequency: c.frequency(),
                })
                .collect(),
        }
    }

    /// Real processes only: on Linux `sysinfo` also lists every thread as
    /// its own entry, which are folded into their process' thread count.
    fn real_processes(&self) -> impl Iterator<Item = &Process> {
        self.system
            .processes()
            .values()
            .filter(|p| p.thread_kind().is_none())
    }

    fn process_rows(&self, secs: f64) -> (Vec<ProcessRow>, u64) {
        let cores = self.system.cpus().len().max(1) as f32;
        let pids: Vec<u32> = self.real_processes().map(|p| p.pid().as_u32()).collect();
        let thread_counts = platform::thread_counts(&pids);

        let mut total_threads = 0u64;
        let rows = self
            .real_processes()
            .map(|p| {
                let pid = p.pid().as_u32();
                let threads = p
                    .tasks()
                    .map(|t| thread_count(t, p.pid()))
                    .or_else(|| thread_counts.get(&pid).copied());
                total_threads += u64::from(threads.unwrap_or(1));
                let target = self.target_of(p);
                let disk = p.disk_usage();
                ProcessRow {
                    pid,
                    parent_pid: p.parent().map(Pid::as_u32),
                    name: target.name,
                    exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
                    command: join_command(p),
                    user: self.user_name(p),
                    owner: target.owner,
                    status: p.status().into(),
                    cpu: (p.cpu_usage() / cores).clamp(0.0, 100.0),
                    memory: p.memory(),
                    virtual_memory: p.virtual_memory(),
                    threads,
                    disk_read: per_second(disk.read_bytes, secs),
                    disk_write: per_second(disk.written_bytes, secs),
                    start_time: p.start_time(),
                    protected: target.protected,
                }
            })
            .collect();
        (rows, total_threads)
    }

    fn network_stats(&self, secs: f64) -> NetworkStats {
        let mut interfaces: Vec<NetworkInterface> = self
            .networks
            .list()
            .iter()
            .map(|(name, data)| NetworkInterface {
                name: name.clone(),
                rx_rate: per_second(data.received(), secs),
                tx_rate: per_second(data.transmitted(), secs),
                total_rx: data.total_received(),
                total_tx: data.total_transmitted(),
                loopback: is_loopback(name),
            })
            .collect();
        interfaces.sort_by(|a, b| a.loopback.cmp(&b.loopback).then(a.name.cmp(&b.name)));
        let external = interfaces.iter().filter(|i| !i.loopback);
        NetworkStats {
            rx_rate: external.clone().map(|i| i.rx_rate).sum(),
            tx_rate: external.map(|i| i.tx_rate).sum(),
            interfaces,
        }
    }

    fn disk_stats(&self, secs: f64) -> DiskStats {
        // Several mounts can sit on one device (btrfs subvolumes, bind
        // mounts); count each device's I/O once.
        let mut seen = HashSet::new();
        let (mut read, mut written) = (0u64, 0u64);
        let mut volumes = Vec::new();
        for disk in self.disks.list() {
            let name = disk.name().to_string_lossy().into_owned();
            let file_system = disk.file_system().to_string_lossy().into_owned();
            if seen.insert(name.clone()) {
                let usage = disk.usage();
                read += usage.read_bytes;
                written += usage.written_bytes;
            }
            // Snap packages mount one read-only squashfs each — noise.
            if file_system == "squashfs" {
                continue;
            }
            volumes.push(Volume {
                name,
                mount_point: disk.mount_point().to_string_lossy().into_owned(),
                file_system,
                total: disk.total_space(),
                available: disk.available_space(),
                removable: disk.is_removable(),
                kind: match disk.kind() {
                    DiskKind::SSD => "ssd",
                    DiskKind::HDD => "hdd",
                    _ => "unknown",
                },
            });
        }
        DiskStats {
            read_rate: per_second(read, secs),
            write_rate: per_second(written, secs),
            volumes,
        }
    }

    fn sensors(&self) -> Vec<Sensor> {
        let mut sensors: Vec<Sensor> = self
            .components
            .list()
            .iter()
            .filter_map(|c| {
                let temperature = c.temperature().filter(|t| t.is_finite() && *t > 0.0)?;
                Some(Sensor {
                    label: c.label().to_string(),
                    temperature,
                    critical: c.critical().filter(|t| t.is_finite() && *t > 0.0),
                })
            })
            .collect();
        sensors.sort_by(|a, b| a.label.cmp(&b.label));
        sensors
    }

    fn uid_of(p: &Process) -> Option<String> {
        p.user_id().map(|uid| (**uid).to_string())
    }

    fn user_name(&self, p: &Process) -> Option<String> {
        let uid = p.user_id()?;
        if let Some(user) = self.users.get_user_by_id(uid) {
            return Some(user.name().to_string());
        }
        let raw = (**uid).to_string();
        Some(
            classify::well_known_account(&raw)
                .map(str::to_string)
                .unwrap_or(raw),
        )
    }

    fn target_of(&self, p: &Process) -> Target {
        let pid = p.pid().as_u32();
        let name = display_name(&p.name().to_string_lossy(), p.exe());
        let uid = Self::uid_of(p);
        let owner = classify::owner(
            Os::CURRENT,
            pid,
            p.parent().map(Pid::as_u32),
            uid.as_deref(),
            self.self_uid.as_deref(),
        );
        Target {
            pid,
            protected: classify::is_protected(Os::CURRENT, pid, &name, owner, self.self_pid),
            name,
            owner,
            start_time: p.start_time(),
        }
    }

    /// Re-reads one process right now, for the control layer. `None` if it
    /// has exited in the meantime.
    pub fn target(&mut self, pid: u32) -> Option<Target> {
        let spid = Pid::from_u32(pid);
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[spid]),
            false,
            ProcessRefreshKind::nothing()
                .with_user(UpdateKind::OnlyIfNotSet)
                .with_exe(UpdateKind::OnlyIfNotSet),
        );
        let p = self.system.process(spid).filter(|p| p.exists())?;
        Some(self.target_of(p))
    }

    /// Every descendant of `pid`, children after their own children — the
    /// order to end a tree in, so no process gets re-parented halfway.
    pub fn descendants(&self, pid: u32) -> Vec<Target> {
        let mut children: HashMap<u32, Vec<&Process>> = HashMap::new();
        for p in self.real_processes() {
            if let Some(parent) = p.parent() {
                children.entry(parent.as_u32()).or_default().push(p);
            }
        }
        let mut out = Vec::new();
        let mut visited = HashSet::from([pid]);
        fn walk(
            monitor: &Monitor,
            pid: u32,
            children: &HashMap<u32, Vec<&Process>>,
            visited: &mut HashSet<u32>,
            out: &mut Vec<Target>,
        ) {
            for child in children.get(&pid).into_iter().flatten() {
                let cpid = child.pid().as_u32();
                // PID reuse can create cycles in the parent links.
                if !visited.insert(cpid) {
                    continue;
                }
                walk(monitor, cpid, children, visited, out);
                out.push(monitor.target_of(child));
            }
        }
        walk(self, pid, &children, &mut visited, &mut out);
        out
    }

    pub fn exe_of(&self, pid: u32) -> Option<std::path::PathBuf> {
        self.system
            .process(Pid::from_u32(pid))
            .and_then(Process::exe)
            .map(Path::to_path_buf)
    }

    pub fn details(&mut self, pid: u32) -> Result<ProcessDetails, String> {
        let spid = Pid::from_u32(pid);
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[spid]),
            false,
            ProcessRefreshKind::nothing()
                .with_memory()
                .with_disk_usage()
                .with_user(UpdateKind::OnlyIfNotSet)
                .with_exe(UpdateKind::Always)
                .with_cmd(UpdateKind::Always)
                .with_cwd(UpdateKind::Always)
                .with_environ(UpdateKind::Always),
        );
        let p = self
            .system
            .process(spid)
            .filter(|p| p.exists())
            .ok_or_else(|| "the process no longer exists".to_string())?;

        let target = self.target_of(p);
        let parent = p.parent().and_then(|ppid| {
            self.system.process(ppid).map(|pp| ProcessRef {
                pid: ppid.as_u32(),
                name: display_name(&pp.name().to_string_lossy(), pp.exe()),
            })
        });
        let (priority, nice) = match platform::priority(pid) {
            Some((priority, nice)) => (Some(priority), nice),
            None => (None, None),
        };
        let disk = p.disk_usage();

        Ok(ProcessDetails {
            pid,
            name: target.name,
            exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
            command: p
                .cmd()
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect(),
            cwd: p.cwd().map(|c| c.to_string_lossy().into_owned()),
            environment: p
                .environ()
                .iter()
                .filter_map(|e| {
                    let e = e.to_string_lossy();
                    let (key, value) = e.split_once('=')?;
                    Some(EnvVar {
                        key: key.to_string(),
                        value: value.to_string(),
                    })
                })
                .collect(),
            parent,
            user: self.user_name(p),
            owner: target.owner,
            status: p.status().into(),
            start_time: p.start_time(),
            run_time: p.run_time(),
            cpu_time: p.accumulated_cpu_time(),
            memory: p.memory(),
            virtual_memory: p.virtual_memory(),
            priority,
            nice,
            open_files: p.open_files().map(|n| n as u32),
            total_disk_read: disk.total_read_bytes,
            total_disk_written: disk.total_written_bytes,
            threads: platform::threads(pid),
            modules: platform::modules(pid),
            handles: platform::handles(pid),
            protected: target.protected,
        })
    }
}

fn list_refresh_kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing()
        .with_cpu()
        .with_memory()
        .with_disk_usage()
        .with_exe(UpdateKind::OnlyIfNotSet)
        .with_cmd(UpdateKind::OnlyIfNotSet)
        .with_user(UpdateKind::OnlyIfNotSet)
        .with_tasks()
}

/// `sysinfo`'s task list on Linux holds the *other* threads of a process;
/// the main thread (whose TID is the PID) counts too.
pub(crate) fn thread_count(tasks: &HashSet<Pid>, pid: Pid) -> u32 {
    tasks.len() as u32 + u32::from(!tasks.contains(&pid))
}

fn join_command(p: &Process) -> String {
    p.cmd()
        .iter()
        .map(|a| a.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Linux truncates process names to 15 bytes (`gnome-shell-cal`); when
/// the executable's file name continues the truncated one, show that.
pub(crate) fn display_name(name: &str, exe: Option<&Path>) -> String {
    if name.len() >= 15 {
        if let Some(file) = exe.and_then(Path::file_name).map(|f| f.to_string_lossy()) {
            if file.starts_with(name) {
                return file.into_owned();
            }
        }
    }
    name.to_string()
}

pub(crate) fn per_second(bytes: u64, secs: f64) -> u64 {
    (bytes as f64 / secs).round() as u64
}

fn is_loopback(name: &str) -> bool {
    name == "lo" || name.starts_with("lo0") || name.to_ascii_lowercase().contains("loopback")
}

fn load_average() -> Option<LoadAverage> {
    if cfg!(windows) {
        // sysinfo reports zeros on Windows, which has no load average.
        return None;
    }
    let l = System::load_average();
    Some(LoadAverage {
        one: l.one,
        five: l.five,
        fifteen: l.fifteen,
    })
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widens_truncated_linux_names_from_the_executable() {
        let exe = Path::new("/usr/libexec/gnome-shell-calendar-server");
        assert_eq!(
            display_name("gnome-shell-cal", Some(exe)),
            "gnome-shell-calendar-server"
        );
        // Short names and names that don't match the executable stay.
        assert_eq!(
            display_name("bash", Some(Path::new("/usr/bin/bash"))),
            "bash"
        );
        assert_eq!(
            display_name("python3.12-scri", Some(Path::new("/usr/bin/python3.12"))),
            "python3.12-scri"
        );
    }

    #[test]
    fn the_main_thread_counts() {
        let pid = Pid::from_u32(10);
        assert_eq!(thread_count(&HashSet::new(), pid), 1);
        assert_eq!(thread_count(&HashSet::from([Pid::from_u32(11)]), pid), 2);
        assert_eq!(
            thread_count(&HashSet::from([pid, Pid::from_u32(11)]), pid),
            2
        );
    }

    #[test]
    fn rates_use_the_measured_interval() {
        assert_eq!(per_second(1000, 0.5), 2000);
        assert_eq!(per_second(0, 1.0), 0);
        assert_eq!(per_second(3000, 1.5), 2000);
    }

    #[test]
    fn recognizes_loopback_interfaces() {
        assert!(is_loopback("lo"));
        assert!(is_loopback("lo0"));
        assert!(is_loopback("Loopback Pseudo-Interface 1"));
        assert!(!is_loopback("eth0"));
        assert!(!is_loopback("wlo1"));
    }

    #[test]
    fn snapshot_contains_this_very_process() {
        let mut monitor = Monitor::new();
        std::thread::sleep(MIN_INTERVAL);
        let snapshot = monitor.snapshot();
        let me = std::process::id();
        let row = snapshot
            .processes
            .iter()
            .find(|p| p.pid == me)
            .expect("own process listed");
        assert_eq!(row.owner, Owner::Current);
        assert!(row.protected, "MoonTask must protect itself");
        assert!(row.memory > 0);
        assert!(snapshot.memory.total > 0);
        if cfg!(target_os = "linux") {
            let expected = std::fs::read_dir("/proc/self/task").unwrap().count() as u32;
            // The test harness may start or end a thread in between.
            assert!(
                row.threads.unwrap().abs_diff(expected) <= 2,
                "{:?} vs {expected}",
                row.threads
            );
        }
        assert!(!snapshot.cpu.cores.is_empty());
        assert_eq!(snapshot.process_count, snapshot.processes.len());
        // Threads are folded into their process, never listed on their own.
        let pids: HashSet<u32> = snapshot.processes.iter().map(|p| p.pid).collect();
        assert_eq!(pids.len(), snapshot.processes.len());
    }

    #[test]
    fn a_too_early_snapshot_repeats_the_last_one() {
        let mut monitor = Monitor::new();
        std::thread::sleep(MIN_INTERVAL);
        let first = monitor.snapshot();
        let second = monitor.snapshot();
        assert_eq!(first.timestamp, second.timestamp);
    }

    #[test]
    fn details_of_this_process() {
        let mut monitor = Monitor::new();
        let details = monitor.details(std::process::id()).unwrap();
        assert!(!details.command.is_empty());
        assert!(details.protected);
        if cfg!(target_os = "linux") {
            assert!(details.threads.as_ref().is_some_and(|t| !t.is_empty()));
            assert!(details.modules.as_ref().is_some_and(|m| !m.is_empty()));
            assert!(details.handles.is_some());
            assert!(details.nice.is_some());
        }
    }

    #[test]
    fn descendants_come_before_their_parents() {
        let mut child = std::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" })
            .args(if cfg!(windows) {
                vec!["/C", "ping -n 5 127.0.0.1 > NUL"]
            } else {
                vec!["-c", "sleep 5"]
            })
            .spawn()
            .unwrap();
        let monitor = Monitor::new();
        let found = monitor.descendants(std::process::id());
        child.kill().ok();
        child.wait().ok();
        assert!(found.iter().any(|t| t.pid == child.id()));
    }
}
