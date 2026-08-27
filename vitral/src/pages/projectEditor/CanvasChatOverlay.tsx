import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import classes from "./CanvasChatOverlay.module.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';

export type CanvasChatEntry = {
    id: string;
    role: "user" | "assistant";
    content: string;
};

type CanvasChatOverlayProps = {
    open: boolean;
    loading: boolean;
    error: string | null;
    filterActive: boolean;
    messages: CanvasChatEntry[];
    /**
     * Called with the draft text. The draft itself lives in here rather than in the editor page: a
     * keystroke there re-ran that component's 39 memo dependency lists and 16 store selectors, and
     * put a new `onSend` identity on every render.
     */
    onSend: (text: string) => void;
    onClose: () => void;
    onClearFilter: () => void;
};

export function CanvasChatOverlay({
    open,
    loading,
    error,
    filterActive,
    messages,
    onSend,
    onClose,
    onClearFilter,
}: CanvasChatOverlayProps) {
    const [inputValue, setInputValue] = useState("");
    const bottomRef = useRef<HTMLDivElement | null>(null);

    // The thinking bubble is appended below the question, which on a long conversation is below the
    // fold — an indicator nobody can see is not one. Follows the answer down as well, so the reply
    // lands in view rather than needing to be scrolled to.
    useEffect(() => {
        if (!open) return;
        bottomRef.current?.scrollIntoView({ block: "end" });
    }, [open, loading, messages.length]);

    const send = useCallback(() => {
        const trimmed = inputValue.trim();
        if (!trimmed) return;
        setInputValue("");
        onSend(trimmed);
    }, [inputValue, onSend]);

    const onSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        send();
    }, [send]);

    if (!open) return null;

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
                    <h3 className={classes.title}>AI Assistant</h3>
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
                            Example: "List out all requirements including their titles and descriptions."
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

                    {loading ? (
                        <article
                            className={`${classes.message} ${classes.assistantMessage} ${classes.pending}`}
                            aria-live="polite"
                        >
                            <span className={classes.messageRole}>Assistant</span>
                            <p className={classes.thinking}>
                                <span className={classes.thinkingDots} aria-hidden="true">
                                    <span className={classes.thinkingDot} />
                                    <span className={classes.thinkingDot} />
                                    <span className={classes.thinkingDot} />
                                </span>
                                Thinking...
                            </p>
                        </article>
                    ) : null}

                    <div ref={bottomRef} />
                </div>

                {error ? (
                    <p className={classes.error}>{error}</p>
                ) : null}

                <form className={classes.form} onSubmit={onSubmit}>
                    <textarea
                        className={classes.input}
                        value={inputValue}
                        onChange={(event) => setInputValue(event.target.value)}
                        placeholder="Ask about your design process..."
                        disabled={loading}
                        rows={3}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                send();
                            }
                        }}
                        autoFocus
                    />
                    <button
                        type="submit"
                        className={classes.sendButton}
                        disabled={loading || inputValue.trim().length === 0}
                    >
                        {loading ? "..." : <FontAwesomeIcon icon={faPaperPlane}></FontAwesomeIcon>}
                    </button>
                </form>
            </section>
        </div>
    );
}

