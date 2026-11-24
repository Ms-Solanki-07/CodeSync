import React, { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "codesync:split-ratios";
const DEFAULTS = { horizontal: 0.55, vertical: 0.6 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const load = () => {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
        return { ...DEFAULTS };
    }
};

/**
 * Two panes with a draggable divider.
 * - direction "horizontal": side by side, "vertical": stacked
 * - when `open` is false the second pane (and divider) are hidden, but stay mounted
 * - the first pane's React tree is never remounted when direction/open change
 */
const ResizableSplit = ({ direction = "horizontal", open, first, second, minPx = 240 }) => {
    const containerRef = useRef(null);
    const [ratios, setRatios] = useState(load);
    const [dragging, setDragging] = useState(false);

    const horizontal = direction === "horizontal";
    const ratio = ratios[direction];

    const setRatio = useCallback(
        (r) => setRatios((prev) => ({ ...prev, [direction]: r })),
        [direction]
    );

    useEffect(() => {
        if (dragging) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(ratios));
        } catch {
            /* storage unavailable */
        }
    }, [ratios, dragging]);

    const measure = () => {
        const rect = containerRef.current.getBoundingClientRect();
        const size = horizontal ? rect.width : rect.height;
        const lo = Math.min(minPx / size, 0.5);
        return { rect, size, lo, hi: 1 - lo };
    };

    const onPointerDown = (e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        const { rect, size, lo, hi } = measure();
        const pos = horizontal ? e.clientX - rect.left : e.clientY - rect.top;
        setRatio(clamp(pos / size, lo, hi));
    };

    const endDrag = () => setDragging(false);

    const onKeyDown = (e) => {
        const dec = horizontal ? "ArrowLeft" : "ArrowUp";
        const inc = horizontal ? "ArrowRight" : "ArrowDown";
        if (e.key !== dec && e.key !== inc) return;
        e.preventDefault();
        const { lo, hi } = measure();
        setRatio(clamp(ratio + (e.key === inc ? 0.03 : -0.03), lo, hi));
    };

    const minStyle = open ? (horizontal ? { minWidth: minPx } : { minHeight: minPx }) : null;

    return (
        <div
            ref={containerRef}
            className={`split split--${direction}${dragging ? " is-dragging" : ""}`}
        >
            <div
                className="splitPane splitPane--first"
                style={{ flex: open ? `0 0 ${ratio * 100}%` : "1 1 0", ...minStyle }}
            >
                {first}
            </div>

            {open && (
                <div
                    className="splitDivider"
                    role="separator"
                    aria-orientation={horizontal ? "vertical" : "horizontal"}
                    aria-label="Resize panels"
                    tabIndex={0}
                    title="Drag to resize · double-click to reset"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onDoubleClick={() => setRatio(DEFAULTS[direction])}
                    onKeyDown={onKeyDown}
                >
                    <span className="splitGrip" />
                </div>
            )}

            <div
                className={open ? "splitPane splitPane--second" : "splitPane splitPane--second is-hidden"}
                style={minStyle}
            >
                {second}
            </div>
        </div>
    );
};

export default ResizableSplit;