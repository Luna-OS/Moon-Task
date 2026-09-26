//! Graphics cards: load per engine, video memory, temperature, and how much
//! of the GPU each process uses.
//!
//! - Windows reads the same performance counters Task Manager shows
//!   (`GPU Engine`, `GPU Adapter Memory` through pdh.dll) and names the
//!   adapters through DXGI. Neither needs COM initialized, which matters:
//!   touching COM on the wrong thread is what crashed MoonTask 0.1.0.
//! - Linux asks NVML for NVIDIA cards and reads `/sys/class/drm` for
//!   AMD and Intel ones.
//!
//! The parsers and the aggregation below are pure and tested on every
//! platform; `windows.rs`/`linux.rs` only fetch the raw numbers.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod windows;

use crate::models::{Gpu, GpuEngine};
use std::collections::{BTreeMap, HashMap};

/// One refresh worth of GPU data.
#[derive(Debug, Default)]
pub struct GpuReading {
    pub gpus: Vec<Gpu>,
    /// Per-process GPU load, 0–100, for the processes that use a GPU.
    pub per_process: HashMap<u32, f32>,
    /// Whether this platform can attribute GPU load to processes at all
    /// (so the UI can hide the column instead of showing zeros).
    pub per_process_supported: bool,
}

pub struct GpuMonitor {
    #[cfg(windows)]
    inner: windows::WindowsGpus,
    #[cfg(target_os = "linux")]
    inner: linux::LinuxGpus,
}

impl GpuMonitor {
    pub fn new() -> Self {
        GpuMonitor {
            #[cfg(windows)]
            inner: windows::WindowsGpus::new(),
            #[cfg(target_os = "linux")]
            inner: linux::LinuxGpus::new(),
        }
    }

    pub fn refresh(&mut self) -> GpuReading {
        #[cfg(any(windows, target_os = "linux"))]
        return self.inner.refresh();
        #[cfg(not(any(windows, target_os = "linux")))]
        GpuReading::default()
    }
}

impl Default for GpuMonitor {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn vendor_name(vendor_id: u32) -> Option<&'static str> {
    match vendor_id {
        0x10de => Some("NVIDIA"),
        0x1002 | 0x1022 => Some("AMD"),
        0x8086 => Some("Intel"),
        0x5143 => Some("Qualcomm"),
        0x13b5 => Some("ARM"),
        0x1414 => Some("Microsoft"),
        _ => None,
    }
}

/// A temperature in tenths of a degree Celsius, as the Windows graphics
/// kernel reports it. 0 means "not reported"; implausible values are
/// dropped rather than shown.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn deci_celsius(raw: u32) -> Option<f32> {
    (1..=1500).contains(&raw).then(|| raw as f32 / 10.0)
}

/// An adapter's LUID in the form the Windows performance counters use in
/// their instance names: `luid_0x00000000_0x0000C4F2`.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn luid_key(high: i32, low: u32) -> String {
    format!("luid_0x{:08X}_0x{:08X}", high as u32, low)
}

/// A `GPU Engine` counter instance, e.g.
/// `pid_1234_luid_0x00000000_0x0000C4F2_phys_0_eng_3_engtype_VideoDecode`.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EngineInstance {
    pub pid: u32,
    /// `luid_0x…_0x…`, matching [`luid_key`].
    pub luid: String,
    pub engine: u32,
    pub engine_type: String,
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn parse_engine_instance(name: &str) -> Option<EngineInstance> {
    let rest = name.strip_prefix("pid_")?;
    let (pid, rest) = rest.split_once("_luid_")?;
    let (luid, rest) = rest.split_once("_phys_")?;
    let (_phys, rest) = rest.split_once("_eng_")?;
    let (engine, engine_type) = rest.split_once("_engtype_")?;
    Some(EngineInstance {
        pid: pid.parse().ok()?,
        luid: normalize_luid(luid)?,
        engine: engine.parse().ok()?,
        engine_type: engine_type.to_string(),
    })
}

/// A `GPU Adapter Memory` instance (`luid_0x…_0x…_phys_0`) → its LUID key.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn parse_adapter_instance(name: &str) -> Option<String> {
    let (luid, _phys) = name.split_once("_phys_")?;
    normalize_luid(luid.strip_prefix("luid_")?)
}

/// `0x00000000_0x0000c4f2` → `luid_0x00000000_0x0000C4F2` (counters use
/// either case; [`luid_key`] uses upper case).
#[cfg_attr(not(windows), allow(dead_code))]
fn normalize_luid(hex: &str) -> Option<String> {
    let (high, low) = hex.split_once('_')?;
    let part = |p: &str| -> Option<String> {
        let digits = p.strip_prefix("0x").or_else(|| p.strip_prefix("0X"))?;
        u32::from_str_radix(digits, 16).ok()?;
        Some(digits.to_ascii_uppercase())
    };
    Some(format!("luid_0x{}_0x{}", part(high)?, part(low)?))
}

/// Makes counter engine types readable: `Compute_0` → `Compute 0`,
/// `VideoDecode` → `Video Decode`.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn engine_label(engine_type: &str) -> String {
    let mut out = String::new();
    let mut prev_lower = false;
    for c in engine_type.chars() {
        if c == '_' {
            out.push(' ');
            prev_lower = false;
            continue;
        }
        if c.is_ascii_uppercase() && prev_lower {
            out.push(' ');
        }
        prev_lower = c.is_ascii_lowercase();
        out.push(c);
    }
    out
}

/// Turns per-(process, engine) utilization samples into what the UI shows,
/// the way Task Manager does:
///
/// - an engine's load is the sum over all processes using it;
/// - an adapter's load is its busiest engine's (not the sum — a GPU with
///   3D at 40 % and video decode at 30 % is not 70 % busy);
/// - a process' load is its busiest engine's.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) struct Aggregated {
    /// Per adapter LUID: engine label → load, busiest first.
    pub engines: HashMap<String, Vec<GpuEngine>>,
    /// Per adapter LUID: overall load.
    pub adapter: HashMap<String, f32>,
    pub per_process: HashMap<u32, f32>,
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn aggregate(samples: &[(EngineInstance, f64)]) -> Aggregated {
    // (luid, engine index) → (type, summed load)
    let mut per_engine: BTreeMap<(String, u32), (String, f64)> = BTreeMap::new();
    let mut per_process: HashMap<u32, f32> = HashMap::new();
    let mut per_process_engine: HashMap<(u32, String, u32), f64> = HashMap::new();

    for (inst, value) in samples {
        let value = value.max(0.0);
        let entry = per_engine
            .entry((inst.luid.clone(), inst.engine))
            .or_insert_with(|| (inst.engine_type.clone(), 0.0));
        entry.1 += value;
        *per_process_engine
            .entry((inst.pid, inst.luid.clone(), inst.engine))
            .or_insert(0.0) += value;
    }
    for ((pid, _, _), value) in per_process_engine {
        if pid == 0 {
            continue;
        }
        let v = per_process.entry(pid).or_insert(0.0);
        *v = v.max(value.min(100.0) as f32);
    }

    // Per adapter, per engine *type*: the busiest engine of that type.
    let mut by_type: HashMap<String, BTreeMap<String, f32>> = HashMap::new();
    for ((luid, _), (engine_type, value)) in per_engine {
        let label = engine_label(&engine_type);
        let slot = by_type.entry(luid).or_default().entry(label).or_insert(0.0);
        *slot = slot.max(value.min(100.0) as f32);
    }

    let mut engines = HashMap::new();
    let mut adapter = HashMap::new();
    for (luid, types) in by_type {
        let mut list: Vec<GpuEngine> = types
            .into_iter()
            .map(|(name, utilization)| GpuEngine { name, utilization })
            .collect();
        list.sort_by(|a, b| {
            b.utilization
                .total_cmp(&a.utilization)
                .then_with(|| a.name.cmp(&b.name))
        });
        let top = list.first().map_or(0.0, |e| e.utilization);
        adapter.insert(luid.clone(), top);
        engines.insert(luid, list);
    }
    Aggregated {
        engines,
        adapter,
        per_process,
    }
}

/// Looks a PCI device up in a `pci.ids` database (shipped by hwdata /
/// pciutils on Linux), for a real model name like "Navi 22 [Radeon RX 6700 XT]".
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn pci_ids_lookup(db: &str, vendor: u16, device: u16) -> Option<String> {
    let vendor_hex = format!("{vendor:04x}");
    let device_hex = format!("{device:04x}");
    let mut in_vendor = false;
    for line in db.lines() {
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if !line.starts_with('\t') {
            if in_vendor {
                return None;
            }
            in_vendor = line.starts_with(&vendor_hex);
            continue;
        }
        if in_vendor && !line.starts_with("\t\t") {
            let entry = &line[1..];
            if let Some(name) = entry.strip_prefix(&device_hex) {
                return Some(name.trim().to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deci_celsius_converts_and_drops_unreported_values() {
        assert_eq!(deci_celsius(523), Some(52.3));
        assert_eq!(deci_celsius(0), None);
        assert_eq!(deci_celsius(u32::MAX), None);
    }

    fn inst(pid: u32, engine: u32, engine_type: &str) -> EngineInstance {
        EngineInstance {
            pid,
            luid: "luid_0x00000000_0x0000C4F2".into(),
            engine,
            engine_type: engine_type.into(),
        }
    }

    #[test]
    fn parses_engine_instances() {
        let parsed = parse_engine_instance(
            "pid_1234_luid_0x00000000_0x0000c4f2_phys_0_eng_3_engtype_VideoDecode",
        )
        .unwrap();
        assert_eq!(parsed.pid, 1234);
        assert_eq!(parsed.luid, "luid_0x00000000_0x0000C4F2");
        assert_eq!(parsed.engine, 3);
        assert_eq!(parsed.engine_type, "VideoDecode");
        assert_eq!(parse_engine_instance("_Total"), None);
        assert_eq!(
            parse_engine_instance("pid_x_luid_a_phys_0_eng_0_engtype_3D"),
            None
        );
    }

    #[test]
    fn parses_adapter_instances_and_matches_dxgi_luids() {
        let key = parse_adapter_instance("luid_0x00000000_0x0000c4f2_phys_0").unwrap();
        assert_eq!(key, "luid_0x00000000_0x0000C4F2");
        assert_eq!(luid_key(0, 0xC4F2), key);
        assert_eq!(luid_key(-1, 1), "luid_0xFFFFFFFF_0x00000001");
    }

    #[test]
    fn labels_engine_types() {
        assert_eq!(engine_label("3D"), "3D");
        assert_eq!(engine_label("VideoDecode"), "Video Decode");
        assert_eq!(engine_label("Compute_0"), "Compute 0");
    }

    #[test]
    fn aggregates_like_task_manager() {
        let samples = vec![
            // Two processes share the 3D engine: its load is their sum.
            (inst(10, 0, "3D"), 30.0),
            (inst(20, 0, "3D"), 15.0),
            // Video decode runs on its own engine.
            (inst(20, 3, "VideoDecode"), 60.0),
            (inst(30, 1, "Copy"), 2.0),
        ];
        let agg = aggregate(&samples);
        let luid = "luid_0x00000000_0x0000C4F2";
        // The adapter is as busy as its busiest engine, not the sum.
        assert_eq!(agg.adapter[luid], 60.0);
        let engines = &agg.engines[luid];
        assert_eq!(engines[0].name, "Video Decode");
        assert_eq!(engines[1].name, "3D");
        assert_eq!(engines[1].utilization, 45.0);
        // A process counts its busiest engine.
        assert_eq!(agg.per_process[&20], 60.0);
        assert_eq!(agg.per_process[&10], 30.0);
        assert_eq!(agg.per_process[&30], 2.0);
    }

    #[test]
    fn caps_and_ignores_garbage() {
        let samples = vec![(inst(1, 0, "3D"), 180.0), (inst(0, 0, "3D"), -5.0)];
        let agg = aggregate(&samples);
        assert_eq!(agg.adapter["luid_0x00000000_0x0000C4F2"], 100.0);
        assert!(!agg.per_process.contains_key(&0));
    }

    #[test]
    fn looks_up_pci_names() {
        let db = "\
# comment
1002  Advanced Micro Devices, Inc. [AMD/ATI]
\t73df  Navi 22 [Radeon RX 6700/6700 XT/6750 XT / 6800M/6850M XT]
\t\t1002 0e36  Radeon RX 6700 XT
10de  NVIDIA Corporation
\t2684  AD102 [GeForce RTX 4090]
";
        assert_eq!(
            pci_ids_lookup(db, 0x1002, 0x73df).as_deref(),
            Some("Navi 22 [Radeon RX 6700/6700 XT/6750 XT / 6800M/6850M XT]")
        );
        assert_eq!(
            pci_ids_lookup(db, 0x10de, 0x2684).as_deref(),
            Some("AD102 [GeForce RTX 4090]")
        );
        assert_eq!(pci_ids_lookup(db, 0x1002, 0xffff), None);
        assert_eq!(pci_ids_lookup(db, 0x8086, 0x73df), None);
    }

    #[test]
    fn names_vendors() {
        assert_eq!(vendor_name(0x10de), Some("NVIDIA"));
        assert_eq!(vendor_name(0x1002), Some("AMD"));
        assert_eq!(vendor_name(0x8086), Some("Intel"));
        assert_eq!(vendor_name(0x1234), None);
    }
}
