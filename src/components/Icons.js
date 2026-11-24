import React from "react";

const Svg = ({ size = 18, children, ...rest }) => (
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
        {...rest}
    >
        {children}
    </svg>
);

export const ChatIcon = (p) => (
    <Svg {...p}>
        <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Svg>
);

export const CloseIcon = (p) => (
    <Svg {...p}>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
);

export const PlayIcon = (p) => (
    <Svg {...p} fill="currentColor" stroke="none">
        <polygon points="6 4 20 12 6 20 6 4" />
    </Svg>
);

export const TrashIcon = (p) => (
    <Svg {...p}>
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Svg>
);

export const LayoutSideIcon = (p) => (
    <Svg {...p}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="12" y1="4" x2="12" y2="20" />
    </Svg>
);

export const LayoutStackIcon = (p) => (
    <Svg {...p}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="3" y1="13" x2="21" y2="13" />
    </Svg>
);

export const CopyIcon = (p) => (
    <Svg {...p}>
        <rect x="9" y="9" width="12" height="12" rx="2" />
        <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Svg>
);

export const LeaveIcon = (p) => (
    <Svg {...p}>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
    </Svg>
);

export const MicIcon = (p) => (
    <Svg {...p}>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </Svg>
);

export const SendIcon = (p) => (
    <Svg {...p}>
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </Svg>
);