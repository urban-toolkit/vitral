import { memo, useEffect, useState } from "react";
import { ViewportPortal, useReactFlow } from "@xyflow/react";

import { findActivityDropTarget, type ActivityDropTarget } from "@/pages/projectEditor/canvasGeometry";
import styles from "./ActivityDropRings.module.css";

export type ActivityDropRingsReason = "drag" | "tool";

type ActivityDropRingsProps = {
    targets: ActivityDropTarget[];
    /** `drag` tracks a file being dragged over the canvas; `tool` tracks the pointer for the card tool. */
    reason: ActivityDropRingsReason;
};

/**
 * Dashed rings around every activity card, marking where a dropped file (or the card tool)
 * can create a card that gets auto-connected to that activity. Rendered inside the flow
 * viewport so the rings pan and zoom with the canvas.
 *
 * Hover tracking lives here on purpose: the highlight follows the pointer at frame rate and
 * keeping that state local avoids re-rendering the whole editor page on every mouse move.
 */
function ActivityDropRingsImpl({ targets, reason }: ActivityDropRingsProps) {
    const { screenToFlowPosition } = useReactFlow();
    const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

    useEffect(() => {
        let frame: number | null = null;
        let latestScreenPosition: { x: number; y: number } | null = null;

        const flush = () => {
            frame = null;
            if (!latestScreenPosition) return;
            const target = findActivityDropTarget(targets, screenToFlowPosition(latestScreenPosition));
            setActiveNodeId(target?.nodeId ?? null);
        };

        const track = (event: Event) => {
            const pointerEvent = event as MouseEvent;
            latestScreenPosition = { x: pointerEvent.clientX, y: pointerEvent.clientY };
            if (frame === null) frame = window.requestAnimationFrame(flush);
        };

        // Capture phase, because both card attach zones (drag events) and React Flow's node drag
        // handling (pointer events) call stopPropagation before the event reaches window.
        const options: AddEventListenerOptions = { capture: true, passive: true };
        const eventName = reason === "drag" ? "dragover" : "pointermove";
        window.addEventListener(eventName, track, options);

        return () => {
            window.removeEventListener(eventName, track, options);
            if (frame !== null) window.cancelAnimationFrame(frame);
        };
    }, [reason, screenToFlowPosition, targets]);

    // Drop the highlight when the tracked activity is no longer among the rings (deleted, filtered
    // out) instead of resetting state from an effect.
    const resolvedActiveNodeId = targets.some((target) => target.nodeId === activeNodeId)
        ? activeNodeId
        : null;

    return (
        <ViewportPortal>
            {targets.map((target) => {
                const isActive = target.nodeId === resolvedActiveNodeId;
                return (
                    <div
                        key={target.nodeId}
                        className={`${styles.ring} ${isActive ? styles.ringActive : ""}`}
                        style={{
                            left: target.center.x - target.radius,
                            top: target.center.y - target.radius,
                            width: target.radius * 2,
                            height: target.radius * 2,
                        }}
                    >
                        {isActive ? (
                            <span className={styles.ringLabel}>{target.title}</span>
                        ) : null}
                    </div>
                );
            })}
        </ViewportPortal>
    );
}

export const ActivityDropRings = memo(ActivityDropRingsImpl);
