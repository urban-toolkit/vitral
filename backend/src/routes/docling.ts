import { FastifyPluginAsync } from "fastify";
import FormData from "form-data";
import fetch from "node-fetch";
import { Buffer } from "node:buffer";

const DOCLING_URL = process.env.DOCLING_URL;

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

            let imageResult: { name: string; content: string }[] = [];
            if (Array.isArray(result.images)) {
                imageResult = result.images.map((img: any) => ({
                    name: img.name ?? "image.png",
                    content: img.content ?? "",
                }));
            } else if (typeof markdown === "string") {
                const dataUrlRegex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/g;
                let index = 0;
                cleanedMarkdown = markdown.replace(dataUrlRegex, (_match, altText: string, dataUrl: string) => {
                    const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
                    imageResult.push({
                        name: `image_${index}.png`,
                        content: base64,
                    });
                    index += 1;
                    const legend = (altText ?? "").trim() || "Image";
                    return `![${legend}]`;
                });
            }

            return reply.send({
                content: cleanedMarkdown,
                images: imageResult,
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
            return reply.status(500).send({ error: "Docling request failed" });
        }
    });
};
