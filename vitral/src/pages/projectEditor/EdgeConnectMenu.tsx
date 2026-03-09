import classes from "./EdgeConnectMenu.module.css";

export type EdgeConnectOption = "default" | "referenced_by" | "iteration_of";

type EdgeConnectMenuProps = {
    open: boolean;
    x: number;
    y: number;
    defaultLabel: string;
    onSelect: (option: EdgeConnectOption) => void;
    onClose: () => void;
};

export function EdgeConnectMenu({
    open,
    x,
    y,
    defaultLabel,
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
        </div>
    );
}
