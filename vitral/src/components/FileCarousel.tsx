import type { fileData } from "@/config/types";
import { useRef } from "react";
import classes from './FileCarousel.module.css';
import { FilePreview } from "./FilePreview";

export function FileCarousel({ files, children }: { files: fileData[], children?: React.ReactNode }) {
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
                {files.map((file) => (
                    <div className={classes.fileSlide} key={file.id}>
                        {/* <p className={classes.fileName}>{file.name}</p> */}
                        <FilePreview
                            file={file}
                        />
                    </div>
                ))}

                {children ? <div className={classes.fileSlide}>{children}</div> : null}
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
