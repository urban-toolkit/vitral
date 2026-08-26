import { useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";

/** `drag` tracks a file being dragged over the canvas; `tool` tracks the pointer for a card tool. */
export type CanvasTargetReason = "drag" | "tool";

/**
 * Which creation target the pointer is currently over.
 *
 * Hover tracking lives here, next to the overlays that draw the targets, on purpose: the highlight
 * follows the pointer at frame rate and keeping the state local avoids re-rendering the whole
 * editor page on every mouse move. `findTarget` has to be a stable reference — a module-level
 * function — or the listener is torn down and rebuilt on every render.
 */
export function useHoveredCanvasTarget<T extends { key: string }>(
    targets: readonly T[],
    reason: CanvasTargetReason,
    findTarget: (targets: readonly T[], position: { x: number; y: number }) => T | null,
): string | null {
    const { screenToFlowPosition } = useReactFlow();
    const [activeKey, setActiveKey] = useState<string | null>(null);

    useEffect(() => {
        let frame: number | null = null;
        let latestScreenPosition: { x: number; y: number } | null = null;

        const flush = () => {
            frame = null;
            if (!latestScreenPosition) return;
            const target = findTarget(targets, screenToFlowPosition(latestScreenPosition));
            setActiveKey(target?.key ?? null);
        };

        const track = (event: Event) => {
            const pointerEvent = event as MouseEvent;
            latestScreenPosition = { x: pointerEvent.clientX, y: pointerEvent.clientY };
            if (frame === null) frame = window.requestAnimationFrame(flush);
        };

        // Capture phase, because both card attach zones (drag events) and React Flow's node drag
        // handling (pointer events) call stopPropagation before the event reaches window.
        const options: AddEventListenerOptions = { capture: true, passive: true };
        const eventName = reason === "drag" ? "dragover" : "pointermove";
        window.addEventListener(eventName, track, options);

        return () => {
            window.removeEventListener(eventName, track, options);
            if (frame !== null) window.cancelAnimationFrame(frame);
        };
    }, [findTarget, reason, screenToFlowPosition, targets]);

    // Drop the highlight when the tracked target is no longer on offer (its card was deleted, the
    // filters changed) instead of resetting state from an effect.
    return targets.some((target) => target.key === activeKey) ? activeKey : null;
}
