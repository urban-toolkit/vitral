import { useEffect, useMemo, useRef, useState } from "react";
// import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useSelector, useDispatch } from 'react-redux';
import { setNodes, setEdges, setTitle } from "@/store/flowSlice";
import { listFiles, loadDocument, saveDocument } from "@/api/stateApi";
import { debounce } from "@/utils/debounce";

import type { RootState } from '@/store';
import { setFiles } from "@/store/filesSlice";
import { selectAllStages, selectAllSubStages, selectDefaultStages, selectTimelineStartEnd, setDefaultStages, setStages, setSubStages, setTimelineStartEnd } from "@/store/timelineSlice";
import type { Stage, SubStage } from "@/config/types";

type SyncStatus = "idle" | "loading" | "saving" | "error" | "ready";

export function useDocumentSync(projectId: string) {
    const dispatch = useDispatch();
    const flow = useSelector((s: RootState) => s.flow);
    const stages = useSelector(selectAllStages);
    const subStages = useSelector(selectAllSubStages);
    const defaultStages = useSelector(selectDefaultStages);
    const timelineStartEnd = useSelector(selectTimelineStartEnd);

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
            title: flow.title,
            stages: stages,
            subStages: subStages,
            defaultStages: defaultStages,
            timelineStartEnd: timelineStartEnd
        });
    }, [flow.nodes, flow.edges, flow.title, stages, subStages, defaultStages, timelineStartEnd]);

    // Debounced autosave whenever flow changes
    const debouncedSave = useMemo(
        () =>
            debounce(async (
                id: string, 
                hash: string, 
                nodes: any[], 
                edges: any[], 
                stages: Stage[], 
                subStages: SubStage[], 
                defaultStages: string[], 
                timelineStartEnd: {start: string, end: string},  
                title?: string) => {

                if (activeProjectIdRef.current !== id) return;
                if (!hasLoadedRef.current) return;

                try {
                    setStatus("saving");
                    setError(null);

                    await saveDocument(id, {
                        flow: { nodes, edges },
                    }, {
                        stages,
                        subStages,
                        defaultStages,
                        timelineStartEnd
                    }, title);

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
                const title = doc.title ?? "Untitled";

                dispatch(setNodes(nodes));
                dispatch(setEdges(edges));
                dispatch(setTitle(title));

                const { files } = await listFiles(projectId);

                dispatch(setFiles(files));

                const timeline = doc.timeline;

                const stages = timeline?.stages ?? [];
                const subStages = timeline?.subStages ?? [];
                const defaultStages = timeline?.defaultStages ?? [];
                const timelineStartEnd = timeline?.timelineStartEnd ?? {start: "", end: ""};

                dispatch(setStages(stages));
                dispatch(setSubStages(subStages));
                dispatch(setDefaultStages(defaultStages));
                dispatch(setTimelineStartEnd(timelineStartEnd));

                lastSavedHashRef.current = JSON.stringify({ 
                    nodes, 
                    edges, 
                    title, 
                    stages, 
                    subStages, 
                    defaultStages, 
                    timelineStartEnd });
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

        debouncedSave(projectId, currentHash, flow.nodes, flow.edges, stages, subStages, defaultStages, timelineStartEnd, flow.title);
    }, [projectId, currentHash, flow.nodes, flow.edges, flow.title, status, debouncedSave, stages, subStages, defaultStages, timelineStartEnd]);

    return { status, error };
}