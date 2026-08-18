import { useCallback, useEffect, useRef, useState } from "react";

import { parseFile } from "@/func/FileParser";
import { llmCardsToNodes, requestCardsLLM } from "@/func/LLMRequest";
import type { LlmProjectSettingsContext } from "@/func/LLMRequest";
import { compareCardsSimilarity, createFile } from "@/api/stateApi";
import { addNode, attachFileIdToNode, addNodes, connectEdges } from "@/store/flowSlice";
import { upsertFile } from "@/store/filesSlice";
import { relationLabelFor } from "@/utils/relationships";

import type { AppDispatch } from "@/store";
import type { edgeType, filePendingUpload, llmCardData, llmConnectionData, nodeType } from "@/config/types";
import type { PendingDrop } from "@/pages/projectEditor/types";
import { toLocalDateTimeInputValue } from "@/pages/projectEditor/dateUtils";

type Args = {
    projectId: string;
    dispatch: AppDispatch;
    nodes: nodeType[];
    edges: edgeType[];
    projectSettings: LlmProjectSettingsContext;
    actionTimestamp?: string | null;
    setLoading: (value: boolean) => void;
    /** Surfaced to the user in place of the old blocking `alert`. */
    onExtractionError?: (message: string) => void;
};

const KNOWN_CARD_LABELS = new Set(["person", "activity", "requirement", "concept", "insight", "object"]);
const ITERATION_OF_SIMILARITY_THRESHOLD = 0.85;
const REFERENCED_BY_SIMILARITY_THRESHOLD = 0.7;
const REFERENCED_BY_LABEL = "referenced by";
const ITERATION_OF_LABEL = "iteration of";
const DEBUG_SIMILARITY_SCORES = String(import.meta.env.VITE_DEBUG_SIMILARITY_SCORES ?? "").toLowerCase() === "true";
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogg", "ogv", "avi"]);

function normalizeArtifactEntity(entity: string | undefined): string {
    const normalized = String(entity ?? "").trim().toLowerCase();
    if (normalized === "task") return "requirement";
    if (KNOWN_CARD_LABELS.has(normalized)) return normalized;
    return "object";
}

function typeFromLabel(label: string): "technical" | "social" {
    return label === "requirement" || label === "insight" ? "technical" : "social";
}

function titleFromFilename(filename: string): string {
    const withoutExt = filename.replace(/\.[^/.]+$/, "").trim();
    return withoutExt || "Untitled";
}

function extensionFromName(filename: string): string {
    if (!filename.includes(".")) return "";
    return filename.split(".").pop()?.toLowerCase() ?? "";
}

function isVideoMimeType(mimeType: string | undefined): boolean {
    return typeof mimeType === "string" && mimeType.toLowerCase().startsWith("video/");
}

function isVideoFile(file: File): boolean {
    return isVideoMimeType(file.type) || VIDEO_EXTENSIONS.has(extensionFromName(file.name));
}

function isVideoPendingUpload(file: filePendingUpload): boolean {
    return isVideoMimeType(file.mimeType) || VIDEO_EXTENSIONS.has(String(file.ext ?? "").toLowerCase());
}

export function useFileAttachmentProcessing({
    projectId,
    dispatch,
    nodes,
    edges,
    projectSettings,
    actionTimestamp = null,
    setLoading,
    onExtractionError,
}: Args) {
    const nodesRef = useRef(nodes);
    const edgesRef = useRef(edges);
    // Every in-flight drop, so switching projects mid-drop cannot let an upload or extraction
    // dispatch its results into a different document's store. Concurrent drops are kept
    // independent: starting one must never cancel another that is still running.
    const inFlightRef = useRef<Set<AbortController>>(new Set());

    const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
    const [generatedAtInput, setGeneratedAtInput] = useState<string>(() => toLocalDateTimeInputValue(new Date()));

    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    useEffect(() => {
        edgesRef.current = edges;
    }, [edges]);

    useEffect(() => {
        const controllers = inFlightRef.current;
        return () => {
            for (const controller of controllers) controller.abort();
            controllers.clear();
        };
    }, [projectId]);

    const resolveActionTimestamp = useCallback(() => {
        if (actionTimestamp) {
            const parsed = new Date(actionTimestamp);
            if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
        }
        return new Date().toISOString();
    }, [actionTimestamp]);

    const processFile = useCallback(async (
        file: File,
        generatedAt: string,
        rootActivityNodeId: string,
        dropPosition?: { x: number; y: number },
    ) => {
        setLoading(true);
        const controller = new AbortController();
        inFlightRef.current.add(controller);
        const { signal } = controller;

        try {
            const data: filePendingUpload = await parseFile(file);
            const fallbackCreatedAt = resolveActionTimestamp();
            const parsedGeneratedAt = generatedAt ? new Date(generatedAt) : new Date(fallbackCreatedAt);
            const chosenCreatedAt = Number.isNaN(parsedGeneratedAt.getTime())
                ? fallbackCreatedAt
                : parsedGeneratedAt.toISOString();

            // The extraction call needs only the parsed file, never the upload result, so the two
            // run concurrently. For pdf/docx this also overlaps the docling conversion with the
            // upload, since that round trip happens inside requestCardsLLM.
            const isVideo = isVideoPendingUpload(data);
            const uploadPromise = createFile(projectId, data, chosenCreatedAt, signal);
            const llmPromise = isVideo ? null : requestCardsLLM(data, projectSettings, signal);
            // Attached up front so a failure on one leg is never an unhandled rejection while the
            // other is still in flight.
            uploadPromise.catch(() => { });
            llmPromise?.catch(() => { });

            const uploaded = await uploadPromise;
            const {
                fileId,
                createdAt: persistedCreatedAt,
                sha256,
                bucket,
                key,
            } = uploaded;
            const parsedPersistedCreatedAt = new Date(persistedCreatedAt);
            const resolvedCreatedAt = Number.isNaN(parsedPersistedCreatedAt.getTime())
                ? chosenCreatedAt
                : parsedPersistedCreatedAt.toISOString();
            const { name, mimeType, sizeBytes, ext } = data;

            dispatch(upsertFile({
                id: fileId,
                docId: projectId,
                name,
                mimeType,
                sizeBytes,
                ext,
                createdAt: resolvedCreatedAt,
                sha256,
                storage: { bucket, key },
            }));

            // Attach as soon as upload metadata is available, independent of LLM success.
            dispatch(attachFileIdToNode({
                nodeId: rootActivityNodeId,
                fileId,
                editAt: chosenCreatedAt,
            }));

            if (!llmPromise) {
                return;
            }

            let response: { cards: llmCardData[]; connections: llmConnectionData[] } | null = null;
            try {
                response = await llmPromise;
            } catch (error) {
                if (signal.aborted) return;
                console.error("LLM processing failed for attached file.", error);
                onExtractionError?.(error instanceof Error ? error.message : "Card extraction failed.");
            }

            if (response?.cards && !signal.aborted) {
                const { nodes: generatedNodes, idMap } = llmCardsToNodes(response.cards, dropPosition, {
                    createdAt: chosenCreatedAt,
                    origin: fileId,
                });
                const generatedNodeById = new Map(generatedNodes.map((node) => [node.id, node]));

                // Rebuilt per pass rather than snapshotted once: the similarity edges are queued
                // after an await, by which point the canvas has already gained the new cards.
                const buildEdgeQueuer = (target: edgeType[]) => {
                    const edgeKeyOf = (edge: edgeType) => {
                        const edgeLabel = typeof edge.label === "string"
                            ? edge.label
                            : (typeof edge.data?.label === "string" ? edge.data.label : "");
                        return `${edge.source}|${edge.target}|${edgeLabel}`;
                    };
                    const knownEdgeKeys = new Set(edgesRef.current.map(edgeKeyOf));

                    return (edge: edgeType) => {
                        const edgeKey = edgeKeyOf(edge);
                        if (knownEdgeKeys.has(edgeKey)) return;
                        knownEdgeKeys.add(edgeKey);
                        target.push({
                            ...edge,
                            data: {
                                ...(edge.data && typeof edge.data === "object" ? edge.data : {}),
                                createdAt: chosenCreatedAt,
                            },
                        });
                    };
                };

                const nodesToAdd: nodeType[] = [];
                const activityEdges: edgeType[] = [];
                const queueActivityEdge = buildEdgeQueuer(activityEdges);

                for (const card of response.cards) {
                    const targetNodeId = idMap[String(card.id)];
                    if (!targetNodeId || targetNodeId === rootActivityNodeId) continue;

                    const generatedNode = generatedNodeById.get(targetNodeId);
                    if (generatedNode) nodesToAdd.push(generatedNode);

                    const label = relationLabelFor("activity", normalizeArtifactEntity(card.entity));
                    if (label) {
                        queueActivityEdge({
                            id: crypto.randomUUID(),
                            source: rootActivityNodeId,
                            target: targetNodeId,
                            type: "relation",
                            label,
                            data: { label, from: "activity", to: normalizeArtifactEntity(card.entity) },
                        });
                    }
                }

                // Render as soon as the model answers. The similarity pass only ever adds
                // `iteration of` / `referenced by` edges between existing cards, so making the
                // cards wait for it bought nothing.
                if (nodesToAdd.length > 0) {
                    dispatch(addNodes(nodesToAdd));
                }
                if (activityEdges.length > 0) {
                    dispatch(connectEdges(activityEdges));
                }

                const existingCardsForSimilarity = nodesRef.current
                    .filter((node) => node.type === "card" && node.id !== rootActivityNodeId)
                    .map((node) => {
                        const data = node.data as Record<string, unknown>;
                        return {
                            id: node.id,
                            label: normalizeArtifactEntity(String(data.label ?? "")),
                            title: typeof data.title === "string" ? data.title : "",
                            description: typeof data.description === "string" ? data.description : "",
                        };
                    });
                const newCardsForSimilarity = nodesToAdd.map((node) => {
                    const data = node.data as Record<string, unknown>;
                    return {
                        id: node.id,
                        label: normalizeArtifactEntity(String(data.label ?? "")),
                        title: typeof data.title === "string" ? data.title : "",
                        description: typeof data.description === "string" ? data.description : "",
                    };
                });

                if (existingCardsForSimilarity.length > 0 && newCardsForSimilarity.length > 0) {
                    void (async () => {
                        try {
                            const similarity = await compareCardsSimilarity(projectId, {
                                newCards: newCardsForSimilarity,
                                existingCards: existingCardsForSimilarity,
                            }, signal);
                            if (signal.aborted) return;

                            const relationEdges: edgeType[] = [];
                            const queueRelationEdge = buildEdgeQueuer(relationEdges);

                            for (const match of similarity.matches) {
                                const targetNodeId = match.newCardId;
                                const matchedCardId = match.existingCardId;
                                const similarityScore = match.similarity;
                                if (DEBUG_SIMILARITY_SCORES) {
                                    console.log("[similarity]", {
                                        newCardId: targetNodeId,
                                        matchedCardId,
                                        similarityScore,
                                        iterationThreshold: ITERATION_OF_SIMILARITY_THRESHOLD,
                                        referencedByThreshold: REFERENCED_BY_SIMILARITY_THRESHOLD,
                                    });
                                }

                                if (!matchedCardId || matchedCardId === targetNodeId) continue;
                                if (similarityScore < REFERENCED_BY_SIMILARITY_THRESHOLD) continue;

                                const generatedNode = generatedNodeById.get(targetNodeId);
                                const normalizedEntity = normalizeArtifactEntity(
                                    String((generatedNode?.data as Record<string, unknown> | undefined)?.label ?? ""),
                                );
                                const existingNode = nodesRef.current.find((node) => node.id === matchedCardId);
                                const existingLabel = normalizeArtifactEntity(
                                    String((existingNode?.data as Record<string, unknown> | undefined)?.label ?? normalizedEntity),
                                );
                                const isIteration = similarityScore > ITERATION_OF_SIMILARITY_THRESHOLD;
                                const label = isIteration ? ITERATION_OF_LABEL : REFERENCED_BY_LABEL;

                                queueRelationEdge({
                                    id: crypto.randomUUID(),
                                    source: targetNodeId,
                                    target: matchedCardId,
                                    type: "relation",
                                    label,
                                    data: {
                                        label,
                                        from: normalizedEntity,
                                        to: existingLabel,
                                        kind: isIteration ? "iteration_of" : "referenced_by",
                                    },
                                });
                            }

                            if (relationEdges.length > 0 && !signal.aborted) {
                                dispatch(connectEdges(relationEdges));
                            }
                        } catch (error) {
                            if (signal.aborted) return;
                            console.error("Failed to compare generated cards with existing cards.", error);
                        }
                    })();
                }
            }
        } catch (error) {
            if (signal.aborted) return;
            console.error("Failed to process the attached file.", error);
            onExtractionError?.(error instanceof Error ? error.message : "Failed to process the attached file.");
        } finally {
            inFlightRef.current.delete(controller);
            setLoading(false);
        }
    }, [dispatch, onExtractionError, projectId, projectSettings, resolveActionTimestamp, setLoading]);

    const onAttachFile = useCallback(async (nodeId: string, file: File) => {
        const targetNode = nodesRef.current.find((node) => node.id === nodeId);
        const isActivityNode = String(targetNode?.data?.label ?? "").toLowerCase() === "activity";
        const shouldUseLlmFlow = isActivityNode && Boolean(targetNode) && !isVideoFile(file);

        if (shouldUseLlmFlow && targetNode) {
            setGeneratedAtInput(toLocalDateTimeInputValue(new Date(resolveActionTimestamp())));
            setPendingDrop({
                file,
                dropPosition: { x: targetNode.position.x, y: targetNode.position.y },
                rootActivityNodeId: nodeId,
            });
            return;
        }

        const parsedFile = await parseFile(file);
        const chosenCreatedAt = resolveActionTimestamp();
        const uploaded = await createFile(projectId, parsedFile, chosenCreatedAt);
        const {
            fileId,
            createdAt: persistedCreatedAt,
            sha256,
            bucket,
            key,
        } = uploaded;
        const parsedPersistedCreatedAt = new Date(persistedCreatedAt);
        const resolvedCreatedAt = Number.isNaN(parsedPersistedCreatedAt.getTime())
            ? chosenCreatedAt
            : parsedPersistedCreatedAt.toISOString();
        const { name, mimeType, sizeBytes, ext } = parsedFile;

        dispatch(upsertFile({
            id: fileId,
            docId: projectId,
            name,
            mimeType,
            sizeBytes,
            ext,
            createdAt: resolvedCreatedAt,
            sha256,
            storage: { bucket, key },
        }));
        dispatch(attachFileIdToNode({
            nodeId,
            fileId,
            editAt: chosenCreatedAt,
        }));
    }, [dispatch, projectId, resolveActionTimestamp]);

    /**
     * Canvas file drop. Always produces an `object` card named after the file, with the file
     * attached — no LLM round-trip, so the card appears as soon as the upload returns. When
     * `targetActivityNodeId` is set (the file was dropped inside an activity's drop ring) the
     * card is connected to that activity.
     *
     * Returns the created card's id so the caller can bring it into view — the canvas layout, not
     * the drop point, decides where it actually lands.
     */
    const onAttachFileToCanvas = useCallback(async (
        file: File,
        dropPosition: { x: number; y: number },
        targetActivityNodeId?: string | null,
    ): Promise<string | null> => {
        setLoading(true);

        try {
            // No LLM consumes the preview text on this path, so skip reading the file contents.
            const parsedFile = await parseFile(file, { includePreviewText: false });
            const { name, mimeType, sizeBytes, ext } = parsedFile;
            const chosenCreatedAt = resolveActionTimestamp();
            const uploaded = await createFile(projectId, parsedFile, chosenCreatedAt);
            const {
                fileId,
                createdAt: persistedCreatedAt,
                sha256,
                bucket,
                key,
            } = uploaded;
            const parsedPersistedCreatedAt = new Date(persistedCreatedAt);
            const resolvedCreatedAt = Number.isNaN(parsedPersistedCreatedAt.getTime())
                ? chosenCreatedAt
                : parsedPersistedCreatedAt.toISOString();

            dispatch(upsertFile({
                id: fileId,
                docId: projectId,
                name,
                mimeType,
                sizeBytes,
                ext,
                createdAt: resolvedCreatedAt,
                sha256,
                storage: { bucket, key },
            }));

            const activityNodeId = typeof targetActivityNodeId === "string" && targetActivityNodeId.trim() !== ""
                ? targetActivityNodeId
                : null;
            const activityNode = activityNodeId
                ? nodesRef.current.find((node) => node.id === activityNodeId)
                : undefined;

            const nodeId = crypto.randomUUID();
            dispatch(addNode({
                id: nodeId,
                // Recorded as the drop point; the orbit layout decides where the card renders.
                position: dropPosition,
                type: "card",
                data: {
                    label: "object",
                    type: typeFromLabel("object"),
                    title: titleFromFilename(parsedFile.name),
                    description: "",
                    createdAt: chosenCreatedAt,
                    origin: fileId,
                    autoGenerated: true,
                    relevant: true,
                    attachmentIds: [fileId],
                },
            }));

            dispatch(attachFileIdToNode({
                nodeId,
                fileId,
                editAt: chosenCreatedAt,
            }));

            if (activityNode) {
                const relationLabel = relationLabelFor("activity", "object");
                if (relationLabel) {
                    dispatch(connectEdges([{
                        id: crypto.randomUUID(),
                        source: activityNode.id,
                        target: nodeId,
                        type: "relation",
                        label: relationLabel,
                        data: {
                            label: relationLabel,
                            from: "activity",
                            to: "object",
                            createdAt: chosenCreatedAt,
                        },
                    }]));
                }
            }

            return nodeId;
        } finally {
            setLoading(false);
        }
    }, [dispatch, projectId, resolveActionTimestamp, setLoading]);

    const processPendingDrop = useCallback(async () => {
        if (!pendingDrop?.rootActivityNodeId) return;

        const payload = pendingDrop;
        setPendingDrop(null);

        await processFile(
            payload.file,
            generatedAtInput,
            payload.rootActivityNodeId,
            payload.dropPosition,
        );
    }, [pendingDrop, generatedAtInput, processFile]);

    const cancelPendingDrop = useCallback(() => {
        setPendingDrop(null);
    }, []);

    return {
        onAttachFile,
        onAttachFileToCanvas,
        pendingDrop,
        generatedAtInput,
        setGeneratedAtInput,
        processPendingDrop,
        cancelPendingDrop,
    };
}
