import { useEffect } from 'react';
import classes from './FileModal.module.css';

export default function FileModal({
    open,
    onClose,
    title,
    children,
}: {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
}) {
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            onMouseDown={onClose}
            className={`${classes.outerModal} nowheel`}
        >
            <div
                onMouseDown={(e) => e.stopPropagation()}
                className={classes.innerModal}
            >
                <div
                    className={classes.headerModal}
                >
                    <div
                        className={classes.titleModal}
                        title={title}
                    >
                        {title ?? "Preview"}
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className={classes.closeModal}
                    >
                        Close
                    </button>
                </div>

                <div
                    className={classes.contentModal}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}