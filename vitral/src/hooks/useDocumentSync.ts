import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useSelector, useDispatch } from 'react-redux';
import { setNodes, setEdges } from "@/store/flowSlice";
import { createDocument, loadDocument, saveDocument } from "@/api/stateApi";
import { debounce } from "@/utils/debounce";

import type { RootState } from '@/store';

type SyncStatus = "idle" | "loading" | "saving" | "error" | "ready";

export function useDocumentSync(initialDocId?: string) {
    const dispatch = useDispatch();
    const flow = useSelector((s: RootState) => s.flow);

    const [docId, setDocId] = useState<string | null>(initialDocId ?? null);
    const [status, setStatus] = useState<SyncStatus>("idle");
    const [error, setError] = useState<string | null>(null);
    const lastSavedHashRef = useRef<string>("");

    // Hash to avoid saving identical state repeatedly
    const currentHash = useMemo(() => {
        return JSON.stringify({
            nodes: flow.nodes,
            edges: flow.edges,
        });
    }, [flow.nodes, flow.edges]);

    // Load or create doc on mount
    useEffect(() => {
        let cancelled = false;

        async function init() {
            setStatus("loading");
            setError(null);

            try {
                let id = docId;

                // If no docId, create one using current local state
                if (!id) {
                    const created = await createDocument("Untitled", {
                        flow: { nodes: flow.nodes, edges: flow.edges },
                    });
                    id = created.id;
                    if (!cancelled) setDocId(id);
                    localStorage.setItem("vitral_doc_id", id);
                    // created response doesn't include state; we already have it locally
                    lastSavedHashRef.current = currentHash;
                    if (!cancelled) setStatus("ready");
                    return;
                }

                // If docId exists, load from server and overwrite local Redux flow
                const doc = await loadDocument(id);
                const serverFlow = doc.state?.flow;

                if (serverFlow) {
                    if (!cancelled) {
                        dispatch(setNodes(serverFlow.nodes ?? []));
                        dispatch(setEdges(serverFlow.edges ?? []));
                    }
                    // mark as saved so we don't immediately re-save the same content
                    lastSavedHashRef.current = JSON.stringify({
                        nodes: serverFlow.nodes ?? [],
                        edges: serverFlow.edges ?? [],
                    });
                } else {
                    // If server doc exists but has no state, treat current as saved
                    lastSavedHashRef.current = currentHash;
                }

                if (!cancelled) setStatus("ready");
            } catch (e: any) {
                if (!cancelled) {
                    setStatus("error");
                    setError(e?.message ?? "Failed to init doc sync");
                }
            }
        }

        init();

        return () => {
            cancelled = true;
        };
        // We only want to init once for docId changes, not for flow changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dispatch, docId]);

    // Debounced autosave whenever flow changes
    const debouncedSave = useMemo(
        () =>
            debounce(async (id: string, hash: string) => {
                try {
                    setStatus("saving");
                    setError(null);

                    await saveDocument(id, {
                        flow: { nodes: flow.nodes, edges: flow.edges },
                    });

                    lastSavedHashRef.current = hash;
                    setStatus("ready");
                } catch (e: any) {
                    setStatus("error");
                    setError(e?.message ?? "Save failed");
                }
            }, 800),
        [docId]
    );

    useEffect(() => {
        if (!docId) return;
        if (status === "loading") return;

        // don't save if nothing changed since last successful save
        if (currentHash === lastSavedHashRef.current) return;

        debouncedSave(docId, currentHash);
    }, [docId, currentHash, debouncedSave, status]);

    const resetDoc = useCallback(async () => {
        localStorage.removeItem("vitral_doc_id");
        setDocId(null);
    }, []);

    return { docId, status, error, resetDoc };
}