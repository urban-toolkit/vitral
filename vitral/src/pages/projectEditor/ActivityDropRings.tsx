import { memo } from "react";
import { ViewportPortal } from "@xyflow/react";

import { findActivityDropTarget, type ActivityDropTarget } from "@/pages/projectEditor/canvasGeometry";
import { useHoveredCanvasTarget, type CanvasTargetReason } from "@/pages/projectEditor/useHoveredCanvasTarget";
import styles from "./ActivityDropRings.module.css";

export type ActivityDropRingsReason = CanvasTargetReason;

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
 * The rings are painted, not clicked: they take no pointer events and the handlers on the editor
 * page hit-test the same geometry against the click's flow position. That is what lets the note
 * tool's own full-screen capture layer sit on top of them without breaking either one.
 */
function ActivityDropRingsImpl({ targets, reason }: ActivityDropRingsProps) {
    const activeKey = useHoveredCanvasTarget(targets, reason, findActivityDropTarget);

    return (
        <ViewportPortal>
            {targets.map((target) => {
                const isActive = target.key === activeKey;
                return (
                    <div
                        key={target.key}
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
