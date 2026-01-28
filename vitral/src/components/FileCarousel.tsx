import type { fileData } from "@/config/types";
import { useRef } from "react";

export function FileCarousel({ files }: { files: fileData[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const scrollBySlides = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;

    el.scrollBy({ left: dir * 180, behavior: "smooth" });
  };

  return (
    <div className="carouselWrap">
      <button
        type="button"
        className="carouselBtn left"
        onClick={() => scrollBySlides(-1)}
        aria-label="Scroll left"
      >
        ‹
      </button>

      <div className="fileCarousel" ref={scrollerRef}>
        {files.map((file) => (
          <div className="fileSlide" key={file.id}>
            <p className="fileName">{file.name}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="carouselBtn right"
        onClick={() => scrollBySlides(1)}
        aria-label="Scroll right"
      >
        ›
      </button>
    </div>
  );
}
