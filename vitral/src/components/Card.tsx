import { useState } from 'react';

import classes from './Card.module.css'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRepeat } from '@fortawesome/free-solid-svg-icons'

const headerColor: Record<string, string> = {
    person: "#C655BC",
    event: "#5E7CE2",
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
                    <div className={classes.footer}><p>Footer</p></div>
                </div>

                <div className={`${classes.flipCardBack} ${props.data.type == "social" ? classes.socialCardBack : classes.techCardBack}`}>
                    <div className={classes.header} style={{backgroundColor: headerColor[props.data.label as string]}}>
                        <p>{`${props.data.label[0].toUpperCase()}${props.data.label.slice(1)}`}</p>
                        <FontAwesomeIcon className={classes.flipIcon} icon={faRepeat} onClick={() => {setFlipped(false)}}/>
                    </div>
                    <p>Back</p>
                </div>

            </div>

        </div>
    );
}