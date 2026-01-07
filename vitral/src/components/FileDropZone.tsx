import { useCallback, useState } from "react";

import classes from './FileDropZone.module.css'

type FileDropZoneProps = {
    onFileSelected: (file: File) => void;
    accept?: string;
};

export function FileDropZone({ onFileSelected, accept }: FileDropZoneProps) {
    const [isDragging, setIsDragging] = useState(false);

    const handleDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const file = e.dataTransfer.files?.[0];
        if (file) {
            onFileSelected(file);
        }
    }, [onFileSelected]);

    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) {
                onFileSelected(file);
            }
        },
        [onFileSelected]
    );

    return (
        <label
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={classes.dropZone}
        >

            <input
                type="file"
                accept={accept}
                onChange={handleInputChange}
                onClick={(event: any) => {event.preventDefault()}}
                hidden
            />

            <div>
                <strong>Drag & drop a file here</strong>
            </div>

        </label>
    );
}
