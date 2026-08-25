import classes from './Toolbar.module.css'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSquare, faArrowPointer, faCircle, faNoteSticky } from '@fortawesome/free-solid-svg-icons'
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
            <button type="button" className={`${classes.tool} ${isActive("") ? classes.toolActive : ""}`} onClick={onPointerClicked} title="Pointer" aria-label="Pointer" aria-pressed={isActive("")}>
                <FontAwesomeIcon icon={faArrowPointer} className={classes.toolIcon} />
            </button>
            <button type="button" className={`${classes.tool} ${isActive("node") ? classes.toolActive : ""}`} onClick={onNodeInputClicked} title="New card" aria-label="New card" aria-pressed={isActive("node")}>
                <FontAwesomeIcon icon={faSquare} className={classes.toolIcon} />
            </button>
            <button type="button" className={`${classes.tool} ${isActive("blueprint_component") ? classes.toolActive : ""}`} onClick={onBlueprintComponentClicked} title="New system component" aria-label="New system component" aria-pressed={isActive("blueprint_component")}>
                <FontAwesomeIcon
                    icon={faCircle}
                    className={classes.toolIcon}
                />
            </button>
            <button type="button" className={`${classes.tool} ${isActive("text") ? classes.toolActive : ""}`} onClick={onFreeInputClicked} title="Note" aria-label="Note" aria-pressed={isActive("text")}>
                <FontAwesomeIcon icon={faNoteSticky} className={classes.toolIcon} />
            </button>
        </div>
    );
}
