import type { fileData, fileType } from '@/config/types';

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readFile(file:File): Promise<{type: fileType, content: string}> {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const mime = file.type;

    // TODO: support .pdf, .docx

    if (mime.startsWith("image/") && ext != undefined) {
        const dataUrl = await readAsDataURL(file);
        return {
            type: ext as 'png' | 'jpg' | 'jpeg',
            content: dataUrl,
        };
    }

    if (ext === "json" || ext === "ipynb") {
        const text = await file.text();
        return {
            type: ext,
            content: text
        };
    }

    if (ext === "csv") {
        return {
            type: ext,
            content: await file.text()
        };
    }

    if (
        ext === "txt" ||
        ext === "py" ||
        ext === "js" ||
        ext === "ts" ||
        ext === "html" ||
        ext === "css" ||
        ext === "md"
    ) {
        return {
            type: ext,
            content: await file.text()
        };
    }

    return {
        type: "txt",
        content: await file.text()
    };

}

export async function parseFile(file: File): Promise<fileData> {
    const fileContentAndType: {type: fileType, content: string} = await readFile(file);

    const data: fileData = {
        name: file.name,
        type: fileContentAndType.type,
        content: fileContentAndType.content,
        lastModified: new Date(file.lastModified)
    } 

    return data;
}