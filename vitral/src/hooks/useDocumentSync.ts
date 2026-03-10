import { useEffect, useMemo, useRef, useState } from "react";
// import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useSelector, useDispatch } from 'react-redux';
import { setNodes, setEdges, setTitle } from "@/store/flowSlice";
import { listFiles, loadDocument, saveDocument } from "@/api/stateApi";
import { debounce } from "@/utils/debounce";

import type { RootState } from '@/store';
import { setFiles } from "@/store/filesSlice";
import {
    selectAllBlueprintEvents,
    selectBlueprintCodebaseLinks,
    selectAllDesignStudyEvents,
    selectSystemScreenshotMarkers,
    selectParticipants,
    selectAllStages,
    selectAllSubStages,
    selectCodebaseSubtracks,
    selectDefaultStages,
    selectTimelineStartEnd,
    setCodebaseSubtracks,
    setBlueprintCodebaseLinks,
    setSystemScreenshotMarkers,
    setBlueprintEvents,
    setParticipants,
    setDefaultStages,
    setDesignStudyEvents,
    setStages,
    setSubStages,
    setTimelineStartEnd
} from "@/store/timelineSlice";
import type {
    BlueprintCodebaseLink,
    BlueprintEvent,
    CodebaseSubtrack,
    DesignStudyEvent,
    Stage,
    SubStage,
    SystemScreenshotMarker,
} from "@/config/types";

type SyncStatus = "idle" | "loading" | "saving" | "error" | "ready";

export function useDocumentSync(projectId: string) {
    const dispatch = useDispatch();
    const flow = useSelector((s: RootState) => s.flow);
    const stages = useSelector(selectAllStages);
    const subStages = useSelector(selectAllSubStages);
    const designStudyEvents = useSelector(selectAllDesignStudyEvents);
    const blueprintEvents = useSelector(selectAllBlueprintEvents);
    const blueprintCodebaseLinks = useSelector(selectBlueprintCodebaseLinks);
    const systemScreenshotMarkers = useSelector(selectSystemScreenshotMarkers);
    const codebaseSubtracks = useSelector(selectCodebaseSubtracks);
    const participants = useSelector(selectParticipants);
    const defaultStages = useSelector(selectDefaultStages);
    const timelineStartEnd = useSelector(selectTimelineStartEnd);

    const [status, setStatus] = useState<SyncStatus>("idle");
    const [error, setError] = useState<string | null>(null);
    const [reviewOnly, setReviewOnly] = useState(false);

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
            designStudyEvents: designStudyEvents,
            blueprintEvents: blueprintEvents,
            blueprintCodebaseLinks: blueprintCodebaseLinks,
            systemScreenshotMarkers: systemScreenshotMarkers,
            codebaseSubtracks: codebaseSubtracks,
            participants: participants,
            defaultStages: defaultStages,
            timelineStartEnd: timelineStartEnd
        });
    }, [flow.nodes, flow.edges, flow.title, stages, subStages, defaultStages, timelineStartEnd, designStudyEvents, blueprintEvents, blueprintCodebaseLinks, systemScreenshotMarkers, codebaseSubtracks, participants]);

    // Debounced autosave whenever flow changes
    const debouncedSave = useMemo(
        () =>
            debounce(async (
                id: string, 
                hash: string, 
                nodes: any[], 
                edges: any[], 
                stages: Stage[], 
                designStudyEvents: DesignStudyEvent[],
                blueprintEvents: BlueprintEvent[],
                blueprintCodebaseLinks: BlueprintCodebaseLink[],
                systemScreenshotMarkers: SystemScreenshotMarker[],
                subStages: SubStage[],
                codebaseSubtracks: CodebaseSubtrack[],
                participants: Array<{ id: string; name: string; role: string }>,
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
                        designStudyEvents,
                        blueprintEvents,
                        blueprintCodebaseLinks,
                        systemScreenshotMarkers,
                        subStages,
                        codebaseSubtracks,
                        participants,
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
            setReviewOnly(false);

            try {
                const doc = await loadDocument(projectId);
                setReviewOnly(Boolean(doc.review_only));

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
                const designStudyEvents = timeline?.designStudyEvents ?? [];
                const blueprintEvents = timeline?.blueprintEvents ?? [];
                const blueprintCodebaseLinks = timeline?.blueprintCodebaseLinks ?? [];
                const systemScreenshotMarkers = timeline?.systemScreenshotMarkers ?? [];
                const subStages = timeline?.subStages ?? [];
                const codebaseSubtracks = timeline?.codebaseSubtracks ?? [];
                const participants = timeline?.participants ?? [];
                const defaultStages = timeline?.defaultStages ?? [];
                const timelineStartEnd = timeline?.timelineStartEnd ?? {start: "June 15, 2023 03:24:00", end: "December 04, 2023 00:24:00"};

                dispatch(setStages(stages));
                dispatch(setDesignStudyEvents(designStudyEvents));
                dispatch(setBlueprintEvents(blueprintEvents));
                dispatch(setBlueprintCodebaseLinks(blueprintCodebaseLinks));
                dispatch(setSystemScreenshotMarkers(systemScreenshotMarkers));
                dispatch(setSubStages(subStages));
                dispatch(setCodebaseSubtracks(codebaseSubtracks));
                dispatch(setParticipants(participants));
                dispatch(setDefaultStages(defaultStages));
                dispatch(setTimelineStartEnd(timelineStartEnd));

                lastSavedHashRef.current = JSON.stringify({ 
                    nodes, 
                    edges, 
                    title, 
                    stages, 
                    designStudyEvents,
                    blueprintEvents,
                    blueprintCodebaseLinks,
                    systemScreenshotMarkers,
                    subStages,
                    codebaseSubtracks,
                    participants,
                    defaultStages,
                    timelineStartEnd });
                hasLoadedRef.current = true;
                setStatus("ready");
            } catch (e: any) {
                if (ac.signal.aborted) return;
                setStatus("error");
                setError(e?.message ?? "Failed to load project");
                setReviewOnly(false);
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
        if (reviewOnly) return;

        if (currentHash === lastSavedHashRef.current) return;

        debouncedSave(projectId, currentHash, flow.nodes, flow.edges, stages, designStudyEvents, blueprintEvents, blueprintCodebaseLinks, systemScreenshotMarkers, subStages, codebaseSubtracks, participants, defaultStages, timelineStartEnd, flow.title);
    }, [projectId, currentHash, flow.nodes, flow.edges, flow.title, status, reviewOnly, debouncedSave, stages, designStudyEvents, blueprintEvents, blueprintCodebaseLinks, systemScreenshotMarkers, subStages, codebaseSubtracks, defaultStages, timelineStartEnd, participants]);

    return { status, error, reviewOnly };
}
