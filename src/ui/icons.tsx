/** Small inline icons matching the reference UI. All 14x14 on a 14 grid. */

const S = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none" } as const;

export function FrameIcon() {
  // Dashed corner brackets.
  return (
    <svg {...S} stroke="currentColor" strokeWidth="1.1">
      <path d="M2 4.5V2.5h2M9.5 2.5h2v2M11.5 9.5v2h-2M4.5 11.5h-2v-2" />
    </svg>
  );
}

export function FlexFrameIcon() {
  // Two columns — the reference gives flex frames their own glyph.
  return (
    <svg {...S} stroke="currentColor" strokeWidth="1.1">
      <rect x="2.5" y="2.5" width="3.5" height="9" rx="0.5" />
      <rect x="8" y="2.5" width="3.5" height="9" rx="0.5" />
    </svg>
  );
}

export function RectIcon() {
  return (
    <svg {...S} stroke="currentColor" strokeWidth="1.1">
      <rect x="2.5" y="3.5" width="9" height="7" rx="0.5" />
    </svg>
  );
}

export function TextIcon() {
  return (
    <svg {...S} viewBox="0 0 16 14" width="16" height="14" fill="currentColor">
      <text x="0" y="11" fontSize="10" fontFamily="inherit">Aa</text>
    </svg>
  );
}

export function ImageIcon() {
  return (
    <svg {...S} stroke="currentColor" strokeWidth="1.1">
      <rect x="2" y="3" width="10" height="8" rx="1" />
      <path d="M2.5 9.5 5 7l2 1.5L9.5 6l2 2" />
      <circle cx="5" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      {...S}
      stroke="currentColor"
      strokeWidth="1.3"
      style={{ transform: open ? "rotate(90deg)" : undefined }}
    >
      <path d="M5.5 4l3.5 3-3.5 3" />
    </svg>
  );
}

export function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg {...S} stroke="currentColor" strokeWidth="1.1">
      <path d="M1.5 7S3.6 3.5 7 3.5 12.5 7 12.5 7 10.4 10.5 7 10.5 1.5 7 1.5 7Z" />
      <circle cx="7" cy="7" r="1.6" />
      {off && <path d="M2.5 11.5 11.5 2.5" strokeWidth="1.2" />}
    </svg>
  );
}

export function LockIcon({ locked }: { locked?: boolean }) {
  return (
    <svg {...S} stroke="currentColor" strokeWidth="1.1">
      <rect x="3" y="6.5" width="8" height="5" rx="1" />
      {locked ? (
        <path d="M5 6.5V4.8a2 2 0 1 1 4 0v1.7" />
      ) : (
        <path d="M5 6.5V4.8a2 2 0 0 1 3.9-.6" />
      )}
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...S} stroke="currentColor" strokeWidth="1.2">
      <path d="M7 3v8M3 7h8" />
    </svg>
  );
}

export function PageIcon() {
  return (
    <svg {...S} stroke="currentColor" strokeWidth="1.1">
      <path d="M3.5 2.5h4.5l2.5 2.5v6.5h-7z" />
      <path d="M8 2.5V5h2.5" />
    </svg>
  );
}
