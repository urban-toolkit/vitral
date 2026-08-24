import classes from "./EdgeConnectMenu.module.css";

export type EdgeConnectOption = "default" | "referenced_by" | "iteration_of";

type EdgeConnectMenuProps = {
    open: boolean;
    x: number;
    y: number;
    defaultLabel: string;
    /**
     * Optional lead-in, for the callers where the menu is not obviously about the edge under the
     * cursor. The drop-ring flow uses it to say how many cards the answer is about and which
     * activity they will hang off, because by the time the menu appears the drag is over and there
     * is nothing else on screen tying the question to what was dropped.
     */
    heading?: string;
    /** Renders an explicit way out. Without it, dismissing is the only cancel. */
    onCancel?: () => void;
    onSelect: (option: EdgeConnectOption) => void;
    onClose: () => void;
};

export function EdgeConnectMenu({
    open,
    x,
    y,
    defaultLabel,
    heading,
    onCancel,
    onSelect,
    onClose,
}: EdgeConnectMenuProps) {
    if (!open) return null;

    return (
        <div
            className={classes.menu}
            style={{ left: x, top: y }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            role="menu"
            aria-label="Select edge type"
        >
            {heading ? <div className={classes.heading}>{heading}</div> : null}

            <div className={classes.options}>
                <button
                    type="button"
                    className={`${classes.button} ${classes.default}`}
                    onClick={() => {
                        onSelect("default");
                        onClose();
                    }}
                >
                    {defaultLabel}
                </button>
                <button
                    type="button"
                    className={`${classes.button} ${classes.referenced}`}
                    onClick={() => {
                        onSelect("referenced_by");
                        onClose();
                    }}
                >
                    referenced by
                </button>
                <button
                    type="button"
                    className={`${classes.button} ${classes.iteration}`}
                    onClick={() => {
                        onSelect("iteration_of");
                        onClose();
                    }}
                >
                    iteration of
                </button>
                {onCancel ? (
                    <button
                        type="button"
                        className={`${classes.button} ${classes.cancel}`}
                        onClick={() => {
                            onCancel();
                            onClose();
                        }}
                    >
                        Cancel
                    </button>
                ) : null}
            </div>
        </div>
    );
}
