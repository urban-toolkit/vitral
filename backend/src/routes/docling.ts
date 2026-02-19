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
            let enablePictureDescription = true;

            for await (const part of parts) {
                if (part.type === "file") {
                    filename = part.filename;
                    fileBuffer = await part.toBuffer();
                } else {
                    if (part.fieldname === "from_formats") {
                        fromFormats = JSON.parse(part.value);
                    }
                    if (part.fieldname === "enable_picture_description") {
                        enablePictureDescription = part.value === "true";
                    }
                }
            }

            if (!fileBuffer) {
                return reply.status(400).send({ error: "No file provided" });
            }

            const form = new FormData();
            form.append("file", fileBuffer, filename);

            form.append(
                "options",
                JSON.stringify({
                    from_formats: fromFormats,
                    to_formats: ["markdown"],
                    image_export_mode: "referenced", 
                    enable_picture_description: enablePictureDescription,
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

            /**
             * Expected Docling response structure (simplified):
             * {
             *   markdown: "...",
             *   images: [
             *     { name: "image_1.png", content: "<base64>" }
             *   ]
             * }
             */

            const markdown = result.markdown;
            const images = result.images || [];

            // TODO: automatically store images on the MinIO. (?)

            // Convert base64 images to binary buffers
            const imageResult = images.map((img: any) => ({
                name: img.name,
                content: img.content,
            }));

            return reply.send({
                markdown,
                images: imageResult,
            });
        } catch (err) {
            console.error("Docling API error:", err);
            return reply.status(500).send({ error: "Docling request failed" });
        }
    });
};
