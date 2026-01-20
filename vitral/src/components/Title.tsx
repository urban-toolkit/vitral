import { useState } from 'react';

import classes from './Title.module.css'

type TitleProps = {
    textTitle: string;
    onSetTitle: (newTitle: string) => void;
};

export function Title({ textTitle, onSetTitle }: TitleProps) {

    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(textTitle);

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
            </div>

            <div className={classes.subtitleContainer}>
                <p>Design studies are <span className={classes.socialTag}>social</span> and <span className={classes.technicalTag}>technical</span></p>
            </div>
        </div>
    );
}