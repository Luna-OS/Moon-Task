import type { ReactNode } from "react";
import { CloseIcon } from "@/components/icons";

const TONES = {
  warning: "border-warning-400/35 bg-warning-400/8 text-(--mt-warning)",
  error: "border-error-500/40 bg-error-500/10 text-(--mt-danger)",
  success: "border-mint-400/35 bg-mint-400/10 text-(--mt-success)",
  info: "border-lavender-400/30 bg-lavender-400/8 text-(--mt-accent)",
};

export type BannerTone = keyof typeof TONES;

export function Banner({
  tone,
  icon,
  onClose,
  children,
}: {
  tone: BannerTone;
  icon?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-xl border px-4 py-2.5 text-sm backdrop-blur-md ${TONES[tone]}`}
    >
      {icon && <span className="mt-0.5">{icon}</span>}
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Dismiss"
          className="mt-0.5 rounded-md opacity-70 hover:opacity-100"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
