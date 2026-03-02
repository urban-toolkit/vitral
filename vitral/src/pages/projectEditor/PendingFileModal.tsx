import type { PendingDrop } from "@/pages/projectEditor/types";

type PendingFileModalProps = {
    pendingDrop: PendingDrop | null;
    generatedAtInput: string;
    onGeneratedAtInputChange: (value: string) => void;
    onCancel: () => void;
    onProcess: () => void;
};

export function PendingFileModal({
    pendingDrop,
    generatedAtInput,
    onGeneratedAtInputChange,
    onCancel,
    onProcess,
}: PendingFileModalProps) {
    if (!pendingDrop) return null;

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(0, 0, 0, 0.35)",
                zIndex: 10000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            <div
                style={{
                    backgroundColor: "white",
                    borderRadius: "10px",
                    padding: "18px",
                    width: "420px",
                    boxShadow: "0 10px 40px rgba(0, 0, 0, 0.2)",
                }}
            >
                <h3 style={{ marginTop: 0, marginBottom: "10px" }}>File generation timestamp</h3>
                <p style={{ marginTop: 0, marginBottom: "12px" }}>
                    Adjust the timestamp if needed for <strong>{pendingDrop.file.name}</strong>.
                </p>

                <input
                    type="datetime-local"
                    value={generatedAtInput}
                    onChange={(e) => onGeneratedAtInputChange(e.target.value)}
                    style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid #ccc",
                        borderRadius: "6px",
                        marginBottom: "14px",
                    }}
                />

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <button
                        type="button"
                        onClick={onCancel}
                        style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid #ccc", background: "white", cursor: "pointer" }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onProcess}
                        style={{ padding: "8px 12px", borderRadius: "6px", border: "none", background: "#161616", color: "white", cursor: "pointer" }}
                    >
                        Process file
                    </button>
                </div>
            </div>
        </div>
    );
}
