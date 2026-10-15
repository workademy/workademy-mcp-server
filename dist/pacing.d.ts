export declare const sleep: (ms: number) => Promise<void>;
/** Waits for this request's turn (shared by every workspace in the process: the firewall counts per IP). */
export declare function pace(): Promise<void>;
/**
 * A firewall block or rate limit, as opposed to the API's own answers. Only a 429, the firewall's
 * "Request blocked" HTML page, or an error that says so counts. (CloudFront marks every error
 * response "x-cache: Error from cloudfront", so that header proves nothing; and the API's own
 * 403s are JSON, e.g. {"reason":"Forbidden: User cannot access this course…","code":2100}.)
 */
export declare function isRateLimited(error: unknown): boolean;
/**
 * Pause for everyone after a block. Returns false when the wait budget is used up
 * (the caller then gives up). `waited` is what this request has waited so far.
 */
export declare function waitOutBlock(waited: number): Promise<{
    ok: boolean;
    waited: number;
}>;
//# sourceMappingURL=pacing.d.ts.map