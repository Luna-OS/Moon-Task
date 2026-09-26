//! Linux: NVIDIA cards through NVML (loaded at run time, so a machine
//! without the NVIDIA driver just has none), AMD and Intel cards through
//! `/sys/class/drm`.

use super::{pci_ids_lookup, vendor_name, GpuReading};
use crate::models::{Gpu, GpuEngine};
use nvml_wrapper::enum_wrappers::device::TemperatureSensor;
use nvml_wrapper::Nvml;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const NVIDIA: u16 = 0x10de;
const PCI_IDS: &[&str] = &["/usr/share/hwdata/pci.ids", "/usr/share/misc/pci.ids"];

struct DrmCard {
    device: PathBuf,
    vendor: u16,
    name: String,
}

pub struct LinuxGpus {
    nvml: Option<Nvml>,
    /// Per NVIDIA device: the newest process sample already counted.
    nvml_seen: HashMap<u32, u64>,
    cards: Vec<DrmCard>,
}

fn read_trim(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

fn read_u64(path: &Path) -> Option<u64> {
    read_trim(path)?.parse().ok()
}

fn hex_u16(path: &Path) -> Option<u16> {
    u16::from_str_radix(read_trim(path)?.trim_start_matches("0x"), 16).ok()
}

/// The graphics cards under `/sys/class/drm` (`card0`, `card1`, … — not
/// their connectors like `card0-HDMI-A-1`).
fn drm_cards() -> Vec<DrmCard> {
    let db = PCI_IDS.iter().find_map(|p| fs::read_to_string(p).ok());
    let mut cards: Vec<(u32, DrmCard)> = fs::read_dir("/sys/class/drm")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let index: u32 = name.strip_prefix("card")?.parse().ok()?;
            let device = entry.path().join("device");
            let vendor = hex_u16(&device.join("vendor"))?;
            let device_id = hex_u16(&device.join("device"));
            let model = device_id
                .and_then(|id| db.as_deref().and_then(|db| pci_ids_lookup(db, vendor, id)));
            let vendor_label = vendor_name(u32::from(vendor));
            let name = match (vendor_label, model) {
                (Some(v), Some(m)) => format!("{v} {m}"),
                (None, Some(m)) => m,
                (Some(v), None) => format!("{v} GPU"),
                (None, None) => format!("GPU {index}"),
            };
            Some((
                index,
                DrmCard {
                    device,
                    vendor,
                    name,
                },
            ))
        })
        .collect();
    cards.sort_by_key(|(index, _)| *index);
    cards.into_iter().map(|(_, card)| card).collect()
}

/// The first hwmon temperature of a card, in °C.
fn hwmon_temperature(device: &Path) -> Option<f32> {
    fs::read_dir(device.join("hwmon"))
        .ok()?
        .flatten()
        .find_map(|hwmon| read_u64(&hwmon.path().join("temp1_input")))
        .map(|milli| milli as f32 / 1000.0)
}

impl LinuxGpus {
    pub fn new() -> Self {
        let nvml = Nvml::init().ok();
        let cards = drm_cards()
            .into_iter()
            // NVML covers NVIDIA cards with far better data.
            .filter(|c| !(nvml.is_some() && c.vendor == NVIDIA))
            .collect();
        LinuxGpus {
            nvml,
            nvml_seen: HashMap::new(),
            cards,
        }
    }

    pub fn refresh(&mut self) -> GpuReading {
        let mut reading = GpuReading::default();
        if let Some(nvml) = &self.nvml {
            let count = nvml.device_count().unwrap_or(0);
            for index in 0..count {
                let Ok(device) = nvml.device_by_index(index) else {
                    continue;
                };
                let utilization = device.utilization_rates().ok();
                let memory = device.memory_info().ok();
                // Per-process samples since the last refresh (Maxwell+).
                let since = self.nvml_seen.get(&index).copied();
                if let Ok(samples) = device.process_utilization_stats(since) {
                    reading.per_process_supported = true;
                    for s in samples {
                        let seen = self.nvml_seen.entry(index).or_insert(0);
                        *seen = (*seen).max(s.timestamp);
                        let load = s.sm_util.max(s.enc_util).max(s.dec_util).min(100) as f32;
                        let slot = reading.per_process.entry(s.pid).or_insert(0.0);
                        *slot = slot.max(load);
                    }
                }
                let engines = utilization
                    .as_ref()
                    .map(|u| {
                        vec![
                            GpuEngine {
                                name: "Graphics & compute".into(),
                                utilization: u.gpu as f32,
                            },
                            GpuEngine {
                                name: "Memory controller".into(),
                                utilization: u.memory as f32,
                            },
                        ]
                    })
                    .unwrap_or_default();
                reading.gpus.push(Gpu {
                    name: device
                        .name()
                        .map(|n| {
                            if n.starts_with("NVIDIA") {
                                n
                            } else {
                                format!("NVIDIA {n}")
                            }
                        })
                        .unwrap_or_else(|_| format!("NVIDIA GPU {index}")),
                    vendor: Some("NVIDIA"),
                    utilization: utilization.map(|u| u.gpu as f32),
                    engines,
                    memory_used: memory.as_ref().map(|m| m.used),
                    memory_total: memory.as_ref().map(|m| m.total),
                    shared_used: None,
                    shared_total: None,
                    temperature: device
                        .temperature(TemperatureSensor::Gpu)
                        .ok()
                        .map(|t| t as f32),
                });
            }
        }

        for card in &self.cards {
            // amdgpu exposes its load and VRAM; i915/xe don't have a
            // simple busy counter, so Intel cards show name and temperature.
            let busy = read_u64(&card.device.join("gpu_busy_percent")).map(|b| b.min(100) as f32);
            reading.gpus.push(Gpu {
                name: card.name.clone(),
                vendor: vendor_name(u32::from(card.vendor)),
                utilization: busy,
                engines: busy
                    .map(|b| {
                        vec![GpuEngine {
                            name: "Graphics & compute".into(),
                            utilization: b,
                        }]
                    })
                    .unwrap_or_default(),
                memory_used: read_u64(&card.device.join("mem_info_vram_used")),
                memory_total: read_u64(&card.device.join("mem_info_vram_total")),
                shared_used: read_u64(&card.device.join("mem_info_gtt_used")),
                shared_total: read_u64(&card.device.join("mem_info_gtt_total")),
                temperature: hwmon_temperature(&card.device),
            });
        }
        reading
    }
}
