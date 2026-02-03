import classes from './Toolbar.module.css'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSquare, faFont, faDiagramProject, faCircleNodes, faWandSparkles, faArrowPointer } from '@fortawesome/free-solid-svg-icons'

type ToolbarProps = {
    onFreeInputClicked: () => void;
    onNodeInputClicked: () => void;
    onPointerClicked: () => void;
};

export function Toolbar({ onFreeInputClicked, onNodeInputClicked, onPointerClicked }: ToolbarProps) {

    return (
        <div className={classes.container}>
            <div className={classes.tool}>
                <FontAwesomeIcon icon={faArrowPointer} className={classes.toolIcon} onClick={() => { onPointerClicked() }} />
            </div>
            <div className={classes.tool}>
                <FontAwesomeIcon icon={faSquare} className={classes.toolIcon} onClick={() => { onNodeInputClicked() }} />
            </div>
            <div className={classes.tool}>
                <FontAwesomeIcon icon={faFont} className={classes.toolIcon} onClick={() => { onFreeInputClicked() }} />
            </div>
            <div className={classes.tool}>
                <FontAwesomeIcon icon={faDiagramProject} className={classes.toolIcon} />
            </div>
            <div className={classes.tool}>
                <FontAwesomeIcon icon={faCircleNodes} className={classes.toolIcon} />
            </div>
            <div className={classes.tool}>
                <FontAwesomeIcon icon={faWandSparkles} className={classes.toolIcon} />
            </div>
        </div>
    );
}