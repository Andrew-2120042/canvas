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

// --- toolbar ---------------------------------------------------------------

const T = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none" } as const;

export function MoveIcon() {
  return (
    <svg {...T} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M4 2.5 13.5 9l-4.2 1.3L7.6 15z" />
    </svg>
  );
}

export function PanIcon() {
  return (
    <svg {...T} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M6 8V4.2a1.1 1.1 0 0 1 2.2 0V8m0-.6V3.4a1.1 1.1 0 0 1 2.2 0V8m0-.4V4.6a1.1 1.1 0 0 1 2.2 0V10c0 3-1.9 5-4.4 5S3.6 13.2 3.6 10.5V8.4a1.1 1.1 0 0 1 2.2 0" />
    </svg>
  );
}

export function ToolFrameIcon() {
  return (
    <svg {...T} stroke="currentColor" strokeWidth="1.3">
      <path d="M3 5.5V3h2.5M12.5 3H15v2.5M15 12.5V15h-2.5M5.5 15H3v-2.5" />
    </svg>
  );
}

export function ToolRectIcon() {
  return (
    <svg {...T} stroke="currentColor" strokeWidth="1.3">
      <rect x="3.5" y="4" width="11" height="10" rx="1" />
    </svg>
  );
}

export function PenIcon() {
  return (
    <svg {...T} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M9 2.5 13.5 7 9 15 4.5 7z" />
      <circle cx="9" cy="7" r="1.4" />
    </svg>
  );
}

export function ToolTextIcon() {
  return (
    <svg {...T} fill="currentColor">
      <text x="1" y="13.5" fontSize="12.5" fontFamily="inherit">Aa</text>
    </svg>
  );
}

export function ToolImageIcon() {
  return (
    <svg {...T} stroke="currentColor" strokeWidth="1.2">
      <rect x="2.5" y="4" width="13" height="10" rx="1.2" />
      <path d="M3 12l3.5-3.5L9 11l3-3 3 3" />
      <circle cx="6.2" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ShaderIcon() {
  return (
    <svg {...T} stroke="currentColor" strokeWidth="1.2">
      <rect x="2.5" y="2.5" width="13" height="13" rx="1.5" />
      <path d="M9 5.5 12.5 9 9 12.5 5.5 9z" />
    </svg>
  );
}

export function ComponentIcon() {
  return (
    <svg {...T} stroke="currentColor" strokeWidth="1.2">
      <path d="M9 2.2 11.6 4.8 9 7.4 6.4 4.8zM9 10.6l2.6 2.6L9 15.8l-2.6-2.6zM4.8 6.4 7.4 9l-2.6 2.6L2.2 9zM13.2 6.4 15.8 9l-2.6 2.6L10.6 9z" />
    </svg>
  );
}

export function TokenIcon() {
  return (
    <svg {...T} stroke="currentColor" strokeWidth="1.2">
      <circle cx="9" cy="9" r="6" />
      <circle cx="9" cy="9" r="2.2" />
    </svg>
  );
}

// --- align -----------------------------------------------------------------

const A = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none" } as const;
const line = { stroke: "currentColor", strokeWidth: 1.2 };
const bar = { fill: "currentColor" };

export function AlignLeftIcon() {
  return (<svg {...A}><path d="M2 2v10" {...line} /><rect x="4" y="3.5" width="8" height="3" {...bar} /><rect x="4" y="7.5" width="5" height="3" {...bar} /></svg>);
}
export function AlignHCenterIcon() {
  return (<svg {...A}><path d="M7 2v10" {...line} /><rect x="2.5" y="3.5" width="9" height="3" {...bar} /><rect x="4.5" y="7.5" width="5" height="3" {...bar} /></svg>);
}
export function AlignRightIcon() {
  return (<svg {...A}><path d="M12 2v10" {...line} /><rect x="2" y="3.5" width="8" height="3" {...bar} /><rect x="5" y="7.5" width="5" height="3" {...bar} /></svg>);
}
export function AlignTopIcon() {
  return (<svg {...A}><path d="M2 2h10" {...line} /><rect x="3.5" y="4" width="3" height="8" {...bar} /><rect x="7.5" y="4" width="3" height="5" {...bar} /></svg>);
}
export function AlignVCenterIcon() {
  return (<svg {...A}><path d="M2 7h10" {...line} /><rect x="3.5" y="2.5" width="3" height="9" {...bar} /><rect x="7.5" y="4.5" width="3" height="5" {...bar} /></svg>);
}
export function AlignBottomIcon() {
  return (<svg {...A}><path d="M2 12h10" {...line} /><rect x="3.5" y="2" width="3" height="8" {...bar} /><rect x="7.5" y="5" width="3" height="5" {...bar} /></svg>);
}
export function DistributeHIcon() {
  return (<svg {...A}><path d="M2 2v10M12 2v10" {...line} /><rect x="6" y="4" width="2" height="6" {...bar} /></svg>);
}
export function DistributeVIcon() {
  return (<svg {...A}><path d="M2 2h10M2 12h10" {...line} /><rect x="4" y="6" width="6" height="2" {...bar} /></svg>);
}
