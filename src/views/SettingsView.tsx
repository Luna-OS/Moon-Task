import { useId, type ReactNode } from "react";
import { REFRESH_CHOICES, type Settings, type Theme } from "@/lib/settings";
import type { SystemInfo } from "@/types/models";
import { Card, Facts, Segmented } from "@/components/ui";

const SHORTCUTS: [string, string][] = [
  ["Ctrl 1 … 6", "Switch section"],
  ["/  or  Ctrl F", "Search processes"],
  ["↑ ↓  Page ↑ ↓  Home End", "Move through the process list"],
  ["← →", "Collapse / expand a branch"],
  ["Delete", "End the selected process"],
  ["Shift Delete", "Force kill the selected process"],
  ["Space", "Pause / resume live updates"],
  ["F5", "Refresh now"],
  ["Escape", "Clear search, then selection"],
];

export function SettingsView({
  settings,
  onChange,
  info,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  info: SystemInfo | null;
}) {
  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <Card title="Live updates">
        <Row
          label="Refresh interval"
          hint="How often MoonTask measures. Faster means smoother charts and a little more CPU for MoonTask itself."
        >
          <Segmented
            label="Refresh interval"
            value={settings.refreshMs}
            onChange={(refreshMs) => onChange({ refreshMs })}
            options={REFRESH_CHOICES.map((ms) => ({
              value: ms,
              label: ms < 1000 ? `${ms} ms` : `${ms / 1000} s`,
            }))}
          />
        </Row>
      </Card>

      <Card title="Appearance">
        <Row label="Theme" hint="The night sky is the default; “System” follows your OS setting.">
          <Segmented<Theme>
            label="Theme"
            value={settings.theme}
            onChange={(theme) => onChange({ theme })}
            options={[
              { value: "dark", label: "Night" },
              { value: "light", label: "Day" },
              { value: "system", label: "System" },
            ]}
          />
        </Row>
      </Card>

      <Card title="Processes">
        <div className="flex flex-col gap-4">
          <Toggle
            label="Ask before ending my own processes"
            hint="Ending someone else's process, a system process or a whole tree always asks first."
            checked={settings.confirmOwn}
            onChange={(confirmOwn) => onChange({ confirmOwn })}
          />
          <Toggle
            label="Show kernel threads"
            hint="Linux lists hundreds of kernel workers (kworker, ksoftirqd …). Hidden by default to keep the list calm."
            checked={settings.showKernel}
            onChange={(showKernel) => onChange({ showKernel })}
          />
        </div>
      </Card>

      <Card title="Keyboard">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt>
                <span className="mt-kbd">{keys}</span>
              </dt>
              <dd className="m-0 text-(--mt-text-muted)">{what}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="About MoonTask" className="lg:col-span-2">
        <div className="flex items-start gap-4">
          <img src="/moontask-logo.svg" alt="" className="size-14" />
          <div className="flex flex-col gap-3">
            <p className="text-sm text-(--mt-text-muted)">
              MoonTask – every process, calmly under the moon. An open-source task manager for
              Windows and Linux. It only ever talks to your own machine: no telemetry, no network
              access of its own.
            </p>
            <Facts
              items={[
                ["Version", info?.appVersion ?? "–"],
                ["Platform", info ? `${info.platform} · ${info.arch}` : "–"],
                ["MoonTask PID", info?.selfPid ?? "–"],
              ]}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      <p className="text-xs text-(--mt-text-muted)">{hint}</p>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div className="flex flex-col gap-0.5">
      <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 accent-lavender-400"
        />
        {label}
      </label>
      <p id={hintId} className="pl-7 text-xs text-(--mt-text-muted)">
        {hint}
      </p>
    </div>
  );
}
