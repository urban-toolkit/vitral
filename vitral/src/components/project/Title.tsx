import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear } from '@fortawesome/free-solid-svg-icons';

import classes from './Title.module.css'

type TitleProps = {
    textTitle: string;
    onSetTitle: (newTitle: string) => void;
    onOpenSettings?: () => void;
};

export function Title({ textTitle, onSetTitle, onOpenSettings }: TitleProps) {

    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(textTitle);

    useEffect(() => {
        setTitle(textTitle);
    }, [textTitle]);

    const newTitle = (newTitle: string) => {
        onSetTitle(newTitle);
    }

    return (
        <div className={classes.container}>
            <div className={classes.titleContainer}>
                {
                    editing 
                    ? 
                        <input type="text" value={title} onBlur={() => {setEditing(false); newTitle(title)}} onChange={(event: React.ChangeEvent<HTMLInputElement>) => {setTitle(event.target.value)}}/>
                    :
                        <p onClick={() => {setEditing(true)}}>{title}</p>
                }

                {onOpenSettings ? (
                    <button
                        type="button"
                        className={classes.settingsButton}
                        onClick={onOpenSettings}
                        title="Project settings"
                        aria-label="Project settings"
                    >
                        <FontAwesomeIcon icon={faGear} />
                    </button>
                ) : null}
            </div>

            <div className={classes.subtitleContainer}>
                <p>Design studies are <span className={classes.socialTag}>social</span> and <span className={classes.technicalTag}>technical</span></p>
            </div>
        </div>
    );
}
