import { memo, useMemo, useState } from 'react';

import classes from './Card.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRepeat, faPerson, faArrowPointer, faCalendar, faCube, faListCheck, faLinesLeaning, faLightbulb, type IconDefinition } from '@fortawesome/free-solid-svg-icons';

import { Position, Handle } from '@xyflow/react';
import { AttachFileZone } from '@/components/files/AttachFileZone';
import { useSelector } from 'react-redux';
import type { fileRecord, nodeType } from '@/config/types';
import type { RootState } from '@/store';
import { FileCarousel } from '@/components/files/FileCarousel';

const headerColor: Record<string, string> = {
    person: "rgba(231, 174, 255, 0.70)",
    activity: "rgb(174, 233, 255, 0.70)",
    object: "rgb(255, 243, 174, 0.70)",
    requirement: "rgb(255, 174, 174, 0.70)",
    concept: "rgb(224, 255, 174, 0.70)",
    insight: "rgb(174, 255, 198, 0.70)",
    task: "rgb(255, 174, 239, 0.70)",
}

const iconName: Record<string, IconDefinition> = {
    person: faPerson,
    activity: faCalendar,
    object: faCube,
    requirement: faListCheck,
    concept: faLinesLeaning,
    insight: faLightbulb,
    task: faArrowPointer
}

const CARD_LABELS = ["person", "activity", "requirement", "concept", "insight", "object", "task"];

function LabelIcon({ label }: { label: string }) {
    return (
        <FontAwesomeIcon className={classes.flipIcon} icon={iconName[label]} />
    )
}

export type CardProps = {
    id?: string;
    data: {
        label: string;
        type: string;
        title: string;
        description?: string;
        attachmentIds?: string[];
    };
    onAttachFile?: (nodeId: string, file: File) => void;
    onDataPropertyChange?: (nodeProps: nodeType, value: string, propertyName: string) => void;
    selected?: boolean;
    dragging?: boolean;
    [key: string]: unknown;
};

function CardImpl(props: CardProps) {

    const [flipped, setFlipped] = useState(false);

    const filesById = useSelector((state: RootState) => state.files.byId);
    const attachmentIds = props.data?.attachmentIds;
    const files = useMemo<fileRecord[]>(() => {
        if (!Array.isArray(attachmentIds)) return [];
        return attachmentIds
            .map((fileId: string) => filesById[fileId])
            .filter((file): file is fileRecord => Boolean(file));
    }, [attachmentIds, filesById]);

    const dropZoneCSS = useMemo<React.CSSProperties>(() => ({
        borderRadius: "8",
        textAlign: "center",
        background: "transparent",
        transition: "background 0.2s ease",
    }), []);

    const handleFileSelected = (file: File) => {
        if (!props.id) return;
        props.onAttachFile?.(props.id, file);
    };

    const getCleanNodeProps = () => {
        const cleanProps = { ...props };
        delete cleanProps.onAttachFile;
        delete cleanProps.onDataPropertyChange;
        return cleanProps as unknown as nodeType;
    };

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
                                    props.onDataPropertyChange?.(getCleanNodeProps(), newLabel, "label");
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
                            persistKey={props.id}
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
                                    props.onDataPropertyChange?.(getCleanNodeProps(), draftTitle.trim(), "title");
                                    setIsEditingTitle(false);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        props.onDataPropertyChange?.(getCleanNodeProps(), draftTitle.trim(), "title");
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
                                    props.onDataPropertyChange?.(getCleanNodeProps(), draftDescription.trim(), "description");
                                    setIsEditingDescription(false);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        props.onDataPropertyChange?.(getCleanNodeProps(), draftDescription.trim(), "description");
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

function areEqualCardProps(prev: CardProps, next: CardProps) {
    return (
        prev.id === next.id &&
        prev.data === next.data &&
        prev.selected === next.selected &&
        prev.dragging === next.dragging &&
        prev.onAttachFile === next.onAttachFile &&
        prev.onDataPropertyChange === next.onDataPropertyChange
    );
}

export const Card = memo(CardImpl, areEqualCardProps);
