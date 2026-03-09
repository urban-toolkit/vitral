import type { FormEvent } from "react";
import classes from "./CanvasChatOverlay.module.css";

export type CanvasChatEntry = {
    id: string;
    role: "user" | "assistant";
    content: string;
};

type CanvasChatOverlayProps = {
    open: boolean;
    loading: boolean;
    error: string | null;
    inputValue: string;
    filterActive: boolean;
    messages: CanvasChatEntry[];
    onInputValueChange: (value: string) => void;
    onSend: () => void;
    onClose: () => void;
    onClearFilter: () => void;
};

export function CanvasChatOverlay({
    open,
    loading,
    error,
    inputValue,
    filterActive,
    messages,
    onInputValueChange,
    onSend,
    onClose,
    onClearFilter,
}: CanvasChatOverlayProps) {
    if (!open) return null;

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSend();
    };

    return (
        <div className={classes.backdrop} onMouseDown={onClose}>
            <section
                className={classes.panel}
                onMouseDown={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="AI Assistant"
            >
                <header className={classes.header}>
                    <h3 className={classes.title}>AI Assitant</h3>
                    <div className={classes.headerActions}>
                        <button
                            type="button"
                            className={classes.filterButton}
                            disabled={!filterActive}
                            onClick={onClearFilter}
                        >
                            Clear canvas filter
                        </button>
                        <button
                            type="button"
                            className={classes.closeButton}
                            onClick={onClose}
                        >
                            Close
                        </button>
                    </div>
                </header>

                <div className={classes.messages}>
                    {messages.length === 0 ? (
                        <p className={classes.empty}>
                            Ask about the current canvas. Example: "Summarize most important concepts about transportation."
                        </p>
                    ) : (
                        messages.map((message) => (
                            <article
                                key={message.id}
                                className={`${classes.message} ${message.role === "user" ? classes.userMessage : classes.assistantMessage}`}
                            >
                                <span className={classes.messageRole}>
                                    {message.role === "user" ? "You" : "Assistant"}
                                </span>
                                <p className={classes.messageBody}>{message.content}</p>
                            </article>
                        ))
                    )}
                </div>

                {error ? (
                    <p className={classes.error}>{error}</p>
                ) : null}

                <form className={classes.form} onSubmit={onSubmit}>
                    <textarea
                        className={classes.input}
                        value={inputValue}
                        onChange={(event) => onInputValueChange(event.target.value)}
                        placeholder="Ask about your canvas..."
                        disabled={loading}
                        rows={3}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                onSend();
                            }
                        }}
                        autoFocus
                    />
                    <button
                        type="submit"
                        className={classes.sendButton}
                        disabled={loading || inputValue.trim().length === 0}
                    >
                        {loading ? "Thinking..." : "Send"}
                    </button>
                </form>
            </section>
        </div>
    );
}

