import { useCallback, useMemo, useState } from 'react';

import classes from './Card.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRepeat, faPerson, faCalendar, faCube, faListCheck, faLinesLeaning, faLightbulb, type IconDefinition } from '@fortawesome/free-solid-svg-icons';

import { Position, Handle } from '@xyflow/react';
import { AttachFileZone } from '@/components/files/AttachFileZone';
import { shallowEqual, useSelector } from 'react-redux';
import type { fileRecord, nodeType } from '@/config/types';
import { makeSelectFilesForNode } from '@/store/flowSlice';
import { FileCarousel } from '@/components/files/FileCarousel';

const headerColor: Record<string, string> = {
    person: "rgba(231, 174, 255, 0.70)",
    activity: "rgb(174, 233, 255, 0.70)",
    artifact: "rgb(255, 243, 174, 0.70)",
    requirement: "rgb(255, 174, 174, 0.70)",
    concept: "rgb(224, 255, 174, 0.70)",
    insight: "rgb(174, 255, 198, 0.70)"
}

const iconName: Record<string, IconDefinition> = {
    person: faPerson,
    activity: faCalendar,
    artifact: faCube,
    requirement: faListCheck,
    concept: faLinesLeaning,
    insight: faLightbulb
}

const CARD_LABELS = ["person", "activity", "requirement", "concept", "insight"]

function LabelIcon({ label }: { label: string }) {
    return (
        <FontAwesomeIcon className={classes.flipIcon} icon={iconName[label]} />
    )
}

export function Card(props: any) {

    const [flipped, setFlipped] = useState(false);

    const selectFiles = useMemo(
        () => makeSelectFilesForNode(props.id),
        [props.id]
    );

    const files: fileRecord[] = useSelector(selectFiles, shallowEqual);

    const dropZoneCSS = useMemo<React.CSSProperties>(() => ({
        border: "2px dashed #ccc",
        borderRadius: "8",
        textAlign: "center",
        background: "transparent",
        transition: "background 0.2s ease",
        flex: "1"
    }), []);

    const handleFileSelected = useCallback((file: File) => {
        props.onAttachFile?.(props.id, file);
    }, [props.onAttachFile, props.id]);

    const [isEditingLabel, setIsEditingLabel] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [isEditingDescription, setIsEditingDescription] = useState(false);

    const [draftTitle, setDraftTitle] = useState(props.data.title);
    const [draftDescription, setDraftDescription] = useState(props.data.description ?? '');

    return (
        <div className={`${classes.card} ${classes.flipCard}`}>

            <div className={`${classes.flipCardInner} ${flipped ? classes.flipAnimation : ""}`}>

                <div className={`${classes.flipCardFront} ${props.data.type == "social" ? classes.socialCard : classes.techCard}`}>
                    <div className={classes.header}>
                        {/* <p>{`${props.data.label[0].toUpperCase()}${props.data.label.slice(1)}`}</p> */}
                        {isEditingLabel ? (
                            <select
                                value={props.data.label}
                                autoFocus
                                onChange={(e) => {
                                    const newLabel = e.target.value;

                                    // Removing callback functions from props
                                    const {onAttachFile, onDataPropertyChange, ...cleanProps } = props;

                                    props.onDataPropertyChange(cleanProps, newLabel, "label");
                                    setIsEditingLabel(false);
                                }}
                                onBlur={() => setIsEditingLabel(false)}
                            >
                                {CARD_LABELS.map(label => (
                                    <option key={label} value={label}>
                                        {label[0].toUpperCase() + label.slice(1)}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <p
                                className={classes.label}
                                onClick={() => setIsEditingLabel(true)}
                            >
                                {props.data.label[0].toUpperCase() + props.data.label.slice(1)}
                            </p>
                        )}

                        <FontAwesomeIcon className={classes.flipIcon} icon={faRepeat} onClick={() => { setFlipped(true) }} />
                    </div>
                    <div className={classes.attachments}>
                        <div className={classes.labelIcon} style={{ backgroundColor: headerColor[props.data.label as string], top: "-10px", left: "-3px" }}>
                            <LabelIcon
                                label={props.data.label}
                            />
                        </div>

                        <FileCarousel
                            files={files}
                        >
                            <AttachFileZone
                                onFileSelected={handleFileSelected}
                                dropZoneCSS={dropZoneCSS}
                                loading={false}
                                accept='.txt, .png, .jpg, .jpeg, .json, .csv, .ipynb, .py, .js, .ts, .html, .css, .md, .docx, .pdf'
                            />
                        </FileCarousel>
                    </div>
                    <div className={classes.title}>
                        {isEditingTitle ? (
                            <textarea
                                className={classes.fieldTextEditor}
                                value={draftTitle}
                                autoFocus
                                rows={1}
                                onChange={(e) => setDraftTitle(e.target.value)}
                                onBlur={() => {
                                    const {onAttachFile, onDataPropertyChange, ...cleanProps } = props;

                                    props.onDataPropertyChange(cleanProps, draftTitle.trim(), "title");
                                    setIsEditingTitle(false);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();

                                        const {onAttachFile, onDataPropertyChange, ...cleanProps } = props;

                                        props.onDataPropertyChange(cleanProps, draftTitle.trim(), "title");
                                        setIsEditingTitle(false);
                                    }
                                    if (e.key === "Escape") {
                                        setDraftTitle(props.data.title);
                                        setIsEditingTitle(false);
                                    }
                                }}
                            />
                        ) : (
                            <p
                                className={classes.title}
                                onClick={() => {
                                    setDraftTitle(props.data.title);
                                    setIsEditingTitle(true);
                                }}
                            >
                                {props.data.title || "Untitled"}
                            </p>
                        )}
                    </div>

                </div>

                <div className={`${classes.flipCardBack} ${props.data.type == "social" ? classes.socialCardBack : classes.techCardBack}`}>
                    <div className={classes.header}>
                        <p>{`${props.data.label[0].toUpperCase()}${props.data.label.slice(1)}`}</p>
                        <FontAwesomeIcon className={classes.flipIcon} icon={faRepeat} onClick={() => { setFlipped(false) }} />
                    </div>
                    <div className={classes.backBody}>
                        <div className={classes.labelIcon} style={{ backgroundColor: headerColor[props.data.label as string], top: "-4px", left: "-5px" }}>
                            <LabelIcon
                                label={props.data.label}
                            />
                        </div>

                        {/* <p className={classes.backText}>{props.data.description}</p> */}
                        {isEditingDescription ? (
                            <textarea
                                className={classes.fieldTextEditor}
                                style={{fontSize: "var(--font-size-xs)", color: "white"}}
                                value={draftDescription}
                                autoFocus
                                rows={1}
                                onChange={(e) => {
                                    setDraftDescription(e.target.value);
                                }}
                                onBlur={() => {
                                    const {onAttachFile, onDataPropertyChange, ...cleanProps } = props;

                                    props.onDataPropertyChange(cleanProps, draftDescription.trim(), "description");
                                    setIsEditingDescription(false);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();

                                        const {onAttachFile, onDataPropertyChange, ...cleanProps } = props;

                                        props.onDataPropertyChange(cleanProps, draftDescription.trim(), "description");
                                        setIsEditingDescription(false);
                                    }
                                    if (e.key === "Escape") {
                                        if(props.data.description == '' || !props.data.description)
                                            setDraftDescription("Empty description.");
                                        else
                                            setDraftDescription(props.data.description);
                                        setIsEditingDescription(false);
                                    }
                                }}
                            />
                        ) : (
                            <p
                                className={classes.backText}
                                onClick={() => {
                                    if(props.data.description == '' || !props.data.description)
                                        setDraftDescription("Empty description.");
                                    else
                                        setDraftDescription(props.data.description);
                                    setIsEditingDescription(true);
                                }}
                            >
                                {props.data.description || "Empty description."}
                            </p>
                        )}

                    </div>
                </div>

            </div>

            {
                props.id != undefined
                    ?
                    <>
                        <Handle type="source" position={Position.Left} />
                        <Handle type="target" position={Position.Right} />
                    </>
                    :
                    null
            }

        </div>
    );
}
