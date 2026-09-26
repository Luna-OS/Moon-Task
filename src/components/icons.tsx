import type { ReactNode } from "react";

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export const OverviewIcon = () => (
  <Svg>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
  </Svg>
);

export const ProcessesIcon = () => (
  <Svg>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Svg>
);

export const PerformanceIcon = () => (
  <Svg>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Svg>
);

export const NetworkIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Svg>
);

export const ServicesIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </Svg>
);

export const SettingsIcon = () => (
  <Svg>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
  </Svg>
);

export const SearchIcon = () => (
  <Svg size={15}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const RefreshIcon = () => (
  <Svg>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Svg>
);

export const PauseIcon = () => (
  <Svg>
    <path d="M9 5v14M15 5v14" />
  </Svg>
);

export const PlayIcon = () => (
  <Svg>
    <path d="M7 4.5v15l12-7.5Z" />
  </Svg>
);

export const AlertIcon = () => (
  <Svg>
    <path d="M10.3 3.9 1.8 18.2A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Svg>
);

export const CheckIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg size={14}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <span
    className="inline-flex transition-transform duration-150"
    style={{ transform: open ? "rotate(90deg)" : "none" }}
  >
    <Svg size={12}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  </span>
);

export const ShieldIcon = ({ size = 13 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z" />
  </Svg>
);

export const FolderIcon = () => (
  <Svg>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </Svg>
);

export const TreeIcon = () => (
  <Svg size={15}>
    <path d="M5 4v12a2 2 0 0 0 2 2h4M5 9h6" />
    <rect x="13" y="6" width="7" height="6" rx="1.5" />
    <rect x="13" y="15" width="7" height="6" rx="1.5" />
  </Svg>
);

export const ListIcon = () => (
  <Svg size={15}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
);

export const AppsIcon = () => (
  <Svg size={15}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Svg>
);

export const StopIcon = () => (
  <Svg>
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
  </Svg>
);

export const KillIcon = () => (
  <Svg>
    <path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9Z" />
    <path d="m15 9-6 6M9 9l6 6" />
  </Svg>
);

export const BranchIcon = () => (
  <Svg>
    <circle cx="6" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="12" r="2" />
    <path d="M6 7v10M6 12h10" />
  </Svg>
);

export const SuspendIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 9v6M14 9v6" />
  </Svg>
);

export const ResumeIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="m10 8.5 5 3.5-5 3.5Z" />
  </Svg>
);

export const ArrowDownIcon = () => (
  <Svg size={13}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);

export const ArrowUpIcon = () => (
  <Svg size={13}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);

export const ThermometerIcon = () => (
  <Svg>
    <path d="M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0Z" />
  </Svg>
);

export const DiskIcon = () => (
  <Svg>
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </Svg>
);

export const MemoryIcon = () => (
  <Svg>
    <rect x="3" y="7" width="18" height="10" rx="2" />
    <path d="M7 7v10M11 7v10M15 7v10M7 20v-3M17 20v-3M12 20v-3" />
  </Svg>
);

export const CpuIcon = () => (
  <Svg>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
  </Svg>
);
