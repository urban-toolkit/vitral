import { FastifyPluginAsync } from "fastify";
import OpenAI from "openai";
import { loadPrompt } from "../prompts/loadPrompt.js";
import FormData from "form-data";
import fetch from "node-fetch";
import { Buffer } from "node:buffer";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});


export const llmRoutes: FastifyPluginAsync = async (app: any) => {
    app.post("/chat", async (request: any, reply: any) => {
        try {

            const body = request.body as { input: string, prompt?: string, model?: string };

            if (!body?.input) {
                return reply.status(400).send({ error: "Invalid input" });
            }

            const DEFAULT_CHAT_MODEL = (process.env.OPENAI_LLM_CHAT_MODEL ?? "gpt-5-nano").trim() || "gpt-5-nano";
            const allowedModels = (process.env.OPENAI_LLM_CHAT_ALLOWED_MODELS ?? "gpt-5-nano,gpt-4.1-mini,gpt-5-mini,gpt-5.2")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean);
            const allowedModelSet = new Set(allowedModels.length > 0 ? allowedModels : [DEFAULT_CHAT_MODEL]);

            const normalizeModel = (value: unknown): string | undefined => {
                if (typeof value !== "string") return undefined;
                const trimmed = value.trim();
                return trimmed !== "" ? trimmed : undefined;
            };

            const extractModelFromPayload = (payload: unknown): string | undefined => {
                if (!payload || typeof payload !== "object") return undefined;
                const source = payload as Record<string, unknown>;
                const fromRoot = normalizeModel(source.llmModel);
                if (fromRoot) return fromRoot;
                const projectSettings = source.projectSettings;
                if (!projectSettings || typeof projectSettings !== "object") return undefined;
                return normalizeModel((projectSettings as Record<string, unknown>).llmModel);
            };

            let parsedInputPayload: unknown = undefined;
            try {
                parsedInputPayload = JSON.parse(body.input);
            } catch {
                parsedInputPayload = undefined;
            }

            const requestedModel =
                normalizeModel(body.model) ??
                extractModelFromPayload(parsedInputPayload) ??
                DEFAULT_CHAT_MODEL;
            const resolvedModel = allowedModelSet.has(requestedModel)
                ? requestedModel
                : (allowedModels[0] ?? DEFAULT_CHAT_MODEL);

            const promptName = body?.prompt ?? "CardsFromText";
            let promptContent = await loadPrompt(promptName);

            const fileProcessingPrompts = new Set([
                "CardsFromText",
                "CardsFromImage",
                "CardsFromData",
                "CardsFromCode",
                "ArtifactFromText",
                "ArtifactFromImage",
                "ArtifactFromData",
                "ArtifactFromCode",
            ]);
            if (fileProcessingPrompts.has(promptName)) {
                promptContent += [
                    "",
                    "Language policy:",
                    "- Always produce the final output in English.",
                    "- If the input content is in another language, translate relevant content to English before answering.",
                    "- Keep required output schema/field names unchanged.",
                ].join("\n");
            }

            type AssetMetadata = {
                id: string;
                name: string;
                ext: string;
            };

            const formatAssetsBlock = (assets: AssetMetadata[] | undefined): string => {
                if (!Array.isArray(assets) || assets.length === 0) return "";
                return `\n\nAvailable assets metadata (you may reference these ids in card.assets):\n${JSON.stringify(assets)}`;
            };

            const formatStructuredContextBlock = (payload: unknown): string => {
                if (!payload || typeof payload !== "object") return "";

                const source = payload as Record<string, unknown>;
                const context: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(source)) {
                    if (key === "content" || key === "images" || key === "assets") continue;
                    context[key] = value;
                }

                if (Array.isArray(source.images)) {
                    context.imageCount = source.images.length;
                    context.imageIds = source.images
                        .map((image, index) => {
                            if (!image || typeof image !== "object") return `image_${index + 1}`;
                            const id = (image as { id?: unknown }).id;
                            return typeof id === "string" && id.trim() !== "" ? id : `image_${index + 1}`;
                        });
                }

                if (Object.keys(context).length === 0) return "";
                return `\n\nStructured input context:\n${JSON.stringify(context)}`;
            };

            let inputContent: any[] = [];

            const multimodalPrompts = new Set([
                "CardsFromImage",
                "CardsFromCode",
                "ArtifactFromImage",
                "ArtifactFromCode",
                "SystemScreenshotZones",
            ]);

            if (multimodalPrompts.has(body.prompt ?? "")) {
                let parsed: {
                    name?: string;
                    ext?: string;
                    content?: string;
                    images?: { id: string; dataUrl: string }[];
                    assets?: AssetMetadata[];
                    projectSettings?: Record<string, unknown>;
                } | undefined;
                if (parsedInputPayload && typeof parsedInputPayload === "object") {
                    parsed = parsedInputPayload as {
                        name?: string;
                        ext?: string;
                        content?: string;
                        images?: { id: string; dataUrl: string }[];
                        assets?: AssetMetadata[];
                        projectSettings?: Record<string, unknown>;
                    };
                } else {
                    return reply.status(400).send({ error: "Invalid multimodal payload" });
                }

                const textContent = parsed?.content ?? "";
                const images = Array.isArray(parsed?.images) ? parsed!.images : [];
                const assetsBlock = formatAssetsBlock(parsed?.assets);
                const contextBlock = formatStructuredContextBlock(parsed);

                inputContent.push({
                    type: "input_text",
                    text: promptContent + contextBlock + (textContent ? "\n\nPrimary content:\n" + textContent : "") + assetsBlock,
                });

                if (images.length === 0 && parsed?.content && typeof parsed.content === "string" && parsed.content.startsWith("data:")) {
                    inputContent.push({
                        type: "input_image",
                        image_url: parsed.content,
                        detail: "low"
                    });
                } else {
                    for (const img of images) {
                        if (!img?.dataUrl || typeof img.dataUrl !== "string") continue;
                        if (img?.id && typeof img.id === "string") {
                            inputContent.push({
                                type: "input_text",
                                text: `Image ${img.id}:`,
                            });
                        }
                        inputContent.push({
                            type: "input_image",
                            image_url: img.dataUrl,
                            detail: "low"
                        });
                    }
                }
            } else {
                let parsed:
                    | { content?: string; assets?: AssetMetadata[] }
                    | undefined;
                parsed = parsedInputPayload && typeof parsedInputPayload === "object"
                    ? parsedInputPayload as { content?: string; assets?: AssetMetadata[] }
                    : undefined;

                const parsedText = typeof parsed?.content === "string" ? parsed.content : body.input;
                const assetsBlock = formatAssetsBlock(parsed?.assets);
                const contextBlock = formatStructuredContextBlock(parsed);

                inputContent = [
                    {
                        type: "input_text",
                        text: promptContent + contextBlock + "\n\nPrimary content:\n" + parsedText + assetsBlock,
                    },
                ];
            }

            const response = await client.responses.create({
                model: resolvedModel,
                input: [
                    {
                        role: "user",
                        content: inputContent,
                    }
                ],
            });

            return { output: response.output_text };
        } catch (err) {
            console.error("OpenAI API error:", err);
            return reply.status(500).send({ error: "LLM request failed" });
        }
    });

};
