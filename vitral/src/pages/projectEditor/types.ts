export type CursorMode = "node" | "text" | "tree" | "related" | "";

export type PendingDrop = {
    file: File;
    dropPosition: { x: number; y: number };
    rootActivityNodeId: string;
};

export type GitConnectionStatus = {
    connected: boolean;
    user?: { id: number; login: string };
};
