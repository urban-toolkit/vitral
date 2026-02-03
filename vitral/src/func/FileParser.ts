import type { filePendingUpload, fileExtension } from '@/config/types';

const TEXT_EXTENSIONS = new Set([
    "txt", "json", "ipynb", "csv", "py", "js", "ts", "html", "css", "md",
]);

function getExt(name: string): fileExtension {
    return (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "") as fileExtension;
}

function isTextLike(file: File, ext: string) {
    return TEXT_EXTENSIONS.has(ext) || (file.type?.startsWith("text/") ?? false);
}

export async function parseFile(file: File): Promise<filePendingUpload> {
    const ext = getExt(file.name);
    const mimeType = file.type || (TEXT_EXTENSIONS.has(ext) ? "text/plain" : "application/octet-stream");


    const data: filePendingUpload = {
        id: crypto.randomUUID(),
        name: file.name,
        ext,
        sizeBytes: file.size,
        mimeType,
        file,
    };

    if (isTextLike(file, ext)) {
        data.previewText = await file.text();
    }

    return data;
}