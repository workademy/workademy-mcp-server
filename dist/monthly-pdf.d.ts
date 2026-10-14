import { type ToolContext } from "./extended-tools.js";
import type { ReportSettings } from "./registry.js";
type Browser = import("playwright-core").Browser;
export declare const DEFAULT_MIN_COMPLETIONS = 5;
export declare function reportsDir(month: string): string;
/**
 * The numbers a PDF was made from, next to it (counts only, like the report itself), so a client's
 * "where does this number come from?" can be answered later.
 */
export declare function saveReportData(alias: string, report: any): Promise<string>;
/** A report is worth sending when people actually finished courses that month. */
export declare function sendDecision(report: any, settings: ReportSettings | undefined): {
    send: boolean;
    reason: string;
};
export interface MonthlyPdfResult {
    workspace: string;
    client: string;
    month: string;
    language: string;
    pdfPath: string;
    pages: number;
    fitsOnePage: boolean;
    layoutStep: number;
    headline: string;
    headlineKind: string;
    sendRecommendation: {
        send: boolean;
        reason: string;
    };
    numbers: Record<string, unknown>;
    warnings: string[];
}
/** The report settings for this run: workspaces.json, then the call's own arguments. */
export declare function effectiveSettings(ctx: ToolContext, args: Record<string, any>): ReportSettings;
export declare function createMonthlyPdf(ctx: ToolContext, args: Record<string, any>, options?: {
    browser?: Browser;
    budgetMs?: number;
    report?: any;
}): Promise<MonthlyPdfResult>;
export {};
//# sourceMappingURL=monthly-pdf.d.ts.map