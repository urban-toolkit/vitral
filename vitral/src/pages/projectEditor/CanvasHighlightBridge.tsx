import { useEffect } from "react";
import { useSelector } from "react-redux";

import { selectHighlightedKnowledgeNodeIds } from "@/store/timelineSlice";
import { setHighlightedKnowledgeNodeIds } from "@/store/canvasHighlightStore";

/**
 * The one place that reads Redux's knowledge-pill hover and forwards it to `canvasHighlightStore`.
 *
 * Redux stays the source of truth; keeping the read out of `ProjectEditorPage` is the point. A
 * selector there fed the node-derivation chain, so hovering off a pill re-ran clustering, abstraction
 * and the whole layout. Here it feeds nothing but a set comparison.
 */
export function CanvasHighlightBridge() {
    const highlightedKnowledgeNodeIds = useSelector(selectHighlightedKnowledgeNodeIds);

    useEffect(() => {
        setHighlightedKnowledgeNodeIds(highlightedKnowledgeNodeIds);
    }, [highlightedKnowledgeNodeIds]);

    return null;
}
