import { useId, useState, type PointerEvent } from "react";
import { formatClock } from "@/lib/format";
import { HISTORY_LENGTH } from "@/lib/history";
import { niceMax } from "@/lib/scale";

/**
 * Hand-rolled SVG time-series charts. One y-axis, thin 2px lines over a
 * faint area, a recessive grid, newest value at the right edge; hovering
 * shows a crosshair with every series' value at that moment.
 *
 * Series colors come from --mt-chart-1/2, validated for color-blind
 * separation in both themes. With two series a legend with the current
 * values is always shown, so identity never rests on color alone.
 */

export interface Series {
  label: string;
  values: number[];
  /** 1 = the main measure, 2 = its pair (e.g. download vs upload). */
  tone: 1 | 2;
}

const VIEW_W = 100;

function xAt(i: number, count: number, capacity: number): number {
  const slot = capacity - count + i;
  return (slot / (capacity - 1)) * VIEW_W;
}

function paths(values: number[], max: number, height: number, capacity: number) {
  if (values.length === 0) return { line: "", area: "" };
  const pts = values.map((v, i) => {
    const y = height - (Math.min(Math.max(v, 0), max) / max) * height;
    return `${xAt(i, values.length, capacity).toFixed(3)},${y.toFixed(2)}`;
  });
  const line = `M${pts.join("L")}`;
  const firstX = xAt(0, values.length, capacity).toFixed(3);
  const area = `${line}L${VIEW_W},${height}L${firstX},${height}Z`;
  return { line, area };
}

function color(tone: 1 | 2): string {
  return tone === 1 ? "var(--mt-chart-1)" : "var(--mt-chart-2)";
}

export function AreaChart({
  series,
  timestamps,
  max,
  format,
  height = 180,
  label,
  capacity = HISTORY_LENGTH,
}: {
  series: Series[];
  timestamps: number[];
  /** Fixed top of the scale (e.g. 100 for percentages); auto if omitted. */
  max?: number;
  format: (value: number) => string;
  height?: number;
  label: string;
  capacity?: number;
}) {
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(0, ...series.flatMap((s) => s.values));
  const top = max ?? niceMax(peak * 1.1);
  const count = Math.max(0, ...series.map((s) => s.values.length));

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (count === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const slot = Math.round(fraction * (capacity - 1));
    const index = slot - (capacity - count);
    setHover(index >= 0 && index < count ? index : null);
  }

  const hoverX = hover === null ? null : (xAt(hover, count, capacity) / VIEW_W) * 100;

  return (
    <figure className="m-0 flex flex-col gap-2">
      {series.length > 1 && (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--mt-text-muted)">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-3.5 rounded-full"
                style={{ background: color(s.tone) }}
              />
              {s.label}
              <span className="font-medium text-(--mt-text) tabular-nums">
                {format(s.values.at(-1) ?? 0)}
              </span>
            </span>
          ))}
        </figcaption>
      )}
      <div
        className="relative select-none"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${label}: ${series
          .map((s) => `${s.label} ${format(s.values.at(-1) ?? 0)}`)
          .join(", ")}`}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            {series.map((s) => (
              <linearGradient
                key={s.tone}
                id={`${gradientId}-${s.tone}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={color(s.tone)} stopOpacity="0.32" />
                <stop offset="100%" stopColor={color(s.tone)} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2={VIEW_W}
              y1={height * f}
              y2={height * f}
              stroke="var(--mt-chart-grid)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1="0"
            x2={VIEW_W}
            y1={height - 0.5}
            y2={height - 0.5}
            stroke="var(--mt-border)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {series.map((s) => {
            const { line, area } = paths(s.values, top, height, capacity);
            return (
              <g key={s.label}>
                <path d={area} fill={`url(#${gradientId}-${s.tone})`} />
                <path
                  d={line}
                  fill="none"
                  stroke={color(s.tone)}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
        <span className="pointer-events-none absolute top-0.5 left-1.5 text-[0.6875rem] text-(--mt-text-faint) tabular-nums">
          {format(top)}
        </span>

        {hover !== null && hoverX !== null && (
          <>
            <span
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-(--mt-border-strong)"
              style={{ left: `${hoverX}%` }}
            />
            {series.map((s) => {
              const v = s.values[hover - (count - s.values.length)] ?? 0;
              const y = height - (Math.min(Math.max(v, 0), top) / top) * height;
              return (
                <span
                  key={s.label}
                  className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-(--mt-solid)"
                  style={{ left: `${hoverX}%`, top: y, background: color(s.tone) }}
                />
              );
            })}
            <div
              className="mt-glass pointer-events-none absolute top-2 z-10 flex min-w-32 flex-col gap-1 rounded-lg bg-(--mt-solid) px-3 py-2 text-xs"
              style={
                hoverX > 60 ? { right: `${100 - hoverX + 1.5}%` } : { left: `${hoverX + 1.5}%` }
              }
            >
              <span className="text-(--mt-text-muted)">
                {timestamps[hover - (count - timestamps.length)] !== undefined
                  ? formatClock(timestamps[hover - (count - timestamps.length)])
                  : ""}
              </span>
              {series.map((s) => (
                <span key={s.label} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ background: color(s.tone) }}
                    />
                    {s.label}
                  </span>
                  <span className="font-medium tabular-nums">
                    {format(s.values[hover - (count - s.values.length)] ?? 0)}
                  </span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </figure>
  );
}

/** A tiny, decorative trend line for stat tiles; the tile shows the value. */
export function Sparkline({
  values,
  max,
  height = 36,
  tone = 1,
  capacity = HISTORY_LENGTH,
}: {
  values: number[];
  max?: number;
  height?: number;
  tone?: 1 | 2;
  capacity?: number;
}) {
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const top = max ?? niceMax(Math.max(0, ...values) * 1.1);
  const { line, area } = paths(values, top, height, capacity);
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color(tone)} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color(tone)} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={color(tone)}
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A horizontal fill bar for a share (0..1), e.g. a volume's used space. */
export function Meter({ fraction, label }: { fraction: number; label: string }) {
  const pct = Math.min(1, Math.max(0, fraction)) * 100;
  return (
    <div
      className="mt-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
