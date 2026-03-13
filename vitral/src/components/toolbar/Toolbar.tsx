import classes from './Toolbar.module.css'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSquare, faArrowPointer, faCircle } from '@fortawesome/free-solid-svg-icons'
import type { CursorMode } from '@/pages/projectEditor/types';

type ToolbarProps = {
    onFreeInputClicked: () => void;
    onNodeInputClicked: () => void;
    onBlueprintComponentClicked: () => void;
    onPointerClicked: () => void;
    activeMode: CursorMode;
    shifted?: boolean;
};

export function Toolbar({
    onFreeInputClicked,
    onNodeInputClicked,
    onBlueprintComponentClicked,
    onPointerClicked,
    activeMode,
    shifted,
}: ToolbarProps) {
    void onFreeInputClicked;

    const isActive = (mode: CursorMode) => activeMode === mode;

    return (
        <div 
            className={classes.container}
            style={
                shifted
                ?
                {bottom: "395px"}
                :
                {bottom: "15px"}
            }    
        >
            <button type="button" className={`${classes.tool} ${isActive("") ? classes.toolActive : ""}`} onClick={onPointerClicked} title="Pointer">
                <FontAwesomeIcon icon={faArrowPointer} className={classes.toolIcon} />
            </button>
            <button type="button" className={`${classes.tool} ${isActive("node") ? classes.toolActive : ""}`} onClick={onNodeInputClicked} title="New card">
                <FontAwesomeIcon icon={faSquare} className={classes.toolIcon} />
            </button>
            <button type="button" className={`${classes.tool} ${isActive("blueprint_component") ? classes.toolActive : ""}`} onClick={onBlueprintComponentClicked} title="New system component">
                <FontAwesomeIcon
                    icon={faCircle}
                    className={classes.toolIcon}
                />
            </button>
            {/* <button type="button" className={`${classes.tool} ${isActive("text") ? classes.toolActive : ""}`} onClick={onFreeInputClicked} title="Text tool">
                <FontAwesomeIcon icon={faFont} className={classes.toolIcon} />
            </button>
            <button type="button" className={classes.tool}>
                <FontAwesomeIcon icon={faWandSparkles} className={classes.toolIcon} />
            </button> */}
        </div>
    );
}
