import { useEffect, useMemo, useRef, useState } from "react";
// import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useSelector, useDispatch } from 'react-redux';
import { setNodes, setEdges } from "@/store/flowSlice";
import { loadDocument, saveDocument } from "@/api/stateApi";
import { debounce } from "@/utils/debounce";

import type { RootState } from '@/store';

type SyncStatus = "idle" | "loading" | "saving" | "error" | "ready";

export function useDocumentSync(projectId: string) {
    const dispatch = useDispatch();
    const flow = useSelector((s: RootState) => s.flow);

    // const [docId, setDocId] = useState<string | null>(initialDocId ?? null);
    const [status, setStatus] = useState<SyncStatus>("idle");
    const [error, setError] = useState<string | null>(null);

    const lastSavedHashRef = useRef<string>("");
    const hasLoadedRef = useRef(false); // Blocks autosave until loading is done
    const activeProjectIdRef = useRef<string>(projectId);

    // Hash to avoid saving identical state repeatedly
    const currentHash = useMemo(() => {
        return JSON.stringify({
            nodes: flow.nodes,
            edges: flow.edges,
        });
    }, [flow.nodes, flow.edges]);

    // Debounced autosave whenever flow changes
    const debouncedSave = useMemo(
        () =>
            debounce(async (id: string, hash: string, nodes: any[], edges: any[]) => {

                if (activeProjectIdRef.current !== id) return;
                if (!hasLoadedRef.current) return;

                try {
                    setStatus("saving");
                    setError(null);

                    await saveDocument(id, {
                        flow: { nodes, edges },
                    });

                    lastSavedHashRef.current = hash;
                    setStatus("ready");
                } catch (e: any) {
                    setStatus("error");
                    setError(e?.message ?? "Failed to save project");
                }
            }, 800),
        []
    );

    // Load whenever projectId changes
    useEffect(() => {
        activeProjectIdRef.current = projectId;
        hasLoadedRef.current = false;
        debouncedSave.cancel(); // cancel any pending save from previous page/project

        const ac = new AbortController();

        async function init() {
            setStatus("loading");
            setError(null);

            try {
                const doc = await loadDocument(projectId);

                const serverFlow = doc.state?.flow;

                const nodes = serverFlow?.nodes ?? [];
                const edges = serverFlow?.edges ?? [];

                dispatch(setNodes(nodes));
                dispatch(setEdges(edges));

                lastSavedHashRef.current = JSON.stringify({ nodes, edges });
                hasLoadedRef.current = true;
                setStatus("ready");
            } catch (e: any) {
                if (ac.signal.aborted) return;
                setStatus("error");
                setError(e?.message ?? "Failed to load project");
            }
        }

        init();

        return () => {
            ac.abort();
            debouncedSave.cancel();
        };
    }, [projectId, dispatch, debouncedSave]);

    // Trigger autosave on flow changes (once loaded)
    useEffect(() => {
        if (!hasLoadedRef.current) return;
        if (status === "loading" || status === "error") return;

        if (currentHash === lastSavedHashRef.current) return;

        debouncedSave(projectId, currentHash, flow.nodes, flow.edges);
    }, [projectId, currentHash, flow.nodes, flow.edges, status, debouncedSave]);

    return { status, error };
}