import { useCallback, useState } from "react";

import {
    querySystemComponents,
    querySystemPapers,
    type QuerySystemComponentsResult,
    type QuerySystemPapersResult,
    type SystemPaperQueryCard,
} from "@/api/stateApi";

/**
 * Searching the Visual Analytics literature, at two granularities.
 *
 * The two modes answer different questions and are deliberately two buttons rather than a toggle,
 * because the input differs as much as the output:
 *
 * - **Blueprints** takes *every* requirement in the project and asks which published system covers
 *   them. The answer is a whole paper, and what you do with it is drag its structure into the tray.
 * - **Components** takes the requirements the researcher **selected on the canvas** and asks which
 *   individual blocks, from anywhere in the corpus, answer those. The answer is a blended list from
 *   several papers, and what you do with it is take the pieces.
 *
 * A toggle would imply one search with a display option. It is two searches, over two corpora, with
 * two different scopes — and the selection requirement is only meaningful for one of them.
 *
 * The state lives in a hook rather than inside one panel component because the two halves of the
 * search are no longer adjacent: the buttons sit above the tray's canvas and the results sit in a
 * column beside it, so that a result list never shortens the graph it is about to be dragged into.
 * A hook is what lets the tray place them independently without lifting a copy of this state.
 */

export type BlueprintSearchMode = "paper" | "component";

export type BlueprintSearch = {
    mode: BlueprintSearchMode | null;
    loading: boolean;
    error: string | null;
    paperResults: QuerySystemPapersResult[];
    componentResults: QuerySystemComponentsResult[];
    /** The paper whose components are unfolded, by file name. At most one at a time. */
    expanded: string | null;
    setExpanded: (fileName: string | null) => void;
    /** How many requirement cards the canvas has selected — the component search's scope. */
    selectedCount: number;
    runBlueprintSearch: () => void;
    runComponentSearch: () => void;
    /** Puts the results column away without forgetting which search was last run. */
    dismiss: () => void;
};

export function useBlueprintSearch({
    requirementCards,
    selectedRequirementCards,
}: {
    requirementCards: SystemPaperQueryCard[];
    selectedRequirementCards: SystemPaperQueryCard[];
}): BlueprintSearch {
    const [mode, setMode] = useState<BlueprintSearchMode | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [paperResults, setPaperResults] = useState<QuerySystemPapersResult[]>([]);
    const [componentResults, setComponentResults] = useState<QuerySystemComponentsResult[]>([]);
    const [expanded, setExpanded] = useState<string | null>(null);

    const runBlueprintSearch = useCallback(() => {
        if (requirementCards.length === 0) {
            setMode("paper");
            setPaperResults([]);
            setError("Add at least one requirement card first.");
            return;
        }

        setMode("paper");
        setLoading(true);
        setError(null);
        void (async () => {
            try {
                const response = await querySystemPapers({ cards: requirementCards, limit: 5 });
                setPaperResults(response.results);
                if (response.results.length === 0) {
                    setError("No system in the corpus matched these requirements.");
                }
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Search failed.");
                setPaperResults([]);
            } finally {
                setLoading(false);
            }
        })();
    }, [requirementCards]);

    const runComponentSearch = useCallback(() => {
        if (selectedRequirementCards.length === 0) return;

        setMode("component");
        setLoading(true);
        setError(null);
        void (async () => {
            try {
                const response = await querySystemComponents({
                    cards: selectedRequirementCards,
                    limit: 12,
                });
                setComponentResults(response.results);
                if (response.results.length === 0) {
                    setError("No component in the corpus matched the selected requirements.");
                }
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Search failed.");
                setComponentResults([]);
            } finally {
                setLoading(false);
            }
        })();
    }, [selectedRequirementCards]);

    const dismiss = useCallback(() => {
        setMode(null);
        setError(null);
        setExpanded(null);
    }, []);

    return {
        mode,
        loading,
        error,
        paperResults,
        componentResults,
        expanded,
        setExpanded,
        selectedCount: selectedRequirementCards.length,
        runBlueprintSearch,
        runComponentSearch,
        dismiss,
    };
}
