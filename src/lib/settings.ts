/**
 * User preferences, kept in the webview's localStorage. Every access is
 * guarded: storage can be unavailable, and a broken or old value must
 * never stop MoonTask from starting — it just falls back to defaults.
 */
import type { SortState, ViewMode } from "@/lib/processes";

export type Theme = "dark" | "light" | "system";

export interface Settings {
  /** Refresh interval in milliseconds. */
  refreshMs: number;
  theme: Theme;
  /** Also ask before ending the user's own processes. */
  confirmOwn: boolean;
  showKernel: boolean;
  viewMode: ViewMode;
  sort: SortState;
}

export const REFRESH_CHOICES = [500, 1000, 2000, 5000] as const;

export const DEFAULT_SETTINGS: Settings = {
  refreshMs: 1000,
  theme: "dark",
  confirmOwn: true,
  showKernel: false,
  viewMode: "tree",
  sort: { key: "cpu", dir: "desc" },
};

const KEY = "moontask.settings.v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitize(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not persisting a preference is harmless.
  }
}

/** Keeps known, valid fields and falls back to defaults for the rest. */
export function sanitize(input: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  const refreshMs = (REFRESH_CHOICES as readonly number[]).includes(input.refreshMs ?? -1)
    ? input.refreshMs!
    : d.refreshMs;
  const theme = input.theme === "light" || input.theme === "system" ? input.theme : d.theme;
  const viewMode =
    input.viewMode === "list" || input.viewMode === "apps" || input.viewMode === "tree"
      ? input.viewMode
      : d.viewMode;
  const sortKeys = ["name", "pid", "user", "cpu", "memory", "threads", "disk", "status"];
  const sort =
    input.sort && sortKeys.includes(input.sort.key) && ["asc", "desc"].includes(input.sort.dir)
      ? input.sort
      : d.sort;
  return {
    refreshMs,
    theme,
    confirmOwn: typeof input.confirmOwn === "boolean" ? input.confirmOwn : d.confirmOwn,
    showKernel: typeof input.showKernel === "boolean" ? input.showKernel : d.showKernel,
    viewMode,
    sort,
  };
}

export function resolveTheme(theme: Theme, prefersLight: boolean): "dark" | "light" {
  if (theme === "system") return prefersLight ? "light" : "dark";
  return theme;
}
