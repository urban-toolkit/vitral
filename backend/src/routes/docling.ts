import { FastifyPluginAsync } from "fastify";
import FormData from "form-data";
import fetch from "node-fetch";
import { Buffer } from "node:buffer";

const DOCLING_URL = process.env.DOCLING_URL;

/**
 * Upper bound on one conversion. `node-fetch` has no default timeout, so without this a docling
 * worker that wedges on a document holds the browser request open forever -- which on the file-drop
 * path is an activity card stuck loading with nothing to retry.
 */
const DOCLING_TIMEOUT_MS = (() => {
    const raw = process.env.DOCLING_TIMEOUT_MS;
    const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 180_000;
})();

export const doclingRoutes: FastifyPluginAsync = async (app: any) => {

    app.post("/convert/file", async (request: any, reply: any) => {
        try {
            const parts = request.parts();

            let fileBuffer: Buffer | null = null;
            let filename = "document";
            let fromFormats: string[] = [];

            for await (const part of parts) {
                if (part.type === "file") {
                    filename = part.filename;
                    fileBuffer = await part.toBuffer();
                } else {
                    if (part.fieldname === "from_formats") {
                        fromFormats = JSON.parse(part.value);
                    }
                }
            }

            if (!fileBuffer) {
                return reply.status(400).send({ error: "No file provided" });
            }

            const form = new FormData();
            form.append("files", fileBuffer, filename);

            form.append(
                "options",
                JSON.stringify({
                    from_formats: fromFormats,
                    to_formats: ["markdown"],
                    image_export_mode: "embedded",
                })
            );

            const doclingResponse = await fetch(
                `${DOCLING_URL}/v1/convert/file`,
                {
                    method: "POST",
                    body: form,
                    headers: form.getHeaders(),
                    signal: AbortSignal.timeout(DOCLING_TIMEOUT_MS),
                }
            );

            if (!doclingResponse.ok) {
                const errorText = await doclingResponse.text();
                throw new Error(errorText);
            }

            const result: any = await doclingResponse.json();

            const doc = result.document;
            const markdown = doc?.md_content ?? result.markdown ?? "";
            let cleanedMarkdown = markdown;

            // The replace is what keeps base64 out of the markdown (and therefore out of the LLM
            // prompt), so it stays. The extracted blobs themselves are not returned: the only
            // caller discards them, and on a figure-heavy PDF they are tens of megabytes of
            // response body on the synchronous critical path of a file drop.
            if (typeof markdown === "string") {
                const dataUrlRegex = /!\[([^\]]*)\]\(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+\)/g;
                cleanedMarkdown = markdown.replace(dataUrlRegex, (_match, altText: string) => {
                    const legend = (altText ?? "").trim() || "Image";
                    return `![${legend}]`;
                });
            }

            return reply.send({
                content: cleanedMarkdown,
            });

            // Without cleaning images from markdown
            // const doc = result.document;
            // const markdown = doc?.md_content ?? result.markdown ?? "";

            // let imageResult: { name: string; content: string }[] = [];
            // if (Array.isArray(result.images)) {
            //     imageResult = result.images.map((img: any) => ({
            //         name: img.name ?? "image.png",
            //         content: img.content ?? "",
            //     }));
            // } else if (typeof markdown === "string") {
            //     const dataUrlRegex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/g;
            //     let match;
            //     let index = 0;
            //     while ((match = dataUrlRegex.exec(markdown)) !== null) {
            //         const [, , dataUrl] = match;
            //         const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
            //         imageResult.push({
            //             name: `image_${index}.png`,
            //             content: base64,
            //         });
            //         index += 1;
            //     }
            // }

            // return reply.send({
            //     content: markdown,
            //     images: imageResult,
            // });

        } catch (err) {
            console.error("Docling API error:", err);
            // node-fetch surfaces an abort as `AbortError`, not the signal's `TimeoutError`, and
            // the timeout is the only thing that aborts this call.
            if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
                return reply.status(504).send({ error: "Docling conversion timed out" });
            }
            return reply.status(500).send({ error: "Docling request failed" });
        }
    });
};
