import type { fileData } from '@/config/types';

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readFile(file:File): Promise<{mimeType: string, content: string, contentKind: "base64" | "text"}> {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const mime = file.type;

    // TODO: support .pdf, .docx

    if (mime.startsWith("image/") && ext != undefined) {
        const dataUrl = await readAsDataURL(file);
        return {
            mimeType: mime,
            content: dataUrl,
            contentKind: "base64"
        };
    }

    const textExtensions = [
        "txt",
        "json",
        "ipynb",
        "csv",
        "py",
        "js",
        "ts",
        "html",
        "css",
        "md",
    ];

    if (ext && textExtensions.includes(ext)) {
        return {
        mimeType: mime || "text/plain",
        content: await file.text(),
        contentKind: "text",
        };
    }

    return {
        mimeType: mime || "text/plain",
        content: await file.text(),
        contentKind: "text",
    };
}

export async function parseFile(file: File): Promise<fileData> {
    const fileContentAndType: {mimeType: string, content: string, contentKind: "base64" | "text"} = await readFile(file);

    const ext = file.name.split(".").pop()?.toLowerCase() as string;

    const data: fileData = {
        id: crypto.randomUUID(),
        name: file.name,
        ext,
        sizeBytes: file.size,
        mimeType: fileContentAndType.mimeType,
        content: fileContentAndType.content,
        contentKind: fileContentAndType.contentKind
        // sha256: TODO: dedupe
    } 

    return data;
}