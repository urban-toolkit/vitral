import { useCallback, useState, useEffect } from "react";

import classes from './FileDropZone.module.css'

type FileDropZoneProps = {
    onFileSelected: (file: File) => void;
    loading: boolean;
    accept?: string;
};

export function FileDropZone({ onFileSelected, loading, accept }: FileDropZoneProps) {
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const onDragEnter = (e: DragEvent) => {
            if (e.dataTransfer?.types.includes("Files")) {
                setIsDragging(true);
            }
        };

        const onDragEnd = () => {
            setIsDragging(false);
        };

        const onDragOver = () => {
            setIsDragging(true);
        }

        window.addEventListener("dragenter", onDragEnter);
        window.addEventListener("dragover", onDragOver);
        window.addEventListener("dragend", onDragEnd);
        window.addEventListener("drop", onDragEnd);

        return () => {
            window.removeEventListener("dragenter", onDragEnter);
            window.removeEventListener("dragover", onDragOver);
            window.removeEventListener("dragend", onDragEnd);
            window.removeEventListener("drop", onDragEnd);
        };
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
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
        <>
            <label
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`${classes.dropZone} ${isDragging ? "" : classes.inactive}`}
            >

                <input
                    type="file"
                    accept={accept}
                    onChange={handleInputChange}
                    onClick={(event: any) => {event.preventDefault()}}
                    hidden
                />

                <div className={classes.content}>
                    <p>Drag and drop files here</p>
                </div>

            </label>
        
            {loading ? 
                <div className={classes.spinnerContainer}>
                    <div 
                        className={classes.spinner}
                        aria-label="Loading"
                    />
                </div> 
                : 
                null}


        </>

    );
}
