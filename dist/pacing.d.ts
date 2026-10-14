export declare const sleep: (ms: number) => Promise<void>;
/** Waits for this request's turn (shared by every workspace in the process: the firewall counts per IP). */
export declare function pace(): Promise<void>;
/** A firewall block or rate limit, as opposed to a real "no permission" answer (those come as JSON). */
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