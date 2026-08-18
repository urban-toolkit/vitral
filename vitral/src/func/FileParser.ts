import type { filePendingUpload, fileExtension } from '@/config/types';

// `docx` is deliberately absent: it is a zip container, so reading it as text yields mojibake
// that the docling conversion overwrites anyway.
const TEXT_EXTENSIONS = new Set([
    "txt", "json", "ipynb", "csv", "py", "js", "ts", "tsx", "jsx", "html", "css", "md"
]);

/** Extensions whose mime type cannot be guessed from TEXT_EXTENSIONS. */
const EXPLICIT_MIME_TYPES: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * Upper bound on how much of a text file is read into `previewText`. The only consumer is the
 * LLM payload, and anything past this is truncated by the model's context window regardless --
 * so reading a multi-megabyte log in full just costs memory and upload time.
 */
const PREVIEW_TEXT_MAX_BYTES = 512 * 1024;
const PREVIEW_TEXT_MAX_CHARS = 120_000;

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

export type ParseFileOptions = {
    /**
     * Read text-like files into `previewText`. Only the LLM paths need it, so callers that
     * just upload a file can pass `false` and skip reading the whole file into memory.
     */
    includePreviewText?: boolean;
};

export async function parseFile(
    file: File,
    options: ParseFileOptions = {},
): Promise<filePendingUpload> {
    const { includePreviewText = true } = options;
    const ext = getExt(file.name);
    const mimeType = file.type
        || EXPLICIT_MIME_TYPES[ext]
        || (TEXT_EXTENSIONS.has(ext) ? "text/plain" : "application/octet-stream");


    const data: filePendingUpload = {
        id: crypto.randomUUID(),
        name: file.name,
        ext,
        sizeBytes: file.size,
        mimeType,
        file,
    };

    if (includePreviewText && isTextLike(file, ext)) {
        const blob = file.size > PREVIEW_TEXT_MAX_BYTES ? file.slice(0, PREVIEW_TEXT_MAX_BYTES) : file;
        let text = await blob.text();
        if (file.size > PREVIEW_TEXT_MAX_BYTES) {
            text += `\n...[truncated ${file.size - PREVIEW_TEXT_MAX_BYTES} bytes]`;
        }
        data.previewText = text.length > PREVIEW_TEXT_MAX_CHARS
            ? `${text.slice(0, PREVIEW_TEXT_MAX_CHARS)}\n...[truncated ${text.length - PREVIEW_TEXT_MAX_CHARS} chars]`
            : text;
    }

    return data;
}
