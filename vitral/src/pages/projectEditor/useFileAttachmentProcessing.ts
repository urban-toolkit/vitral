import { useCallback, useEffect, useRef, useState } from "react";

import { parseFile } from "@/func/FileParser";
import { llmCardsToNodes, requestArtifactLLM, requestCardsLLM } from "@/func/LLMRequest";
import type { llmArtifactData } from "@/func/LLMRequest";
import { createFile } from "@/api/stateApi";
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
    allFiles: fileRecord[];
    setLoading: (value: boolean) => void;
};

const KNOWN_CARD_LABELS = new Set(["person", "activity", "requirement", "concept", "insight", "object", "task"]);

function normalizeArtifactEntity(entity: string | undefined): string {
    const normalized = String(entity ?? "").trim().toLowerCase();
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
    allFiles,
    setLoading,
}: Args) {
    const nodesRef = useRef(nodes);
    const allFilesRef = useRef(allFiles);

    const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
    const [generatedAtInput, setGeneratedAtInput] = useState<string>(() => toLocalDateTimeInputValue(new Date()));

    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    useEffect(() => {
        allFilesRef.current = allFiles;
    }, [allFiles]);

    const processFile = useCallback(async (
        file: File,
        generatedAt: string,
        rootActivityNodeId: string,
        dropPosition?: { x: number; y: number },
    ) => {
        setLoading(true);

        try {
            const data: filePendingUpload = await parseFile(file);
            const parsedGeneratedAt = generatedAt ? new Date(generatedAt) : new Date();
            const chosenCreatedAt = Number.isNaN(parsedGeneratedAt.getTime())
                ? new Date().toISOString()
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
                response = await requestCardsLLM(data, allFilesRef.current);
            } catch (error) {
                console.error("LLM processing failed for attached file.", error);
            }

            if (response?.cards) {
                const { nodes: generatedNodes, idMap } = llmCardsToNodes(response.cards, dropPosition, {
                    createdAt: chosenCreatedAt,
                    origin: fileId,
                });

                for (const card of response.cards) {
                    const targetNodeId = idMap[String(card.id)];
                    if (!targetNodeId || targetNodeId === rootActivityNodeId) continue;

                    const label = relationLabelFor("activity", card.entity);
                    if (!label) continue;

                    generatedEdges.push({
                        id: crypto.randomUUID(),
                        target: rootActivityNodeId,
                        source: targetNodeId,
                        type: "relation",
                        label,
                        data: { label, from: "activity", to: card.entity },
                    });
                }

                dispatch(addNodes(generatedNodes));
                dispatch(connectEdges(generatedEdges));

                const availableAssetIds = new Set(allFilesRef.current.map((record) => record.id));
                availableAssetIds.add(fileId);

                for (const card of response.cards) {
                    const nodeId = idMap[String(card.id)];
                    if (!nodeId || !Array.isArray(card.assets)) continue;

                    const uniqueAssets = Array.from(new Set(card.assets));
                    for (const cardFileId of uniqueAssets) {
                        if (!availableAssetIds.has(cardFileId)) continue;
                        dispatch(attachFileIdToNode({ nodeId, fileId: cardFileId }));
                    }
                }
            }
        } finally {
            setLoading(false);
        }
    }, [dispatch, projectId, setLoading]);

    const onAttachFile = useCallback(async (nodeId: string, file: File) => {
        const targetNode = nodesRef.current.find((node) => node.id === nodeId);
        const isActivityNode = String(targetNode?.data?.label ?? "").toLowerCase() === "activity";

        if (isActivityNode && targetNode) {
            setGeneratedAtInput(toLocalDateTimeInputValue(new Date()));
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
    }, [dispatch, projectId]);

    const onAttachFileToCanvas = useCallback(async (file: File, dropPosition: { x: number; y: number }) => {
        setLoading(true);

        try {
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

            let artifact: llmArtifactData | null = null;
            try {
                artifact = await requestArtifactLLM(parsedFile, allFilesRef.current);
                console.log("artifact", artifact);
            } catch (error) {
                console.error("LLM processing failed for canvas-dropped file.", error);
            }

            const label = normalizeArtifactEntity(artifact?.entity);
            const nodeId = crypto.randomUUID();
            const role = artifact?.role?.trim();
            const artifactDescription = artifact?.description?.trim();
            const description = [role ? `Role: ${role}` : "", artifactDescription || ""]
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
                    createdAt,
                    origin: fileId,
                    attachmentIds: [fileId],
                },
            }));

            dispatch(attachFileIdToNode({ nodeId, fileId }));
        } finally {
            setLoading(false);
        }
    }, [dispatch, projectId, setLoading]);

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
