import { useCallback, useMemo, useState } from 'react';

import classes from './Card.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRepeat, faPerson, faCalendar, faCube, faListCheck, faLinesLeaning, faLightbulb, type IconDefinition } from '@fortawesome/free-solid-svg-icons';

import { Position, Handle } from '@xyflow/react';
import { AttachFileZone } from './AttachFileZone';
import { shallowEqual, useSelector } from 'react-redux';
import type { fileData } from '@/config/types';
import { makeSelectFilesForNode } from '@/store/flowSlice';
import { FileCarousel } from '@/components/FileCarousel';

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

function LabelIcon({ label }: {label: string}) {
    return (
        <FontAwesomeIcon className={classes.flipIcon} icon={iconName[label]}/>
    )
}

export function Card(props: any) {

    const [flipped, setFlipped] = useState(false);

    const selectFiles = useMemo(
        () => makeSelectFilesForNode(props.id),
        [props.id]
    );

    const files: fileData[] = useSelector(selectFiles, shallowEqual);

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

    return (
        <div className={`${classes.card} ${classes.flipCard}`}>

            <div className={`${classes.flipCardInner} ${flipped ? classes.flipAnimation : ""}`}>

                <div className={`${classes.flipCardFront} ${props.data.type == "social" ? classes.socialCard : classes.techCard}`}>
                    <div className={classes.header}>
                        <p>{`${props.data.label[0].toUpperCase()}${props.data.label.slice(1)}`}</p>
                        <FontAwesomeIcon className={classes.flipIcon} icon={faRepeat} onClick={() => {setFlipped(true)}}/>
                    </div>
                    <div className={classes.attachments}>
                        <div className={classes.labelIcon} style={{backgroundColor: headerColor[props.data.label as string]}}>
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
                                accept='.txt, .png, .jpg, .jpeg, .json, .csv, .ipynb, .py, .js, .ts, .html, .css, .md'
                            />
                        </FileCarousel>
                    </div>
                    <div className={classes.title}>
                        <p>{props.data.title}</p>
                    </div>

                </div>

                <div className={`${classes.flipCardBack} ${props.data.type == "social" ? classes.socialCardBack : classes.techCardBack}`}>
                    <div className={classes.header} style={{backgroundColor: headerColor[props.data.label as string]}}>
                        <p>{`${props.data.label[0].toUpperCase()}${props.data.label.slice(1)}`}</p>
                        <FontAwesomeIcon className={classes.flipIcon} icon={faRepeat} onClick={() => {setFlipped(false)}}/>
                    </div>
                    <p className={classes.backText}>{props.data.description}</p>
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
