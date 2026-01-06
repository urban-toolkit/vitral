import { useState } from 'react';

import classes from './Card.module.css'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRepeat } from '@fortawesome/free-solid-svg-icons'

export function Card(props: any) {

    const [flipped, setFlipped] = useState(false);

    return (
        <div className={`${classes.card} ${classes.flipCard}`}>

            <div className={`${classes.flipCardInner} ${flipped ? classes.flipAnimation : ""}`}>

                <div className={`${classes.flipCardFront} ${props.data.type == "social" ? classes.socialCard : classes.techCard}`}>
                    <div className={classes.header}>
                        <p>({props.data.label})</p>
                        <FontAwesomeIcon className={classes.flipIcon} icon={faRepeat} onClick={() => {setFlipped(true)}}/>
                    </div>
                    <div className={classes.title}>
                        <p>{props.data.title}</p>
                    </div>
                    <div className={classes.footer}><p>Footer</p></div>
                </div>

                <div className={`${classes.flipCardBack} ${props.data.type == "social" ? classes.socialCardBack : classes.techCardBack}`}>
                    <div className={classes.header}>
                        <p>({props.data.label})</p>
                        <FontAwesomeIcon className={classes.flipIcon} icon={faRepeat} onClick={() => {setFlipped(false)}}/>
                    </div>
                    <p>Back</p>
                </div>

            </div>

        </div>
    );
}