export function safeFilename(name: string) {
    return name.replace(/[/\\"]/g, "_");
}