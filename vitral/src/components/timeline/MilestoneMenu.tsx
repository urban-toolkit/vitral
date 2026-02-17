import React from "react";
import classes from "./MilestoneMenu.module.css";

type Props = {
    x: number;
    y: number;
    onClose: () => void;
    onCreate?: () => void;
    onDelete?: () => void;
};

export const MilestoneMenu: React.FC<Props> = ({
    x,
    y,
    onCreate,
    onClose,
    onDelete
}) => {
    return (
        <div
            className={classes.menu}
            style={{ left: x, top: y }}
            onClick={(e) => e.stopPropagation()}
        >
            {
                onCreate 
                ? 
                    <button
                        className={classes.button}
                        onClick={() => {
                            onCreate();
                            onClose();
                        }}
                    >
                        + New milestone
                    </button>
                :
                null
            }

            {
                onDelete
                ? 
                    <button
                        className={classes.button}
                        onClick={() => {
                            onDelete();
                            onClose();
                        }}
                    >
                        Delete milestone
                    </button>
                :
                null
            }
        </div>
    );
};
