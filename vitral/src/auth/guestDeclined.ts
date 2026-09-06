/**
 * "I asked not to be here."
 *
 * `RequireSession` opens the canvas for anyone arriving at `/project/:id?ref=…`, which is what lets a
 * code printed in a paper work for a reader with no account. That reference now **stays** in the
 * address bar after arrival, so the link a reader copies out of it is one that still works — and the
 * cost of that is this: `carriesReportReference` is then true on every later load of the same URL, so
 * signing out and reloading would sign the browser straight back in as a guest. The owner of a
 * project could not leave their own page.
 *
 * So an explicit sign-out — the account button, or leaving guest mode to go and get an account —
 * records that the answer to "shall I let you in anonymously?" is already no, and the automatic path
 * respects it. Nothing else sets it: arriving from a link is not a refusal, and neither is a failed
 * session lookup.
 *
 * Its own module because `SessionProvider` writes it and `RequireSession` reads it, and a file that
 * exports a component may not also export helpers — but the real reason is that neither of those two
 * owns this. It is a fact about the browser, like the guest flags beside it.
 *
 * `sessionStorage`, matching the lifetime of the automatic entry it vetoes rather than outlasting it.
 * The gesture is "get me out of this tab", so a tab opened fresh from the paper months later holds a
 * reader arriving for the first time, and is treated as one.
 */

const GUEST_DECLINED_KEY = "vitral.guest.declined";

/** Whether this tab has already refused anonymous entry. */
export function hasDeclinedGuestMode(): boolean {
    try {
        return window.sessionStorage.getItem(GUEST_DECLINED_KEY) === "1";
    } catch {
        // A browser refusing storage gets the behaviour that existed before this flag, which is the
        // safe direction to fail in: a reader following a citation still gets in.
        return false;
    }
}

export function writeGuestDeclined(value: boolean): void {
    try {
        if (value) window.sessionStorage.setItem(GUEST_DECLINED_KEY, "1");
        else window.sessionStorage.removeItem(GUEST_DECLINED_KEY);
    } catch {
        // Same trade as the guest flags: a browser that refuses storage still gets this session's
        // decision, it just gets asked again next time.
    }
}
