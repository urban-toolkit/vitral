import type { fileData } from '@/config/types';

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readFile(file:File): Promise<{mimeType: string, content: string}> {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const mime = file.type;

    // TODO: support .pdf, .docx

    if (mime.startsWith("image/") && ext != undefined) {
        const dataUrl = await readAsDataURL(file);
        return {
            mimeType: mime,
            content: dataUrl
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
            content: await file.text()
        };
    }

    return {
        mimeType: mime || "text/plain",
        content: await file.text()
    };
}

export async function parseFile(file: File): Promise<fileData> {
    const fileContentAndType: {mimeType: string, content: string} = await readFile(file);

    const ext = file.name.split(".").pop()?.toLowerCase() as string;

    const data: fileData = {
        id: crypto.randomUUID(),
        name: file.name,
        ext,
        sizeBytes: file.size,
        mimeType: fileContentAndType.mimeType,
        content: fileContentAndType.content,
        // sha256: TODO: dedupe
    } 

    return data;
}