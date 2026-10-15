/**
 * Workademy's API sits behind CloudFront with a firewall that blocks an IP for a few minutes
 * after a burst of requests: every call then gets 403 with an HTML page instead of JSON
 * (found 15 Oct 2026, during the first monthly run over 25 workspaces).
 *
 * Batch runs (npm run reports) therefore pace their requests and wait out a block. The MCP
 * server does neither by default (a tool call has 60 s), but says clearly what happened.
 *
 *   WORKADEMY_MIN_REQUEST_GAP_MS      minimum gap between requests (default 0)
 *   WORKADEMY_RATE_LIMIT_WAIT_MS      how long to wait out blocks in total (default 0 = fail at once)
 *   WORKADEMY_RATE_LIMIT_FIRST_WAIT_MS first pause, doubled each time up to 2 minutes (default 30 s)
 */
import type { AxiosError } from "axios";

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let nextSlot = 0;
let blockedUntil = 0;

const envMs = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

/** Waits for this request's turn (shared by every workspace in the process: the firewall counts per IP). */
export async function pace(): Promise<void> {
  const gap = envMs("WORKADEMY_MIN_REQUEST_GAP_MS", 0);
  const now = Date.now();
  const at = Math.max(now, blockedUntil, gap > 0 ? nextSlot : 0);
  if (gap > 0) nextSlot = at + gap;
  if (at > now) await sleep(at - now);
}

/**
 * A firewall block or rate limit, as opposed to the API's own answers. Only a 429, the firewall's
 * "Request blocked" HTML page, or an error that says so counts. (CloudFront marks every error
 * response "x-cache: Error from cloudfront", so that header proves nothing; and the API's own
 * 403s are JSON, e.g. {"reason":"Forbidden: User cannot access this course…","code":2100}.)
 */
export function isRateLimited(error: unknown): boolean {
  const response = (error as AxiosError | undefined)?.response;
  if (!response) return false;
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  const type = String(response.headers?.["content-type"] ?? "");
  const body =
    typeof response.data === "string" ? response.data : response.data ? JSON.stringify(response.data) : "";
  if (/request blocked|could not be satisfied|too many requests|rate limit/i.test(body)) return true;
  return /text\/html/i.test(type);
}

/**
 * Pause for everyone after a block. Returns false when the wait budget is used up
 * (the caller then gives up). `waited` is what this request has waited so far.
 */
export async function waitOutBlock(waited: number): Promise<{ ok: boolean; waited: number }> {
  const budget = envMs("WORKADEMY_RATE_LIMIT_WAIT_MS", 0);
  const first = envMs("WORKADEMY_RATE_LIMIT_FIRST_WAIT_MS", 30_000);
  const delay = Math.min(waited > 0 ? waited * 2 : first, Math.max(first, 120_000));
  if (waited + delay > budget) return { ok: false, waited };
  const until = Date.now() + delay;
  if (until > blockedUntil) {
    blockedUntil = until;
    process.stderr.write(`\n  Workademy is limiting requests from this computer; waiting ${Math.round(delay / 1000)} s…\n`);
  }
  await sleep(Math.max(blockedUntil - Date.now(), 0));
  return { ok: true, waited: waited + delay };
}
