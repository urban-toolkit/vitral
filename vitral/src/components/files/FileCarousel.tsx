import type { fileRecord } from "@/config/types";
import { useEffect, useRef, useState } from "react";

import classes from "./FileCarousel.module.css";
import { FilePreview } from "@/components/files/FilePreview";

const persistedSlideByKey = new Map<string, number>();

export function FileCarousel({
    files,
    children,
    persistKey,
}: {
    files: fileRecord[];
    children?: React.ReactNode;
    persistKey?: string;
}) {
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const prevFileCountRef = useRef(files.length);
    const [activeIndex, setActiveIndex] = useState(() => {
        if (!persistKey) return 0;
        return persistedSlideByKey.get(persistKey) ?? 0;
    });

    const totalSlides = files.length + (children ? 1 : 0);
    const currentIndex = totalSlides === 0 ? 0 : Math.min(activeIndex, totalSlides - 1);

    const scrollToSlide = (index: number, behavior: ScrollBehavior = "smooth") => {
        const el = scrollerRef.current;
        if (!el || totalSlides === 0) return;

        const slideWidth = el.clientWidth;
        const clampedIndex = Math.min(totalSlides - 1, Math.max(0, index));

        el.scrollTo({
            left: clampedIndex * slideWidth,
            behavior,
        });
    };

    const scrollBySlides = (dir: -1 | 1) => {
        const el = scrollerRef.current;
        if (!el || totalSlides === 0) return;

        const slideWidth = el.clientWidth;
        const currentIndex = Math.round(el.scrollLeft / slideWidth);
        const nextIndex = Math.min(totalSlides - 1, Math.max(0, currentIndex + dir));

        scrollToSlide(nextIndex);
    };

    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;

        const onScroll = () => {
            const slideWidth = el.clientWidth;
            if (slideWidth === 0) return;

            const index = Math.round(el.scrollLeft / slideWidth);
            const clampedIndex = Math.min(totalSlides - 1, Math.max(0, index));

            setActiveIndex(clampedIndex);
        };

        el.addEventListener("scroll", onScroll, { passive: true });
        onScroll();

        return () => {
            el.removeEventListener("scroll", onScroll);
        };
    }, [totalSlides]);

    useEffect(() => {
        const previousCount = prevFileCountRef.current;
        const currentCount = files.length;
        prevFileCountRef.current = currentCount;

        if (currentCount > previousCount) {
            requestAnimationFrame(() => {
                const el = scrollerRef.current;
                if (!el) return;

                const slideWidth = el.clientWidth;

                // Focus the newest attached file.
                el.scrollTo({
                    left: Math.max(0, (currentCount - 1) * slideWidth),
                    behavior: "smooth",
                });
            });
        }
    }, [files.length]);

    useEffect(() => {
        if (!persistKey) return;
        persistedSlideByKey.set(persistKey, currentIndex);
    }, [persistKey, currentIndex]);

    useEffect(() => {
        if (totalSlides === 0) return;

        const el = scrollerRef.current;
        if (!el) return;

        const slideWidth = el.clientWidth;
        const clampedIndex = Math.min(totalSlides - 1, Math.max(0, currentIndex));

        requestAnimationFrame(() => {
            el.scrollTo({
                left: clampedIndex * slideWidth,
                behavior: "auto",
            });
        });
    }, [persistKey, totalSlides, currentIndex]);

    return (
        <div className={classes.carouselWrap}>
            <button
                type="button"
                className={`${classes.carouselBtn} ${classes.carouselBtnLeft}`}
                onClick={() => scrollBySlides(-1)}
                disabled={currentIndex === 0}
                aria-label="Scroll left"
            >
                {"<"}
            </button>

            <div className={classes.fileCarousel} ref={scrollerRef}>
                {files.map((file) => (
                    <div className={classes.fileSlide} key={file.id}>
                        <FilePreview file={file} />
                    </div>
                ))}

                {children ? <div className={classes.fileSlide}>{children}</div> : null}
            </div>

            <button
                type="button"
                className={`${classes.carouselBtn} ${classes.carouselBtnRight}`}
                onClick={() => scrollBySlides(1)}
                disabled={currentIndex >= totalSlides - 1}
                aria-label="Scroll right"
            >
                {">"}
            </button>

            {totalSlides > 1 ? (
                <div className={classes.carouselDots} aria-label="Carousel pagination">
                    {Array.from({ length: totalSlides }).map((_, index) => (
                        <button
                            type="button"
                            key={`dot-${index}`}
                            className={`${classes.carouselDot} ${index === currentIndex ? classes.carouselDotActive : ""}`}
                            onClick={() => scrollToSlide(index)}
                            aria-label={`Go to slide ${index + 1}`}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
