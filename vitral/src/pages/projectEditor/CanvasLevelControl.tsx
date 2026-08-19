import classes from "./CanvasLevelControl.module.css";
import type { CanvasLevel } from "@/pages/projectEditor/canvasAbstraction";

/**
 * Picks how abstract the canvas is.
 *
 * Two ways to drive it, because they suit different moments: the segments when you know what you
 * want to look at, and "follow zoom" when you would rather just zoom out and have the canvas
 * summarise itself. Turning follow-zoom on does not take the segments away — they stay live and
 * show whichever level the current zoom lands on.
 */

const LEVELS: Array<{ value: CanvasLevel; label: string; hint: string }> = [
    { value: 1, label: "Overview", hint: "Phases, major requirements and concepts" },
    { value: 2, label: "Threads", hint: "One glyph per activity, with the threads between them" },
    { value: 3, label: "Detail", hint: "Every card" },
];

export type CanvasLevelControlProps = {
    level: CanvasLevel;
    followZoom: boolean;
    onLevelChange: (level: CanvasLevel) => void;
    onFollowZoomChange: (value: boolean) => void;
    /** Name of whatever is currently opened out, or null when nothing is. */
    focusLabel?: string | null;
    onClearFocus?: () => void;
    /** Lifted clear of the timeline dock, the same way the toolbar is. */
    shifted?: boolean;
};

export function CanvasLevelControl({
    level,
    followZoom,
    onLevelChange,
    onFollowZoomChange,
    focusLabel = null,
    onClearFocus,
    shifted = false,
}: CanvasLevelControlProps) {
    return (
        <div className={classes.container} style={{ marginBottom: shifted ? 380 : 0 }}>
            <div className={classes.segments} role="group" aria-label="Canvas detail level">
                {LEVELS.map((entry) => (
                    <button
                        key={entry.value}
                        type="button"
                        className={`${classes.segment} ${level === entry.value ? classes.segmentActive : ""} ${followZoom && level !== entry.value ? classes.segmentAuto : ""}`}
                        title={entry.hint}
                        aria-pressed={level === entry.value}
                        onClick={() => onLevelChange(entry.value)}
                    >
                        {entry.label}
                    </button>
                ))}
            </div>

            <span className={classes.divider} />

            <button
                type="button"
                className={`${classes.autoToggle} ${followZoom ? classes.autoToggleOn : ""}`}
                title="Let the canvas zoom decide the level"
                aria-pressed={followZoom}
                onClick={() => onFollowZoomChange(!followZoom)}
            >
                <span className={classes.autoDot} />
                Follow zoom
            </button>

            {focusLabel ? (
                <>
                    <span className={classes.divider} />
                    <span className={classes.breadcrumb}>
                        <span className={classes.breadcrumbLabel} title={focusLabel}>{focusLabel}</span>
                        <button
                            type="button"
                            className={classes.breadcrumbClear}
                            title="Close this one back up"
                            aria-label="Close this one back up"
                            onClick={() => onClearFocus?.()}
                        >
                            ✕
                        </button>
                    </span>
                </>
            ) : null}
        </div>
    );
}
