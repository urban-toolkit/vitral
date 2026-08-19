/**
 * Combines a caller's cancellation signal with a deadline.
 *
 * `signal ?? AbortSignal.timeout(ms)` reads as if it does the same thing, but it silently drops
 * the deadline for every caller that passes a signal — which is every file-drop path — so a
 * request the server never answers leaves the card spinner running indefinitely.
 */
export function withDeadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const deadline = AbortSignal.timeout(timeoutMs);
    if (!signal) return deadline;
    // Guard rather than assume: `any` shipped later than `timeout` in every engine.
    if (typeof AbortSignal.any !== "function") return signal;
    return AbortSignal.any([signal, deadline]);
}
