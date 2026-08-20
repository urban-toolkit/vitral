import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";

import classes from "./CanvasLevelControl.module.css";
import type { CanvasLevel } from "@/pages/projectEditor/canvasAbstraction";

/**
 * Picks how abstract the canvas is, and opens the assistant.
 *
 * Two ways to drive the level, because they suit different moments: the segments when you know what
 * you want to look at, and "follow zoom" when you would rather just zoom out and have the canvas
 * summarise itself. Turning follow-zoom on does not take the segments away — they stay live and
 * show whichever level the current zoom lands on.
 *
 * The assistant button rides in the same panel rather than floating on its own: both answer "what
 * am I looking at", and one thing in the bottom-right corner beats two competing for it. Two short
 * rows rather than one long bar, so the panel stays clear of the bottom-centre tool bar.
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
    /** Trailing assistant button. Omitted when there is no chat to open. */
    chatOpen?: boolean;
    onOpenChat?: () => void;
};

export function CanvasLevelControl({
    level,
    followZoom,
    onLevelChange,
    onFollowZoomChange,
    focusLabel = null,
    onClearFocus,
    shifted = false,
    chatOpen = false,
    onOpenChat,
}: CanvasLevelControlProps) {
    return (
        <div className={classes.container} style={{ marginBottom: shifted ? 380 : 0 }}>
            {focusLabel ? (
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
            ) : null}

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

            <div className={classes.row}>
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

                {onOpenChat ? (
                    <button
                        type="button"
                        className={`${classes.chatButton} ${chatOpen ? classes.chatButtonOn : ""}`}
                        title="Open AI assistant chat (Ctrl+Space)"
                        aria-label="Open AI assistant chat"
                        aria-haspopup="dialog"
                        aria-expanded={chatOpen}
                        onClick={onOpenChat}
                    >
                        <FontAwesomeIcon icon={faWandMagicSparkles} className={classes.chatIcon} />
                        AI Assistant
                    </button>
                ) : null}
            </div>
        </div>
    );
}
