import { useCallback, useRef } from "react";
import type { Viewport } from "@xyflow/react";

import { lodForZoom, showsClusterHalos, type CanvasLod } from "@/pages/projectEditor/canvasLod";

/** The initial tier, matching the `data-lod` React Flow is rendered with. */
const INITIAL_LOD: CanvasLod = "near";

/**
 * Quantisation for `--canvas-zoom`. Three decimals is finer than a pixel at any label size the halos
 * use, and it stops a pan's floating-point jitter from writing the property on frames where the zoom
 * did not really move.
 */
const ZOOM_PRECISION = 1000;

/**
 * Writes the current level of detail onto the flow wrapper as `data-lod`, whether the cluster halos
 * are showing as `data-cluster-halo`, and — for the halos alone — the live zoom as a `--canvas-zoom`
 * custom property. All three from the pan/zoom animation frame, through refs.
 *
 * No state, so no render: the whole point is that a 60fps gesture must not enter React. The two
 * attributes are touched only when their own tier changes, so a full zoom sweep costs a handful of
 * style recalculations rather than sixty. The CSS that reads them lives next to the classes they
 * govern, in `Card.module.css` and `ClusterHalos.module.css`.
 *
 * `--canvas-zoom` is the one thing here that genuinely has to be written per frame, because it is
 * what lets a halo's title hold a constant *screen* size while the viewport scales everything else —
 * and a title that shrinks with the canvas is no use to somebody who zoomed out to read it. Two
 * things keep that affordable. It is written to the halo overlay's own wrapper rather than to the
 * flow root, so the recalculation touches a handful of divs instead of the whole React Flow subtree;
 * and it is written only while the halos are actually showing, which is the bottom of the zoom range
 * and nowhere near where the canvas is normally worked in.
 */
export function useCanvasLod() {
    const wrapperRef = useRef<HTMLDivElement>(null);
    /** Attached by `ClusterHalos` to the element that wraps every halo. */
    const haloScaleRef = useRef<HTMLDivElement>(null);
    const lodRef = useRef<CanvasLod>(INITIAL_LOD);
    const haloRef = useRef<boolean>(false);
    /** What was last written, **and where**. The element is half the key — see below. */
    const zoomRef = useRef<number>(0);
    const zoomHostRef = useRef<HTMLDivElement | null>(null);

    const applyLod = useCallback((zoom: number) => {
        const next = lodForZoom(zoom, lodRef.current);
        if (next !== lodRef.current) {
            lodRef.current = next;
            wrapperRef.current?.setAttribute("data-lod", next);
        }

        const halos = showsClusterHalos(zoom);
        if (halos !== haloRef.current) {
            haloRef.current = halos;
            wrapperRef.current?.setAttribute("data-cluster-halo", halos ? "on" : "off");
        }

        if (!halos) return;
        const quantised = Math.round(zoom * ZOOM_PRECISION) / ZOOM_PRECISION;
        if (quantised <= 0) return;

        /**
         * The written value is remembered against the element it was written on, because the overlay
         * comes and goes: `ClusterHalos` is mounted only at Overview and Threads, so `haloScaleRef` is
         * null for the whole of Detail. Recording the zoom while there was nowhere to put it would
         * leave the ref claiming a value the new element never received — and the next frame, seeing
         * no change, would skip the write. Every halo would then sit on the CSS fallback until the
         * reader happened to zoom to a different number.
         */
        const host = haloScaleRef.current;
        if (host === null) {
            zoomHostRef.current = null;
            return;
        }
        if (host === zoomHostRef.current && quantised === zoomRef.current) return;
        zoomRef.current = quantised;
        zoomHostRef.current = host;
        host.style.setProperty("--canvas-zoom", String(quantised));
    }, []);

    const handleLodMove = useCallback((_event: unknown, viewport: Viewport) => {
        applyLod(viewport.zoom);
    }, [applyLod]);

    /** `fitView` settles the viewport before any gesture, so seed the tiers from it. */
    const handleLodInit = useCallback((instance: { getZoom: () => number }) => {
        applyLod(instance.getZoom());
    }, [applyLod]);

    return { wrapperRef, haloScaleRef, handleLodMove, handleLodInit };
}
