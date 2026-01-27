import { useState } from 'react';

import classes from './Card.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRepeat } from '@fortawesome/free-solid-svg-icons';

import { Position, Handle } from '@xyflow/react';
import { AttachFileZone } from './AttachFileZone';

const headerColor: Record<string, string> = {
    person: "#C655BC",
    activity: "#5E7CE2",
    artifact: "#beac40",
    requirement: "#B14022",
    concept: "#54B374",
    insight: "#528040"
}

export function Card(props: any) {

    const [flipped, setFlipped] = useState(false);

    return (
        <div className={`${classes.card} ${classes.flipCard}`}>

            <div className={`${classes.flipCardInner} ${flipped ? classes.flipAnimation : ""}`}>

                <div className={`${classes.flipCardFront} ${props.data.type == "social" ? classes.socialCard : classes.techCard}`}>
                    <div className={classes.header} style={{backgroundColor: headerColor[props.data.label as string]}}>
                        <p>{`${props.data.label[0].toUpperCase()}${props.data.label.slice(1)}`}</p>
                        <FontAwesomeIcon className={classes.flipIcon} icon={faRepeat} onClick={() => {setFlipped(true)}}/>
                    </div>
                    <div className={classes.title}>
                        <p>{props.data.title}</p>
                    </div>
                    <div className={classes.footer}>
                        <AttachFileZone 
                            onFileSelected={(file: File) => {console.log("File loaded", file, "Card", props.data)}}
                            dropZoneCSS={{
                                border: "2px dashed #ccc",
                                borderRadius: "8",
                                textAlign: "center",
                                background: "transparent",
                                transition: "background 0.2s ease",
                                width: "100%",
                                height: "100%"
                                // margin: "5px",
                            }}
                            loading={false}
                            accept='.txt, .png, .jpg, .jpeg, .json, .csv, .ipynb, .py, .js, .ts, .html, .css, .md'
                        />
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