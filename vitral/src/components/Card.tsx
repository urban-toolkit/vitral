import classes from './Card.module.css'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRepeat } from '@fortawesome/free-solid-svg-icons'

export function Card(props: any) {
  return (
    <div className={`${classes.card} ${classes.flipCard}`}>
        <div className={classes.flipCardInner}>
            <div className={`${classes.flipCardFront} ${props.data.type == "social" ? classes.socialCard : classes.techCard}`}>
                <div className={classes.header}>
                    <p>Header</p>
                    <FontAwesomeIcon icon={faRepeat} />
                </div>
                <div className={classes.title}><p>{props.data.title}</p></div>
                <div className={classes.footer}><p>Footer</p></div>
            </div>
            <div className={classes.flipCardBack}>
                <p>Back</p>
            </div>
        </div>

    </div>
  );
}