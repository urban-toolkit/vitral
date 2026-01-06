import { useState } from 'react';

import classes from './Title.module.css'

export function Title(_props: any) {

    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState("Untitled");

    return (
        <div className={classes.container}>
            <div className={classes.titleContainer}>
                {
                    editing 
                    ? 
                        <input type="text" value={title} onBlur={() => {setEditing(false)}} onChange={(event: React.ChangeEvent<HTMLInputElement>) => {setTitle(event.target.value)}}/>
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