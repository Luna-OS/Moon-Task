const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

/** Formats a byte count as a human-readable IEC size (GiB/MiB/...). */
export function formatBytes(bytes: number, precision?: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let unit = 0;
  let value = bytes;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = precision ?? (unit === 0 ? 0 : value >= 100 ? 0 : 1);
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${UNITS[unit]}`;
}

/** Bytes per second; tiny rates read as "0 B/s" instead of noise. */
export function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 1) return "0 B/s";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "–";
  return `${value.toFixed(digits)} %`;
}

/** A duration in seconds as the two largest units: "3d 4h", "12m 5s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** CPU time in milliseconds as h:mm:ss.t, like classic task managers. */
export function formatCpuTime(ms: number): string {
  const totalTenths = Math.floor(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${tenths}`;
}

/** Unix seconds as a local date and time. */
export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

/** Milliseconds since the epoch as a local wall-clock time. */
export function formatClock(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatFrequency(mhz: number): string {
  if (mhz <= 0) return "–";
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)} GHz` : `${mhz} MHz`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** A temperature in whole degrees Celsius, like Task Manager shows it. */
export function formatTemperature(celsius: number): string {
  return `${celsius.toFixed(0)} °C`;
}
