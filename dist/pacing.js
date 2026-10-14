export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextSlot = 0;
let blockedUntil = 0;
const envMs = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
};
/** Waits for this request's turn (shared by every workspace in the process: the firewall counts per IP). */
export async function pace() {
    const gap = envMs("WORKADEMY_MIN_REQUEST_GAP_MS", 0);
    const now = Date.now();
    const at = Math.max(now, blockedUntil, gap > 0 ? nextSlot : 0);
    if (gap > 0)
        nextSlot = at + gap;
    if (at > now)
        await sleep(at - now);
}
/** A firewall block or rate limit, as opposed to a real "no permission" answer (those come as JSON). */
export function isRateLimited(error) {
    const response = error?.response;
    if (!response)
        return false;
    if (response.status === 429)
        return true;
    if (response.status !== 403)
        return false;
    const type = String(response.headers?.["content-type"] ?? "");
    const cache = String(response.headers?.["x-cache"] ?? "");
    const body = typeof response.data === "string" ? response.data : "";
    if (/error from cloudfront/i.test(cache) || /request blocked|could not be satisfied/i.test(body))
        return true;
    // the API's own 403s are JSON objects ({"error":"access_denied", ...})
    return !/json/i.test(type) && !(response.data && typeof response.data === "object");
}
/**
 * Pause for everyone after a block. Returns false when the wait budget is used up
 * (the caller then gives up). `waited` is what this request has waited so far.
 */
export async function waitOutBlock(waited) {
    const budget = envMs("WORKADEMY_RATE_LIMIT_WAIT_MS", 0);
    const first = envMs("WORKADEMY_RATE_LIMIT_FIRST_WAIT_MS", 30_000);
    const delay = Math.min(waited > 0 ? waited * 2 : first, Math.max(first, 120_000));
    if (waited + delay > budget)
        return { ok: false, waited };
    const until = Date.now() + delay;
    if (until > blockedUntil) {
        blockedUntil = until;
        process.stderr.write(`\n  Workademy is limiting requests from this computer; waiting ${Math.round(delay / 1000)} s…\n`);
    }
    await sleep(Math.max(blockedUntil - Date.now(), 0));
    return { ok: true, waited: waited + delay };
}
//# sourceMappingURL=pacing.js.map