//! Windows: GPU load and memory from the performance counters Task Manager
//! uses, adapter names and sizes from DXGI.

use super::GpuReading;
use super::{aggregate, luid_key, parse_adapter_instance, parse_engine_instance, vendor_name};
use crate::models::Gpu;
use std::collections::HashMap;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};
use windows_sys::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
    PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
    PDH_MORE_DATA,
};

const MICROSOFT_VENDOR: u32 = 0x1414;

struct Adapter {
    luid: String,
    name: String,
    vendor: Option<&'static str>,
    dedicated: u64,
    shared: u64,
}

/// An open PDH query with its three wildcard counters.
struct Counters {
    query: PDH_HQUERY,
    engine: PDH_HCOUNTER,
    dedicated: PDH_HCOUNTER,
    shared: PDH_HCOUNTER,
}

// SAFETY: PDH query and counter handles may be used from any thread; the
// monitor owning them is only ever used by one thread at a time (Mutex).
unsafe impl Send for Counters {}

impl Drop for Counters {
    fn drop(&mut self) {
        // SAFETY: the query was opened by `Counters::open` and not closed yet.
        unsafe { PdhCloseQuery(self.query) };
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

impl Counters {
    fn open() -> Option<Self> {
        let mut query: PDH_HQUERY = std::ptr::null_mut();
        // SAFETY: out-pointer to a local; null data source = live data.
        if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) } != 0 {
            return None;
        }
        let add = |path: &str| -> Option<PDH_HCOUNTER> {
            let path = wide(path);
            let mut counter: PDH_HCOUNTER = std::ptr::null_mut();
            // SAFETY: `query` is open, `path` is NUL-terminated UTF-16.
            let status = unsafe { PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) };
            (status == 0).then_some(counter)
        };
        // Windows 10 1709+; older systems have no GPU counters at all.
        let counters = (|| {
            Some(Counters {
                query,
                engine: add(r"\GPU Engine(*)\Utilization Percentage")?,
                dedicated: add(r"\GPU Adapter Memory(*)\Dedicated Usage")?,
                shared: add(r"\GPU Adapter Memory(*)\Shared Usage")?,
            })
        })();
        let Some(counters) = counters else {
            // SAFETY: opened above, not stored anywhere.
            unsafe { PdhCloseQuery(query) };
            return None;
        };
        // Utilization is a rate: it needs a first sample to diff against.
        // SAFETY: the query is open.
        unsafe { PdhCollectQueryData(counters.query) };
        Some(counters)
    }

    fn collect(&self) -> bool {
        // SAFETY: the query is open.
        unsafe { PdhCollectQueryData(self.query) == 0 }
    }

    /// All instances of a wildcard counter as (instance name, value).
    fn read(&self, counter: PDH_HCOUNTER) -> Vec<(String, f64)> {
        let mut size = 0u32;
        let mut count = 0u32;
        // SAFETY: a null buffer asks for the required size.
        let status = unsafe {
            PdhGetFormattedCounterArrayW(
                counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                std::ptr::null_mut(),
            )
        };
        if status != PDH_MORE_DATA || size == 0 {
            return Vec::new();
        }
        // The buffer holds `count` items followed by their name strings;
        // u64 storage keeps it 8-byte aligned for the f64 values.
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let items = buffer.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
        // SAFETY: `buffer` holds at least `size` bytes, as PDH asked for.
        let status = unsafe {
            PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, items)
        };
        if status != 0 {
            return Vec::new();
        }
        (0..count as usize)
            .filter_map(|i| {
                // SAFETY: PDH wrote `count` items into the buffer.
                let item = unsafe { &*items.add(i) };
                // 0 = valid data, 1 = new data; anything else is an error.
                if item.FmtValue.CStatus > 1 || item.szName.is_null() {
                    return None;
                }
                // SAFETY: szName points to a NUL-terminated string inside
                // the same buffer.
                let name = unsafe {
                    let mut len = 0;
                    while *item.szName.add(len) != 0 {
                        len += 1;
                    }
                    String::from_utf16_lossy(std::slice::from_raw_parts(item.szName, len))
                };
                // SAFETY: PDH_FMT_DOUBLE fills the double member.
                let value = unsafe { item.FmtValue.Anonymous.doubleValue };
                Some((name, value))
            })
            .collect()
    }
}

fn adapters() -> Vec<Adapter> {
    // SAFETY: plain factory creation; needs no COM initialization.
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return Vec::new();
    };
    let mut out: Vec<Adapter> = Vec::new();
    for index in 0.. {
        // SAFETY: EnumAdapters1 fails with DXGI_ERROR_NOT_FOUND past the end.
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        // SAFETY: `adapter` is a valid adapter from the factory.
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        // "Microsoft Basic Render Driver" and other software adapters.
        if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0
            || desc.VendorId == MICROSOFT_VENDOR
        {
            continue;
        }
        let luid = luid_key(desc.AdapterLuid.HighPart, desc.AdapterLuid.LowPart);
        // One card can show up once per output; keep it once.
        if out.iter().any(|a| a.luid == luid) {
            continue;
        }
        let len = desc.Description.iter().position(|&c| c == 0).unwrap_or(128);
        out.push(Adapter {
            luid,
            name: String::from_utf16_lossy(&desc.Description[..len])
                .trim()
                .to_string(),
            vendor: vendor_name(desc.VendorId),
            dedicated: desc.DedicatedVideoMemory as u64,
            shared: desc.SharedSystemMemory as u64,
        });
    }
    out
}

pub struct WindowsGpus {
    adapters: Vec<Adapter>,
    counters: Option<Counters>,
}

impl WindowsGpus {
    pub fn new() -> Self {
        WindowsGpus {
            adapters: adapters(),
            counters: Counters::open(),
        }
    }

    pub fn refresh(&mut self) -> GpuReading {
        let Some(counters) = self.counters.as_ref().filter(|c| c.collect()) else {
            return GpuReading {
                gpus: self
                    .adapters
                    .iter()
                    .map(|a| to_gpu(a, None, None, None, &[]))
                    .collect(),
                ..Default::default()
            };
        };

        let samples: Vec<_> = counters
            .read(counters.engine)
            .into_iter()
            .filter_map(|(name, v)| Some((parse_engine_instance(&name)?, v)))
            .collect();
        let agg = aggregate(&samples);
        let memory = |counter| -> HashMap<String, u64> {
            let mut by_luid = HashMap::new();
            for (name, value) in counters.read(counter) {
                if let Some(luid) = parse_adapter_instance(&name) {
                    *by_luid.entry(luid).or_insert(0) += value.max(0.0) as u64;
                }
            }
            by_luid
        };
        let dedicated = memory(counters.dedicated);
        let shared = memory(counters.shared);

        GpuReading {
            gpus: self
                .adapters
                .iter()
                .map(|a| {
                    to_gpu(
                        a,
                        Some(agg.adapter.get(&a.luid).copied().unwrap_or(0.0)),
                        dedicated.get(&a.luid).copied(),
                        shared.get(&a.luid).copied(),
                        agg.engines.get(&a.luid).map_or(&[][..], Vec::as_slice),
                    )
                })
                .collect(),
            per_process: agg.per_process,
            per_process_supported: true,
        }
    }
}

fn to_gpu(
    a: &Adapter,
    utilization: Option<f32>,
    dedicated_used: Option<u64>,
    shared_used: Option<u64>,
    engines: &[crate::models::GpuEngine],
) -> Gpu {
    Gpu {
        name: a.name.clone(),
        vendor: a.vendor,
        utilization,
        engines: engines.to_vec(),
        // Integrated GPUs report no (or a tiny) dedicated memory.
        memory_total: (a.dedicated > 0).then_some(a.dedicated),
        memory_used: dedicated_used,
        shared_total: (a.shared > 0).then_some(a.shared),
        shared_used,
        temperature: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_gpus_never_fails() {
        // CI runners may have no GPU (or only the basic render driver);
        // this must simply return what exists, twice in a row.
        let mut gpus = WindowsGpus::new();
        let _ = gpus.refresh();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let reading = gpus.refresh();
        for gpu in &reading.gpus {
            assert!(!gpu.name.is_empty());
        }
    }
}
