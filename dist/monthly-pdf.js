/**
 * One client's monthly PDF: report → page → reports/<YYYY-MM>/<Client>_Workademy_report_<YYYY-MM>.pdf
 * Used by the create_monthly_report_pdf tool and by `npm run reports`.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { monthlyReport, workspaceBranding } from "./extended-tools.js";
import { REPO_ROOT, buildPageModel, isReportLanguage, languageFor, logoDataUri, pdfFileName, renderPdf, } from "./report-pdf.js";
export const DEFAULT_MIN_COMPLETIONS = 5;
export const DEFAULT_MIN_ENROLLMENTS = 20;
export function reportsDir(month) {
    return path.resolve(process.env.WORKADEMY_REPORTS_DIR || path.join(REPO_ROOT, "reports"), month);
}
/**
 * The numbers a PDF was made from, next to it (counts only, like the report itself), so a client's
 * "where does this number come from?" can be answered later.
 */
export async function saveReportData(alias, report) {
    const dir = reportsDir(String(report.period?.month));
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${alias.replace(/[^A-Za-z0-9_-]+/g, "-")}.report.json`);
    await fs.writeFile(file, JSON.stringify(report, null, 1));
    return file;
}
/**
 * A report whose basic calls all failed is not "a quiet month". Returns what went wrong, or null.
 * (Found 15 Oct 2026: keys created a few minutes earlier were refused with 403 on every call.)
 */
export function reportProblem(report, alias) {
    const h = report?.headline ?? {};
    if (h.courses !== null && h.courses !== undefined)
        return null;
    if (h.learners !== null && h.learners !== undefined)
        return null;
    const warnings = report?.warnings ?? [];
    const refused = warnings.find((w) => /\b(401|403)\b/.test(w));
    if (refused) {
        const status = /\b(401|403)\b/.exec(refused)[1];
        return (`Workademy refused access (${status}), so there are no numbers. ` +
            `A key created in the last few minutes may not work yet: run again later with --only ${alias}.`);
    }
    return `could not read the workspace: ${warnings[0] ?? "no data came back"}`;
}
/**
 * A month is worth a report when people finished courses, or when many enrolled
 * (a client whose activity is growing should not get a win-back email).
 */
export function sendDecision(report, settings) {
    const setting = (value, fallback) => (Number.isFinite(Number(value)) && value !== null ? Number(value) : fallback);
    const minCompletions = setting(settings?.minCompletions, DEFAULT_MIN_COMPLETIONS);
    const minEnrollments = setting(settings?.minEnrollments, DEFAULT_MIN_ENROLLMENTS);
    const completions = Number(report?.headline?.completionsThisMonth ?? 0);
    const enrollments = Number(report?.headline?.newEnrollmentsThisMonth ?? 0);
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    if (completions >= minCompletions) {
        return { send: true, reason: `${plural(completions, "completion")} (threshold ${minCompletions})` };
    }
    if (enrollments >= minEnrollments) {
        return {
            send: true,
            reason: `${plural(enrollments, "new enrolment")} (threshold ${minEnrollments}), ${plural(completions, "completion")}`,
        };
    }
    return {
        send: false,
        reason: `${plural(completions, "completion")} and ${plural(enrollments, "new enrolment")}, below the thresholds ` +
            `(${minCompletions} completions or ${minEnrollments} new enrolments): send the win-back email instead`,
    };
}
/** The report settings for this run: workspaces.json, then the call's own arguments. */
export function effectiveSettings(ctx, args) {
    const settings = { ...(ctx.workspace.report ?? {}) };
    if (isReportLanguage(args.language))
        settings.language = args.language;
    if (typeof args.client === "string" && args.client.trim())
        settings.client = args.client.trim();
    if (typeof args.headline === "string" && args.headline.trim())
        settings.headline = args.headline.trim();
    if (typeof args.logo === "string" && args.logo.trim())
        settings.logo = args.logo.trim();
    return settings;
}
export async function createMonthlyPdf(ctx, args, options = {}) {
    const settings = effectiveSettings(ctx, args);
    const report = options.report ??
        (await monthlyReport(ctx, {
            month: args.month,
            includeDepartments: false,
            // the device bridge allows 60 s per tool call; leave room for the browser
            budgetMs: options.budgetMs ?? 35_000,
        }));
    const problem = reportProblem(report, ctx.workspace.alias);
    if (problem)
        throw new Error(`${ctx.workspace.alias}: ${problem}`);
    const warnings = [...(report.warnings ?? [])];
    const language = languageFor(settings, report.workspace?.locale);
    const client = settings.client || ctx.workspace.name || report.workspace?.name || ctx.workspace.alias;
    // Logo: the one set in workspaces.json, else the workspace's own (profile.json), first that shows on white
    let sources = [];
    if (settings.logo) {
        sources = [settings.logo];
    }
    else {
        const branding = await workspaceBranding(ctx).catch((error) => {
            warnings.push(`branding: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        });
        if (branding?.found) {
            sources = [branding.logos?.logo, branding.logos?.header, branding.logos?.footer].filter((s) => typeof s === "string" && s.length > 0);
        }
    }
    const candidates = [];
    for (const source of [...new Set(sources)]) {
        try {
            candidates.push(await logoDataUri(source));
        }
        catch (error) {
            warnings.push(`logo ${source}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const model = buildPageModel(report, { language, client, headline: settings.headline });
    const rendered = await renderPdf(model, { browser: options.browser, logoCandidates: candidates });
    if (!rendered.fitsOnePage) {
        warnings.push(`The page did not fit on one A4 page even in the most compact layout (${rendered.naturalHeight}px, ${rendered.pages} page(s)). Check the PDF before sending.`);
    }
    if (!rendered.logo.used) {
        warnings.push('No usable client logo, so the client name is shown instead. Set "report": { "logo": "<url or file>" } in workspaces.json.');
    }
    const month = String(report.period?.month);
    const pdfPath = path.join(reportsDir(month), pdfFileName(client, month, ctx.workspace.alias));
    await saveReportData(ctx.workspace.alias, report);
    await fs.writeFile(pdfPath, rendered.pdf);
    const h = report.headline ?? {};
    return {
        workspace: ctx.workspace.alias,
        client,
        month,
        language,
        pdfPath,
        pages: rendered.pages,
        fitsOnePage: rendered.fitsOnePage,
        layoutStep: rendered.density,
        headline: model.headline,
        headlineKind: model.headlineKind,
        sendRecommendation: sendDecision(report, settings),
        numbers: {
            newEnrollments: h.newEnrollmentsThisMonth ?? null,
            completions: h.completionsThisMonth ?? null,
            certificates: h.certificatesThisMonth ?? null,
            activeLearners: h.activeUsers ?? null,
            previousMonth: report.previousMonth ?? null,
        },
        warnings: warnings.slice(0, 20),
    };
}
//# sourceMappingURL=monthly-pdf.js.map