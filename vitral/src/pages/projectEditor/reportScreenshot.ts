import type { SystemScreenshotMarker } from "@/config/types";

/**
 * The one screenshot the markdown report carries, chosen and shrunk.
 *
 * Outside `report/` on purpose. Everything in that folder is a pure function of a `ReportSnapshot` —
 * no clock, no store, no DOM — which is what lets `npm run test:report` pin the whole document
 * without a browser. Picking the latest marker needs the store and re-encoding an image needs a
 * canvas, so both belong on this side of the seam, with the rest of the export's impure half.
 *
 * ## Why it is re-encoded at all
 *
 * A `.md` export is a single file with nothing beside it, so an image can only travel as a `data:`
 * URL. The previous attempt inlined every marker at its stored size and the result was a document no
 * markdown tool other than this app would open — a handful of 4K PNGs is tens of megabytes of
 * base64. Carrying exactly one figure fixes the *number*; this fixes the *size*, and between them
 * the cost of the picture stops depending on how long the study ran or what monitor it was captured
 * on.
 *
 * The ceiling is deliberately generous. A screenshot is read for its layout, not its pixels, and
 * 1600px on the long edge is still legible at full width in every renderer while landing under a
 * megabyte for a typical interface capture. An image already inside both limits is passed through
 * **untouched**, so the common case loses nothing at all.
 *
 * PNG is kept where it fits, because a UI screenshot is mostly text and flat fill and JPEG makes a
 * mess of both. JPEG is the fallback for the images that would otherwise blow the byte ceiling —
 * a photograph of a whiteboard, a very large capture — where a soft image beats an unopenable file.
 *
 * ## The one asterisk on "the same project exports the same bytes"
 *
 * `canvas.toDataURL` is encoder-dependent: the same image re-encoded on a different browser, OS or
 * graphics stack can differ byte for byte. Two exports of the same project from the same machine are
 * still identical — which is what the determinism check actually tests — but two exports from
 * different machines may now differ inside the figure even when every other byte agrees. The
 * pass-through above is what keeps that rare: an image already within both limits is never re-encoded
 * at all, so nothing but an oversized screenshot can vary.
 */

/** Longest edge, in pixels, above which the image is resampled. */
const MAX_EDGE_PX = 1600;
/** Data URL length, in characters, above which the encoding is retried as JPEG. */
const MAX_DATA_URL_CHARS = 2_000_000;
const JPEG_QUALITY = 0.82;

export type ReportScreenshot = { occurredAtIso: string; imageDataUrl: string };

function occurredAtMs(marker: SystemScreenshotMarker): number {
    const parsed = Date.parse(marker.occurredAt);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function hasImage(marker: SystemScreenshotMarker): boolean {
    return typeof marker.imageDataUrl === "string" && marker.imageDataUrl.trim().startsWith("data:image/");
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not decode the screenshot."));
        image.src = dataUrl;
    });
}

/**
 * `dataUrl` at no more than `MAX_EDGE_PX` on its long edge and `MAX_DATA_URL_CHARS` in length, or
 * the original string when it is already within both.
 */
async function shrink(dataUrl: string): Promise<string> {
    const withinByteBudget = dataUrl.length <= MAX_DATA_URL_CHARS;

    const image = await loadImage(dataUrl);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width <= 0 || height <= 0) return dataUrl;

    const longestEdge = Math.max(width, height);
    const scale = longestEdge > MAX_EDGE_PX ? MAX_EDGE_PX / longestEdge : 1;
    // Nothing to gain: the image is small enough on both counts, and re-encoding it could only cost
    // quality.
    if (scale === 1 && withinByteBudget) return dataUrl;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const asPng = canvas.toDataURL("image/png");
    if (asPng.length <= MAX_DATA_URL_CHARS) return asPng;

    // Still too big at PNG. A soft screenshot in a file that opens beats a crisp one in a file that
    // does not — and if even JPEG cannot get there, the smaller of the two is still the right answer.
    const asJpeg = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return asJpeg.length < asPng.length ? asJpeg : asPng;
}

/**
 * The most recent marker that actually holds an image, ready to inline — or `null`.
 *
 * "Actually holds an image" is the operative part: the screenshot panel creates a marker and *then*
 * opens the file picker, so a marker with no image is an ordinary state rather than corruption, and
 * the newest marker is not always the newest picture. Taking the newest marker outright would print
 * nothing for a study whose last act was to click `+`.
 *
 * Never throws. A screenshot that will not decode costs the figure and leaves the rest of the export
 * exactly as it was; the report does not depend on it.
 */
export async function resolveLatestReportScreenshot(
    markers: readonly SystemScreenshotMarker[],
): Promise<ReportScreenshot | null> {
    let latest: SystemScreenshotMarker | null = null;
    for (const marker of markers) {
        if (!marker || !hasImage(marker)) continue;
        // `>=`, so a tie goes to the later marker in the array — the tie-break
        // `mostRecentSystemScreenshotMarker` already uses for "the latest marker". Two markers stamped
        // in the same second is reachable, because `resolveActionTimestamp` returns whole instants.
        //
        // This does not promise the export shows what the panel shows: the panel renders
        // `playbackAwareSystemScreenshotMarker`, which is scoped to the playhead, while an export
        // describes the whole project and is deliberately not. Scrub back and the two differ — by the
        // scrubber, not by disagreeing about which marker is last.
        if (latest === null || occurredAtMs(marker) >= occurredAtMs(latest)) latest = marker;
    }
    if (!latest) return null;

    const occurredAt = new Date(latest.occurredAt);
    const occurredAtIso = Number.isNaN(occurredAt.getTime())
        ? latest.occurredAt
        : occurredAt.toISOString();

    try {
        return { occurredAtIso, imageDataUrl: await shrink(latest.imageDataUrl.trim()) };
    } catch {
        return null;
    }
}
