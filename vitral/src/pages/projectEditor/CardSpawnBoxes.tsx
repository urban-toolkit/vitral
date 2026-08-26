import { memo } from "react";
import { ViewportPortal } from "@xyflow/react";

import { findCardSpawnTarget, type CardSpawnTarget } from "@/pages/projectEditor/canvasGeometry";
import { useHoveredCanvasTarget, type CanvasTargetReason } from "@/pages/projectEditor/useHoveredCanvasTarget";
import styles from "./CardSpawnBoxes.module.css";

type CardSpawnBoxesProps = {
    targets: CardSpawnTarget[];
    reason: CanvasTargetReason;
};

/**
 * Dashed boxes on the input and output handles of every non-activity card, marking where a new card
 * can be created already attached to that one.
 *
 * The counterpart to `ActivityDropRings`: rings say which activity a card is about, boxes say which
 * *card* it is about. Between them every card on the canvas offers somewhere to create the next
 * one, which is what makes "only activities may stand alone" a rule the canvas helps with rather
 * than one it only refuses at.
 *
 * Painted, never clicked — `pointer-events: none`, and the editor page's own click/drop handlers
 * hit-test `findCardSpawnTarget` against the flow position. Making these real click targets would
 * have failed anyway: the note tool covers the canvas with a full-screen capture layer, and a
 * dragged file never delivers a click at all.
 */
function CardSpawnBoxesImpl({ targets, reason }: CardSpawnBoxesProps) {
    const activeKey = useHoveredCanvasTarget(targets, reason, findCardSpawnTarget);

    return (
        <ViewportPortal>
            {targets.map((target) => {
                const isActive = target.key === activeKey;
                return (
                    <div
                        key={target.key}
                        className={`${styles.box} ${isActive ? styles.boxActive : ""}`}
                        style={{
                            left: target.center.x - (target.size / 2),
                            top: target.center.y - (target.size / 2),
                            width: target.size,
                            height: target.size,
                        }}
                    >
                        <span className={styles.plus}>+</span>
                        {isActive ? (
                            <span className={styles.boxLabel}>
                                {target.spawnLabel}
                                {" "}
                                <span className={styles.boxLabelRelation}>{target.relationLabel}</span>
                            </span>
                        ) : null}
                    </div>
                );
            })}
        </ViewportPortal>
    );
}

export const CardSpawnBoxes = memo(CardSpawnBoxesImpl);
