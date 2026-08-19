export type CursorMode = "node" | "blueprint_component" | "text" | "tree" | "related" | "";

export type GitConnectionStatus = {
    connected: boolean;
    user?: { id: number; login: string };
};
