import type { ReportLanguage, ReportSettings } from "./registry.js";
export type { ReportLanguage, ReportSettings } from "./registry.js";
export declare const REPO_ROOT: string;
/** Ukrainian plural: 1 курс, 2 курси, 5 курсів, 21 курс, 11 курсів. */
export declare function ukPlural(n: number, one: string, few: string, many: string): string;
export declare function isReportLanguage(value: unknown): value is ReportLanguage;
/** Settings first, then the workspace's own locale (uk_UA → uk, de_DE → de), else English. */
export declare function languageFor(settings: ReportSettings | undefined, locale: string | null | undefined): ReportLanguage;
/** Whole numbers with the language's thousands separator, kept on one line. */
export declare function formatNumber(value: number, lang: ReportLanguage): string;
/** `value` is already a percentage (15.8 = 15.8 %). `fixed` keeps trailing zeros (11.0 %) for table columns. */
export declare function formatPercent(value: number, lang: ReportLanguage, digits?: number, fixed?: boolean): string;
/** Course name for a sentence: the part before ":" when that is a real title, otherwise shortened. */
export declare function shortCourseName(name: string): string;
/** A question's text when it is readable enough to quote; analytics sometimes only has an id or a fragment. */
export declare function questionText(raw: unknown): string | null;
export interface PageModel {
    lang: ReportLanguage;
    client: string;
    monthIndex: number;
    year: number;
    periodFirstDay: number;
    periodLastDay: number;
    headline: string;
    headlineKind: "custom" | "share" | "finished_up" | "enrolled_up" | "busiest" | "quiet";
    kpis: Array<{
        value: string;
        label: string;
    }>;
    since: {
        label: string;
        parts: string[];
    } | null;
    table: {
        lastColumn: "completion" | "score" | null;
        rows: Array<{
            course: string;
            enrolled: number;
            finished: number;
            last: number | null;
        }>;
        activeCourses: number;
        totalEnrolled: number;
        totalFinished: number;
    };
    hotspots: Array<{
        title: string;
        where: string;
        rate: number;
        wrong: number;
        total: number;
    }>;
    hotspotsAllTime: boolean;
    minAnswers: number;
    analytics: boolean;
    toDateFromRecords: boolean;
}
export declare function buildPageModel(report: any, options: {
    language: ReportLanguage;
    client: string;
    headline?: string | null;
}): PageModel;
export declare const MAX_DENSITY: number;
export interface PageAssets {
    fontCss: string;
    workademyLogo: string;
    clientLogo: {
        dataUrl: string;
        aspect: number;
    } | null;
}
export declare function loadPageAssets(clientLogo: PageAssets["clientLogo"]): Promise<PageAssets>;
export declare function buildHtml(model: PageModel, assets: PageAssets, density?: number): string;
/** A logo from a URL, a data: URI or a local file (relative to the repo folder), as a data: URI. */
export declare function logoDataUri(source: string): Promise<string>;
type Browser = import("playwright-core").Browser;
/** A local Chrome, Chromium or Edge; WORKADEMY_CHROME_PATH wins. */
export declare function findChrome(): string | null;
export declare function launchBrowser(): Promise<Browser>;
export interface RenderResult {
    pdf: Buffer;
    html: string;
    pages: number;
    density: number;
    naturalHeight: number;
    fitsOnePage: boolean;
    logo: {
        used: boolean;
        index: number | null;
    };
}
/** Counts /Type /Page objects (not /Pages) in a PDF. */
export declare function countPdfPages(pdf: Buffer): number;
export declare function renderPdf(model: PageModel, options?: {
    browser?: Browser;
    logoCandidates?: string[];
}): Promise<RenderResult>;
/** "SE Ranking" → "SE-Ranking"; Latin letters only so attachments survive every mail client. */
export declare function pdfFileName(client: string, month: string, fallback: string): string;
//# sourceMappingURL=report-pdf.d.ts.map