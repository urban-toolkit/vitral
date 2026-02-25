import { useCallback, useState } from "react";

import classes from './AttachFileZone.module.css'

type AttachFileZoneProps = {
  onFileSelected: (file: File) => void;
  dropZoneCSS: React.CSSProperties;
  loading: boolean;
  accept?: string;
};

export function AttachFileZone({ onFileSelected, loading, accept, dropZoneCSS }: AttachFileZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  // useEffect(() => {
  //     const onDragEnter = (e: DragEvent) => {
  //         if (e.dataTransfer?.types.includes("Files")) {
  //             setIsDragging(true);
  //         }
  //     };

  //     const onDragEnd = () => {
  //         setIsDragging(false);
  //     };

  //     const onDragOver = () => {
  //         setIsDragging(true);
  //     }

  //     const onDragLeave = () => {
  //         setIsDragging(false);
  //     }

  //     window.addEventListener("dragenter", onDragEnter);
  //     window.addEventListener("dragover", onDragOver);
  //     window.addEventListener("dragend", onDragEnd);
  //     window.addEventListener("dragleave", onDragLeave);
  //     window.addEventListener("drop", onDragEnd);

  //     return () => {
  //         window.removeEventListener("dragenter", onDragEnter);
  //         window.removeEventListener("dragover", onDragOver);
  //         window.removeEventListener("dragend", onDragEnd);
  //         window.removeEventListener("drop", onDragEnd);
  //     };
  // }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
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

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

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
    <div style={dropZoneCSS} className={`${isDragging ? "" : classes.inactive}`}>
      <label
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
        className={classes.label}
      >

        <input
          type="file"
          accept={accept}
          onChange={handleInputChange}
          onClick={(event: any) => { event.preventDefault() }}
          hidden
        />

        <div className={classes.content}>
          <p>Attach file</p>
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


    </div>

  );
}
