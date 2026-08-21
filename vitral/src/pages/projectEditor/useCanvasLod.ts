import { useCallback, useRef } from "react";
import type { Viewport } from "@xyflow/react";

import { lodForZoom, type CanvasLod } from "@/pages/projectEditor/canvasLod";

/** The initial tier, matching the `data-lod` React Flow is rendered with. */
const INITIAL_LOD: CanvasLod = "near";

/**
 * Writes the current level of detail onto the flow wrapper as a `data-lod` attribute, from the
 * pan/zoom animation frame, through a ref.
 *
 * No state, so no render: the whole point is that a 60fps gesture must not enter React. The attribute
 * is touched only when the tier actually changes, so a full zoom sweep costs at most two attribute
 * writes — two style recalculations rather than sixty. The CSS that reads it lives next to the
 * classes it hides, in `Card.module.css`.
 */
export function useCanvasLod() {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const lodRef = useRef<CanvasLod>(INITIAL_LOD);

    const applyLod = useCallback((zoom: number) => {
        const next = lodForZoom(zoom, lodRef.current);
        if (next === lodRef.current) return;
        lodRef.current = next;
        wrapperRef.current?.setAttribute("data-lod", next);
    }, []);

    const handleLodMove = useCallback((_event: unknown, viewport: Viewport) => {
        applyLod(viewport.zoom);
    }, [applyLod]);

    /** `fitView` settles the viewport before any gesture, so seed the tier from it. */
    const handleLodInit = useCallback((instance: { getZoom: () => number }) => {
        applyLod(instance.getZoom());
    }, [applyLod]);

    return { wrapperRef, handleLodMove, handleLodInit };
}
