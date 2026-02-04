import { useState } from 'react';

import classes from './FreeInputZone.module.css'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons'

type FreeInputZoneProps = {
    onInputSubmit: (x: number, y: number, userText: string) => void
};

export function FreeInputZone({onInputSubmit}: FreeInputZoneProps) {

    const [inputModal, setInputModal] = useState<boolean>(false);
    const [position, setPosition] = useState<{x: number, y: number}>({x: 0, y: 0});
    const [textValue, setTextValue] = useState<string>("");

    const clampNumber = (x: number, value: number) => {
        if(x > value)
            return value;
        else
            return x;
    };

    const handleKeyDown = (e: any) => {
        if(e.key == 'Enter') {
            onInputSubmit(position.x, position.y, textValue);
        }
    }

    return (
        <>
            <div 
                className={classes.cursorEventCaptureContainer}
                onClick={(e) => {
                    setInputModal(true);
                    setPosition({
                        x: e.clientX,
                        y: e.clientY
                    })
                }}
            ></div>

            {inputModal ?
                <div 
                    className={classes.inputContainer} 
                    style={{top: position.y, left: clampNumber(position.x, window.screen.width - 200)}}
                >
                    <textarea 
                        onKeyDown={handleKeyDown}
                        value={textValue}
                        onChange={(e: any) => {setTextValue(e.target.value)}}
                        placeholder='This note will become cards...'
                    />
                    <FontAwesomeIcon 
                        className={classes.confirmIcon} 
                        icon={faPaperPlane} 
                        onClick={() => {onInputSubmit(position.x, position.y, textValue)}}
                    />
                </div>            
            :
                null
            }
        </>

    );
}