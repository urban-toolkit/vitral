import { useMemo, useState } from 'react';

import classes from './FreeInputZone.module.css'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons'

import type { cardLabel, ProjectParticipant } from '@/config/types';
import { CARD_LABELS } from '@/components/cards/cardVisuals';
import { classifyNote, type NoteClassification } from '@/pages/projectEditor/noteClassification';

type FreeInputZoneProps = {
    participants: readonly ProjectParticipant[];
    /**
     * Returns `false` when the note has not (yet) become a card — the canvas refused the placement,
     * or it accepted it and is still asking which relation the connecting edge should carry. The
     * input stays open with its text intact either way, so neither a refusal nor a cancelled
     * relation menu costs the researcher the sentence they just wrote. A note that *does* become a
     * card takes the note tool with it, and this whole component unmounts.
     */
    onInputSubmit: (x: number, y: number, note: NoteClassification) => boolean;
};

export function FreeInputZone({ participants, onInputSubmit }: FreeInputZoneProps) {

    const [inputModal, setInputModal] = useState<boolean>(false);
    const [position, setPosition] = useState<{x: number, y: number}>({x: 0, y: 0});
    const [textValue, setTextValue] = useState<string>("");
    // Null means "whatever the classifier guessed". Set only once the researcher overrides, so a
    // guess that changes as they keep typing does not fight a choice they already made.
    const [labelOverride, setLabelOverride] = useState<cardLabel | null>(null);

    const guess = useMemo(
        () => classifyNote(textValue, participants),
        [textValue, participants],
    );
    const effectiveLabel = labelOverride ?? guess.label;

    const clampNumber = (x: number, value: number) => {
        if(x > value)
            return value;
        else
            return x;
    };

    const close = () => {
        setInputModal(false);
        setTextValue("");
        setLabelOverride(null);
    };

    const submit = () => {
        if (!textValue.trim()) return;
        const accepted = onInputSubmit(position.x, position.y, {
            ...guess,
            label: effectiveLabel,
            ...(labelOverride ? { confidence: "strong", matchedCues: ["chosen by hand"] } : {}),
        });
        if (!accepted) return;
        close();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
            return;
        }
        // Shift+Enter stays a newline, so a note can be more than one line.
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    }

    return (
        <>
            <div
                className={classes.cursorEventCaptureContainer}
                onClick={(e) => {
                    setInputModal(true);
                    setPosition({
                        x: e.clientX,
                        y: e.clientY
                    })
                }}
            ></div>

            {inputModal ?
                <div
                    className={classes.inputContainer}
                    style={{top: position.y, left: clampNumber(position.x, window.screen.width - 200)}}
                >
                    <textarea
                        autoFocus
                        onKeyDown={handleKeyDown}
                        value={textValue}
                        onChange={(e) => {setTextValue(e.target.value)}}
                        placeholder='This note will become a card...'
                    />

                    {/*
                      * The guessed type is shown as the select's current value and nothing more.
                      * It stays overridable here, so the researcher can disagree before the card
                      * exists rather than after -- but the classifier does not narrate itself.
                      */}
                    <div className={classes.guessRow}>
                        <select
                            className={classes.guessSelect}
                            value={effectiveLabel}
                            onChange={(e) => setLabelOverride(e.target.value as cardLabel)}
                            title="Card type"
                            aria-label="Card type"
                        >
                            {CARD_LABELS.map((label) => (
                                <option key={label} value={label}>{label}</option>
                            ))}
                        </select>

                        <span className={classes.guessSpacer} />

                        <FontAwesomeIcon
                            className={classes.confirmIcon}
                            icon={faPaperPlane}
                            onClick={submit}
                            title="Create card"
                        />
                    </div>
                </div>
            :
                null
            }
        </>

    );
}
