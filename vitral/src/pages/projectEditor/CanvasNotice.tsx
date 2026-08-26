import { useEffect } from "react";

import classes from "./CanvasNotice.module.css";

/** How long a notice stays up before clearing itself. */
const CANVAS_NOTICE_TIMEOUT_MS = 7_000;

type CanvasNoticeProps = {
    /** `null` when there is nothing to say. */
    message: string | null;
    /** Bumped by the caller on every new message, so repeating the same one restarts the timer. */
    noticeId: number;
    onDismiss: () => void;
    topOffsetPx: number;
};

/**
 * One line of feedback for a canvas action that was refused.
 *
 * It exists because the connection rule can only be enforced by *not* doing something, and a canvas
 * that silently ignores a click reads as broken. Auto-clears, because every message it carries is
 * about a gesture the user is already retrying.
 */
export function CanvasNotice({ message, noticeId, onDismiss, topOffsetPx }: CanvasNoticeProps) {
    useEffect(() => {
        if (!message) return;
        const timer = window.setTimeout(onDismiss, CANVAS_NOTICE_TIMEOUT_MS);
        return () => window.clearTimeout(timer);
    }, [message, noticeId, onDismiss]);

    // The live region is mounted for the life of the canvas and its *text* is swapped, rather than
    // the whole element being inserted already populated — which is the case assistive tech
    // commonly does not announce. It matters more than usual here: a refused gesture changes
    // nothing on the canvas, so this line is the only feedback there is.
    return (
        <div aria-live="polite" role="status">
            {message ? (
                <div className={classes.notice} style={{ top: topOffsetPx }}>
                    <span>{message}</span>
                    <button
                        type="button"
                        className={classes.dismiss}
                        onClick={onDismiss}
                        aria-label="Dismiss"
                    >
                        x
                    </button>
                </div>
            ) : null}
        </div>
    );
}
