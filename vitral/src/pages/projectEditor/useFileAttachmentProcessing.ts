import { useCallback, useEffect, useRef, useState } from "react";

import { parseFile } from "@/func/FileParser";
import { llmCardsToNodes, requestArtifactLLM, requestCardsLLM } from "@/func/LLMRequest";
import type { llmArtifactData } from "@/func/LLMRequest";
import type { LlmProjectSettingsContext } from "@/func/LLMRequest";
import { compareCardsSimilarity, createFile } from "@/api/stateApi";
import { addNode, attachFileIdToNode, addNodes, connectEdges, updateNode } from "@/store/flowSlice";
import { upsertFile } from "@/store/filesSlice";
import { relationLabelFor } from "@/utils/relationships";

import type { AppDispatch } from "@/store";
import type { edgeType, filePendingUpload, fileRecord, llmCardData, llmConnectionData, nodeType } from "@/config/types";
import type { PendingDrop } from "@/pages/projectEditor/types";
import { toLocalDateTimeInputValue } from "@/pages/projectEditor/dateUtils";

type Args = {
    projectId: string;
    dispatch: AppDispatch;
    nodes: nodeType[];
    edges: edgeType[];
    allFiles: fileRecord[];
    projectSettings: LlmProjectSettingsContext;
    actionTimestamp?: string | null;
    setLoading: (value: boolean) => void;
};

const KNOWN_CARD_LABELS = new Set(["person", "activity", "requirement", "concept", "insight", "object"]);
const ITERATION_OF_SIMILARITY_THRESHOLD = 0.85;
const REFERENCED_BY_SIMILARITY_THRESHOLD = 0.7;
const REFERENCED_BY_LABEL = "referenced by";
const ITERATION_OF_LABEL = "iteration of";
const DEBUG_SIMILARITY_SCORES = String(import.meta.env.VITE_DEBUG_SIMILARITY_SCORES ?? "").toLowerCase() === "true";

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

export function useFileAttachmentProcessing({
    projectId,
    dispatch,
    nodes,
    edges,
    allFiles,
    projectSettings,
    actionTimestamp = null,
    setLoading,
}: Args) {
    const nodesRef = useRef(nodes);
    const edgesRef = useRef(edges);
    const allFilesRef = useRef(allFiles);

    const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
    const [generatedAtInput, setGeneratedAtInput] = useState<string>(() => toLocalDateTimeInputValue(new Date()));

    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    useEffect(() => {
        edgesRef.current = edges;
    }, [edges]);

    useEffect(() => {
        allFilesRef.current = allFiles;
    }, [allFiles]);

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

        try {
            const data: filePendingUpload = await parseFile(file);
            const fallbackCreatedAt = resolveActionTimestamp();
            const parsedGeneratedAt = generatedAt ? new Date(generatedAt) : new Date(fallbackCreatedAt);
            const chosenCreatedAt = Number.isNaN(parsedGeneratedAt.getTime())
                ? fallbackCreatedAt
                : parsedGeneratedAt.toISOString();

            const { fileId, sha256, bucket, key } = await createFile(projectId, data);
            const { name, mimeType, sizeBytes, ext } = data;
            const generatedEdges: edgeType[] = [];

            dispatch(upsertFile({
                id: fileId,
                docId: projectId,
                name,
                mimeType,
                sizeBytes,
                ext,
                createdAt: chosenCreatedAt,
                sha256,
                storage: { bucket, key },
            }));

            // Attach as soon as upload metadata is available, independent of LLM success.
            dispatch(attachFileIdToNode({ nodeId: rootActivityNodeId, fileId }));

            const rootNode = nodesRef.current.find((node) => node.id === rootActivityNodeId);
            if (rootNode) {
                const currentAttachmentIds = Array.isArray(rootNode.data.attachmentIds)
                    ? rootNode.data.attachmentIds
                    : [];

                dispatch(updateNode({
                    ...rootNode,
                    data: {
                        ...rootNode.data,
                        attachmentIds: Array.from(new Set([...currentAttachmentIds, fileId])),
                        createdAt: chosenCreatedAt,
                        origin: fileId,
                    },
                }));
            }

            let response: { cards: llmCardData[]; connections: llmConnectionData[] } | null = null;
            try {
                response = await requestCardsLLM(data, allFilesRef.current, projectSettings);
            } catch (error) {
                console.error("LLM processing failed for attached file.", error);
            }

            if (response?.cards) {
                const { nodes: generatedNodes, idMap } = llmCardsToNodes(response.cards, dropPosition, {
                    createdAt: chosenCreatedAt,
                    origin: fileId,
                });
                const generatedNodeById = new Map(generatedNodes.map((node) => [node.id, node]));
                const existingNodeById = new Map(nodesRef.current.map((node) => [node.id, node]));
                const existingEdgeKeySet = new Set(
                    edgesRef.current.map((edge) => {
                        const edgeLabel = typeof edge.label === "string"
                            ? edge.label
                            : (typeof edge.data?.label === "string" ? edge.data.label : "");
                        return `${edge.source}|${edge.target}|${edgeLabel}`;
                    })
                );
                const queuedEdgeKeySet = new Set<string>();
                const nodesToAdd: nodeType[] = [];
                const nodeIdToSimilarity = new Map<string, { existingCardId: string | null; similarity: number }>();

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
                const newCardsForSimilarity = generatedNodes
                    .filter((node) => node.type === "card")
                    .map((node) => {
                        const data = node.data as Record<string, unknown>;
                        return {
                            id: node.id,
                            label: normalizeArtifactEntity(String(data.label ?? "")),
                            title: typeof data.title === "string" ? data.title : "",
                            description: typeof data.description === "string" ? data.description : "",
                        };
                    });

                if (existingCardsForSimilarity.length > 0 && newCardsForSimilarity.length > 0) {
                    try {
                        const similarity = await compareCardsSimilarity(projectId, {
                            newCards: newCardsForSimilarity,
                            existingCards: existingCardsForSimilarity,
                        });
                        for (const match of similarity.matches) {
                            nodeIdToSimilarity.set(match.newCardId, {
                                existingCardId: match.existingCardId,
                                similarity: match.similarity,
                            });
                        }
                    } catch (error) {
                        console.error("Failed to compare generated cards with existing cards.", error);
                    }
                }

                const queueEdge = (edge: edgeType) => {
                    const edgeLabel = typeof edge.label === "string"
                        ? edge.label
                        : (typeof edge.data?.label === "string" ? edge.data.label : "");
                    const edgeKey = `${edge.source}|${edge.target}|${edgeLabel}`;
                    if (existingEdgeKeySet.has(edgeKey) || queuedEdgeKeySet.has(edgeKey)) return;
                    queuedEdgeKeySet.add(edgeKey);
                    generatedEdges.push({
                        ...edge,
                        data: {
                            ...(edge.data && typeof edge.data === "object" ? edge.data : {}),
                            createdAt: chosenCreatedAt,
                        },
                    });
                };

                for (const card of response.cards) {
                    const targetNodeId = idMap[String(card.id)];
                    if (!targetNodeId || targetNodeId === rootActivityNodeId) continue;

                    const normalizedEntity = normalizeArtifactEntity(card.entity);
                    const similarityMatch = nodeIdToSimilarity.get(targetNodeId);
                    const matchedCardId = similarityMatch?.existingCardId ?? null;
                    const similarityScore = similarityMatch?.similarity ?? 0;
                    if (DEBUG_SIMILARITY_SCORES) {
                        console.log("[similarity]", {
                            newCardId: targetNodeId,
                            matchedCardId,
                            similarityScore,
                            iterationThreshold: ITERATION_OF_SIMILARITY_THRESHOLD,
                            referencedByThreshold: REFERENCED_BY_SIMILARITY_THRESHOLD,
                        });
                    }
                    const generatedNode = generatedNodeById.get(targetNodeId);
                    if (generatedNode) nodesToAdd.push(generatedNode);

                    const label = relationLabelFor("activity", normalizedEntity);
                    if (label) {
                        queueEdge({
                            id: crypto.randomUUID(),
                            source: rootActivityNodeId,
                            target: targetNodeId,
                            type: "relation",
                            label,
                            data: { label, from: "activity", to: normalizedEntity },
                        });
                    }

                    if (
                        matchedCardId &&
                        matchedCardId !== targetNodeId &&
                        similarityScore > ITERATION_OF_SIMILARITY_THRESHOLD
                    ) {
                        const existingNode = existingNodeById.get(matchedCardId);
                        const existingLabel = normalizeArtifactEntity(String(existingNode?.data?.label ?? normalizedEntity));
                        queueEdge({
                            id: crypto.randomUUID(),
                            source: targetNodeId,
                            target: matchedCardId,
                            type: "relation",
                            label: ITERATION_OF_LABEL,
                            data: { label: ITERATION_OF_LABEL, from: normalizedEntity, to: existingLabel, kind: "iteration_of" },
                        });
                    } else if (
                        matchedCardId &&
                        matchedCardId !== targetNodeId &&
                        similarityScore >= REFERENCED_BY_SIMILARITY_THRESHOLD
                    ) {
                        const existingNode = existingNodeById.get(matchedCardId);
                        const existingLabel = normalizeArtifactEntity(String(existingNode?.data?.label ?? normalizedEntity));
                        queueEdge({
                            id: crypto.randomUUID(),
                            source: targetNodeId,
                            target: matchedCardId,
                            type: "relation",
                            label: REFERENCED_BY_LABEL,
                            data: { label: REFERENCED_BY_LABEL, from: normalizedEntity, to: existingLabel, kind: "referenced_by" },
                        });
                    }
                }

                if (nodesToAdd.length > 0) {
                    dispatch(addNodes(nodesToAdd));
                }
                if (generatedEdges.length > 0) {
                    dispatch(connectEdges(generatedEdges));
                }

            }
        } finally {
            setLoading(false);
        }
    }, [dispatch, projectId, projectSettings, resolveActionTimestamp, setLoading]);

    const onAttachFile = useCallback(async (nodeId: string, file: File) => {
        const targetNode = nodesRef.current.find((node) => node.id === nodeId);
        const isActivityNode = String(targetNode?.data?.label ?? "").toLowerCase() === "activity";

        if (isActivityNode && targetNode) {
            setGeneratedAtInput(toLocalDateTimeInputValue(new Date(resolveActionTimestamp())));
            setPendingDrop({
                file,
                dropPosition: { x: targetNode.position.x, y: targetNode.position.y },
                rootActivityNodeId: nodeId,
            });
            return;
        }

        const parsedFile = await parseFile(file);
        const { fileId, createdAt, sha256, bucket, key } = await createFile(projectId, parsedFile);
        const { name, mimeType, sizeBytes, ext } = parsedFile;

        dispatch(upsertFile({
            id: fileId,
            docId: projectId,
            name,
            mimeType,
            sizeBytes,
            ext,
            createdAt,
            sha256,
            storage: { bucket, key },
        }));
        dispatch(attachFileIdToNode({ nodeId, fileId }));
    }, [dispatch, projectId, resolveActionTimestamp]);

    const onAttachFileToCanvas = useCallback(async (file: File, dropPosition: { x: number; y: number }) => {
        setLoading(true);

        try {
            const parsedFile = await parseFile(file);
            const { fileId, sha256, bucket, key } = await createFile(projectId, parsedFile);
            const { name, mimeType, sizeBytes, ext } = parsedFile;
            const chosenCreatedAt = resolveActionTimestamp();

            dispatch(upsertFile({
                id: fileId,
                docId: projectId,
                name,
                mimeType,
                sizeBytes,
                ext,
                createdAt: chosenCreatedAt,
                sha256,
                storage: { bucket, key },
            }));

            let artifact: llmArtifactData | null = null;
            try {
                artifact = await requestArtifactLLM(parsedFile, allFilesRef.current, projectSettings);
                console.log("artifact", artifact);
            } catch (error) {
                console.error("LLM processing failed for canvas-dropped file.", error);
            }

            const label = normalizeArtifactEntity(artifact?.entity);
            const nodeId = crypto.randomUUID();
            const artifactDescription = artifact?.description?.trim();
            const description = [artifactDescription || ""]
                .filter(Boolean)
                .join("\n\n");

            dispatch(addNode({
                id: nodeId,
                position: dropPosition,
                type: "card",
                data: {
                    label,
                    type: typeFromLabel(label),
                    title: artifact?.title?.trim() || titleFromFilename(parsedFile.name),
                    description,
                    createdAt: chosenCreatedAt,
                    origin: fileId,
                    autoGenerated: true,
                    relevant: true,
                    attachmentIds: [fileId],
                },
            }));

            dispatch(attachFileIdToNode({ nodeId, fileId }));
        } finally {
            setLoading(false);
        }
    }, [dispatch, projectId, projectSettings, resolveActionTimestamp, setLoading]);

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
