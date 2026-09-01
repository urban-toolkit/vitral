import { Fragment, memo, type CSSProperties, type RefObject } from "react";
import { ViewportPortal } from "@xyflow/react";

import type { ClusterHaloTarget } from "@/pages/projectEditor/canvasClusterHalos";
import styles from "./ClusterHalos.module.css";

type ClusterHalosProps = {
    targets: ClusterHaloTarget[];
    /**
     * Attached to the wrapper so `useCanvasLod` can write `--canvas-zoom` onto it from the pan/zoom
     * frame. Scoping the property to this subtree is what keeps a per-frame write affordable — see
     * the note in that hook.
     */
    scaleRef?: RefObject<HTMLDivElement | null>;
};

const KIND_TEXT: Record<ClusterHaloTarget["kind"], string> = {
    phase: "Phase",
    activity: "Thread",
    unassigned: "",
};

/**
 * A soft disc around each phase or thread, with the cluster's name written across it.
 *
 * Mounted whenever there are glyphs on the canvas — Overview and Threads — and shown or hidden purely
 * in CSS, keyed off the `data-cluster-halo` attribute `useCanvasLod` writes from the pan/zoom frame.
 * That is the whole reason it is not conditional in React: a zoom gesture that crossed the boundary
 * would otherwise mount and unmount an overlay mid-gesture, and the attribute costs one style
 * recalculation.
 *
 * **The disc and the title are two elements sharing one box, on opposite sides of the cards.** React
 * Flow puts its viewport portal before `.react-flow__nodes`, so anything rendered here paints under
 * the cards unless it says otherwise. That is right for the disc — an area containing a group has to
 * sit behind the group — and fatal for the title, which is centred on the glyph it names and would be
 * hidden by that one card at every zoom. Nested, they cannot disagree: the disc's own stacking
 * context would trap the title inside it. Siblings, each sorts against the nodes on its own.
 *
 * Painted, never clicked: `pointer-events: none` throughout, so the glyph underneath keeps its
 * click-to-open and the pane keeps its drag-to-pan. A halo that swallowed clicks would make the one
 * gesture the level is for — opening a phase — stop working at the zoom where the halo appears.
 *
 * The box is in flow units, so it pans and scales with the cluster it encloses. The type is **not**:
 * it holds a constant screen size through `--canvas-zoom`, bounded above by a fraction of the disc's
 * own radius so it can never burst out of the circle it labels.
 */
function ClusterHalosImpl({ targets, scaleRef }: ClusterHalosProps) {
    return (
        <ViewportPortal>
            <div ref={scaleRef} className={styles.layer}>
                {targets.map((target) => {
                    const box: CSSProperties = {
                        left: target.center.x - target.radius,
                        top: target.center.y - target.radius,
                        width: target.radius * 2,
                        height: target.radius * 2,
                    };
                    const isPhase = target.kind === "phase";

                    return (
                        <Fragment key={target.key}>
                            <div
                                className={`${styles.disc} ${isPhase ? styles.phase : styles.thread}`}
                                style={box}
                            />
                            <div
                                className={styles.labelBox}
                                style={{
                                    ...box,
                                    "--halo-max-font": `${target.maxFontSizePx}px`,
                                } as CSSProperties}
                            >
                                <div className={styles.label}>
                                    <span className={styles.kind}>{KIND_TEXT[target.kind]}</span>
                                    <span className={`${styles.title} ${isPhase ? styles.phaseTitle : ""}`}>
                                        {target.title}
                                    </span>
                                </div>
                            </div>
                        </Fragment>
                    );
                })}
            </div>
        </ViewportPortal>
    );
}

export const ClusterHalos = memo(ClusterHalosImpl);
