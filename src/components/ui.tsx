import type { ReactNode } from "react";
import type { Owner, ProcessState } from "@/types/models";
import { OWNER_LABELS, PROCESS_STATE_LABELS } from "@/lib/labels";

/** A titled glass panel — the basic building block of every view. */
export function Card({
  title,
  actions,
  children,
  className = "",
  bodyClassName = "p-4",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`mt-glass flex min-w-0 flex-col ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-(--mt-border) px-4 py-2">
          {title && <h2 className="mt-eyebrow">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** A small colored dot for whose process a row is; the color is always
 * paired with the owner name in its tooltip and accessible label. */
export function OwnerDot({ owner }: { owner: Owner }) {
  return (
    <span
      role="img"
      aria-label={OWNER_LABELS[owner]}
      title={OWNER_LABELS[owner]}
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: `var(--mt-owner-${owner})` }}
    />
  );
}

export function StateText({ state }: { state: ProcessState }) {
  const tone =
    state === "running"
      ? "text-(--mt-success)"
      : state === "stopped" || state === "zombie"
        ? "text-(--mt-warning)"
        : "text-(--mt-text-muted)";
  return <span className={tone}>{PROCESS_STATE_LABELS[state]}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-sm text-sm text-(--mt-text-muted)">{children}</p>}
    </div>
  );
}

/** Label/value pairs in two aligned columns. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-(--mt-text-muted)">{k}</dt>
          <dd className="m-0 min-w-0 break-words">{v ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A segmented control: one choice out of a few, as toggle buttons. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex gap-0.5 self-start rounded-[0.7rem] border border-(--mt-border) bg-(--mt-inset) p-0.5"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-[0.55rem] px-2.5 text-xs font-medium transition-colors duration-150 ${
              selected
                ? "bg-(--mt-selected) text-(--mt-accent) shadow-[inset_0_0_0_1px_rgb(185_174_251/0.35)]"
                : "text-(--mt-text-muted) hover:text-(--mt-text)"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A search field with a leading icon. */
export function SearchField({
  value,
  onChange,
  placeholder,
  inputRef,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: React.Ref<HTMLInputElement>;
  label: string;
}) {
  return (
    <label className="relative flex min-w-0 flex-1 items-center">
      <span className="sr-only">{label}</span>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 text-(--mt-text-faint)"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-input w-full pl-8"
      />
    </label>
  );
}
