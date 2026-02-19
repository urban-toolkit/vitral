import type { filePendingUpload, fileExtension } from '@/config/types';

const TEXT_EXTENSIONS = new Set([
    "txt", "json", "ipynb", "csv", "py", "js", "ts", "html", "css", "md", "docx"
]);

function getExt(name: string): fileExtension {
    return (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "") as fileExtension;
}

function isTextLike(file: File, ext: string) {
    return (TEXT_EXTENSIONS.has(ext) || (file.type?.startsWith("text/") ?? false)) && ext != "pdf";
}

export function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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