import type { fileRecord, fileExtension } from "@/config/types";
import { useEffect, useRef } from "react";
import classes from './FileCarousel.module.css';
import { FilePreview } from "@/components/files/FilePreview";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage, faDatabase, faFileCode, faFileLines, type IconDefinition } from '@fortawesome/free-solid-svg-icons';

<FontAwesomeIcon icon={faDatabase} />

const extToIcon = (ext: fileExtension): IconDefinition  => {

    if(ext == 'png' || ext == 'jpg' || ext == 'jpeg') {
        return faImage;
    }else if(ext == 'csv' || ext == 'json'){
        return faDatabase;
    }else if(ext == 'css' || ext == 'html' || ext == 'ipynb' || ext == 'py' || ext == 'ts' || ext == 'js'){
        return faFileCode;
    }else if(ext == 'md' || ext == 'txt') {
        return faFileLines;
    }

    return faFileLines;
}

export function FileCarousel({ files, children }: { files: fileRecord[], children?: React.ReactNode }) {
    const scrollerRef = useRef<HTMLDivElement | null>(null);

    const scrollBySlides = (dir: -1 | 1) => {
        const el = scrollerRef.current;
        if (!el) return;

        const slideWidth = el.clientWidth;
        const currentIndex = Math.round(el.scrollLeft / slideWidth);
        const slideCount = el.children.length;
        const nextIndex = Math.min(slideCount - 1, Math.max(0, currentIndex + dir));

        el.scrollTo({
            left: nextIndex * slideWidth,
            behavior: "smooth",
        });
    };

    return (
        <div className={classes.carouselWrap}>
            <button
                type="button"
                className={`${classes.carouselBtn} ${classes.carouselBtnLeft}`}
                onClick={() => scrollBySlides(-1)}
                aria-label="Scroll left"
            >
                ‹
            </button>

            <div className={classes.fileCarousel} ref={scrollerRef}>

                {children ? <div className={classes.fileSlide}>{children}</div> : null}

                {files.map((file) => (
                    <div className={classes.fileSlide} key={file.id}>
                        {/* <div className={classes.fileDescription}>
                            <FontAwesomeIcon className={classes.flipIcon} icon={extToIcon(file.ext)} />
                            <p className={classes.fileName}>
                                {file.name}
                            </p>
                        </div> */}
                        <FilePreview
                            file={file}
                            key={file.id}
                        />
                    </div>
                ))}

            </div>

            <button
                type="button"
                className={`${classes.carouselBtn} ${classes.carouselBtnRight}`}
                onClick={() => scrollBySlides(1)}
                aria-label="Scroll right"
            >
                ›
            </button>
        </div>
    );
}
