import { useCallback, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";

import classes from "./CanvasLevelControl.module.css";
import type { CanvasLevel } from "@/pages/projectEditor/canvasAbstraction";
import { LOCATOR_LENS_HELP } from "@/pages/projectEditor/locators";

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
 *
 * The reference box belongs here for the same reason. A reference carries its own level of
 * abstraction — the letter says what altitude the artifact is cited at, and the optional suffix says
 * which altitude the reader wants — so typing one is a *third* way of driving this control: not "find
 * me a card" but "put the canvas where this reference points", which is exactly what the segments and
 * follow-zoom do by other means.
 */

/**
 * The whole grammar, in a tooltip, because the suffixes are not guessable and the box is the only
 * place a reader meets them outside the exported report. Built from `LOCATOR_LENS_HELP` so the two
 * cannot drift.
 */
const REFERENCE_INPUT_HELP = [
    "A reference from a report or a paper — A3, R7, C2 — takes the canvas to what it names.",
    "Add a suffix to choose the view:",
    ...LOCATOR_LENS_HELP.map((entry) => (
        `  R1${entry.suffix} — ${entry.means}`
    )),
].join("\n");

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
    /**
     * Jump to a reference. Returns whether it resolved, so the box can keep a bad one on screen for
     * correction instead of clearing it and leaving the reader to retype from memory.
     */
    onGoToCode?: (code: string) => boolean;
    /**
     * The reference the canvas is currently showing, seeded into the box.
     *
     * The box is the only thing on screen that names the citation a reader followed: somebody who
     * clicked `R7P` in a PDF otherwise arrives at a canvas holding no evidence of what they clicked.
     * Null when nothing has been asked for.
     */
    reference?: string | null;
    /** Bumped by the caller on every arrival, so going to the same reference twice re-seeds the box. */
    referenceId?: number;
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
    onGoToCode,
    reference = null,
    referenceId = 0,
    shifted = false,
    chatOpen = false,
    onOpenChat,
}: CanvasLevelControlProps) {
    const [codeDraft, setCodeDraft] = useState(reference ?? "");
    const inputRef = useRef<HTMLInputElement | null>(null);

    /*
     * Seeded, not controlled: between arrivals the draft belongs to the reader, and a controlled
     * value would fight every keystroke.
     *
     * Adjusted during render rather than from an effect — React's own recipe for state derived from
     * a prop, and the same shape `BlueprintTray` uses to reset its local nodes. An effect would
     * render once with the previous reference first, so the box would visibly show the last citation
     * before snapping to this one.
     *
     * Keyed on `referenceId` rather than on the string, so going to the same reference twice
     * re-seeds: a reader who retyped a code they were already on must see the field acknowledge it.
     */
    const [seededFrom, setSeededFrom] = useState(referenceId);
    if (seededFrom !== referenceId) {
        setSeededFrom(referenceId);
        if (reference !== null) setCodeDraft(reference);
    }

    const submitCode = useCallback(() => {
        const typed = codeDraft.trim();
        if (typed === "" || !onGoToCode) return;
        /*
         * Not cleared, either way, which reverses what this used to do.
         *
         * On failure the text stays for correction — a bad reference is usually a typo, and clearing
         * it would send the reader back to the paper — and the field selects itself so retyping is
         * one keystroke rather than a manual erase.
         *
         * On success the parent seeds the canonical spelling back through `reference`, so the box
         * goes on naming what the canvas is showing: `r7p` becomes `R7P` in place. That is both a
         * better acknowledgement than an empty field and the thing a reader arriving from a paper
         * needs, since nothing else on screen says which citation they followed.
         */
        if (!onGoToCode(typed)) inputRef.current?.select();
    }, [codeDraft, onGoToCode]);

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

            {onGoToCode ? (
                <div className={classes.row}>
                    <input
                        ref={inputRef}
                        className={classes.codeInput}
                        type="text"
                        value={codeDraft}
                        onChange={(event) => setCodeDraft(event.target.value)}
                        // The box is pre-filled now, so the first keystroke of the next reference
                        // should replace the last one rather than append to it.
                        onFocus={(event) => event.currentTarget.select()}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                submitCode();
                            }
                            // Restores what the canvas is showing rather than emptying the field:
                            // the box names a place, and abandoning an edit should put the name back.
                            if (event.key === "Escape") setCodeDraft(reference ?? "");
                            // The canvas listens for Backspace as delete and for Space as pan; a code
                            // being typed must not reach either.
                            event.stopPropagation();
                        }}
                        placeholder="Go to reference"
                        title={REFERENCE_INPUT_HELP}
                        aria-label="Go to a reference"
                        spellCheck={false}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        size={9}
                    />
                    <button
                        type="button"
                        className={classes.codeGo}
                        title="Go to this reference"
                        aria-label="Go to this reference"
                        disabled={codeDraft.trim() === ""}
                        onClick={submitCode}
                    >
                        <FontAwesomeIcon icon={faArrowRight} />
                    </button>
                </div>
            ) : null}

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
