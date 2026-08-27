/**
 * `blueprint_component` is gone: a component made on the canvas would not be drawn there, because
 * the canvas shows only components that answer a requirement. The tool moved into the tray, which is
 * where a component now lives until it answers something.
 */
export type CursorMode = "node" | "text" | "tree" | "related" | "";

export type GitConnectionStatus = {
    connected: boolean;
    user?: { id: number; login: string };
};
