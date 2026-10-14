/// <reference lib="dom" />  // page.evaluate() callbacks run in the browser
/**
 * Client one-pager as a PDF: the monthly report (get_monthly_report) laid out on one A4 page
 * in Workademy's brand, in English, German or Ukrainian.
 *
 * The page is printed by a local Chrome/Chromium through playwright-core. It is measured
 * before printing and made more compact step by step until it fits; the finished PDF is
 * checked to have exactly one page.
 */
import { existsSync, readdirSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { stripHtml } from "./analytics.js";
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(REPO_ROOT, "assets");
/** Natural page height (CSS px) we accept before printing; A4 is 1122.5 px. */
const FIT_LIMIT = 1110;
// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------
const LOCALES = { en: "en-GB", de: "de-DE", uk: "uk-UA" };
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EN_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DE_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const DE_SHORT = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
const UK_NOM = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
const UK_GEN = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
const UK_LOC = ["січні", "лютому", "березні", "квітні", "травні", "червні", "липні", "серпні", "вересні", "жовтні", "листопаді", "грудні"];
const UK_ADJ = ["січневих", "лютневих", "березневих", "квітневих", "травневих", "червневих", "липневих", "серпневих", "вересневих", "жовтневих", "листопадових", "грудневих"];
/** Ukrainian plural: 1 курс, 2 курси, 5 курсів, 21 курс, 11 курсів. */
export function ukPlural(n, one, few, many) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11)
        return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14))
        return few;
    return many;
}
const STRINGS = {
    en: {
        displayFont: "Staatliches",
        label: (client) => `${client} · Monthly learning report`,
        prepared: "Prepared by",
        title: (m, y) => `${EN_MONTHS[m]} ${y}`,
        kpiEnrolled: "new enrolments",
        kpiFinished: "courses finished",
        kpiCertificates: (score) => (score ? `certificates, avg. score ${score}` : "certificates issued"),
        kpiCompletionAllTime: "completion rate, all time",
        kpiActive: "active learners",
        kpiLogins: "logins",
        kpiLearners: "registered learners",
        since: (m, y) => `Since ${EN_SHORT[m]} ${y}:`,
        allTime: "All time:",
        sinceEnrolments: (n) => `<b>${n}</b> enrolments`,
        sinceCompleted: (n, rate) => `<b>${n}</b> completed (${rate})`,
        sinceLearners: (n) => `<b>${n}</b> registered learners`,
        sinceCourses: (n) => `<b>${n}</b> courses`,
        tableTitle: (m) => `Where ${EN_MONTHS[m]}’s learners went`,
        colCourse: "Course",
        colEnrolled: "Enrolled",
        colFinished: "Finished",
        colCompletion: "All-time completion",
        colScore: "Avg. score",
        more: (n, f) => `${f} more ${n === 1 ? "course" : "courses"}`,
        whereTitle: "Where to look",
        whereIntro: "When this many answers to one question are wrong, the question itself is often the cause: a wrongly marked answer, two answers that both look right, or a gap in the lesson.",
        whereAllTime: "These are all-time answers: this month had too few.",
        whereClosing: "We’d start with question 1: check which answer is marked as correct, then the lesson it tests.",
        wrongOf: (w, t) => `${w} of ${t} wrong`,
        quote: (t) => `“${t}”`,
        period: (first, last, m, y) => `${first}–${last} ${EN_SHORT[m]} ${y}`,
        how: (period, o) => `How we counted: ${period} (UTC), ${o.analytics ? "from Workademy analytics" : "from the enrolment records"}` +
            `${o.analytics && o.toDateFromRecords ? "; all-time totals from the enrolment records" : ""}. ` +
            `Counts only, no names. Questions with fewer than ${o.minAnswers} answers are left out; a learner can answer more than once.`,
        check: "If a number looks wrong to you, tell us and we’ll check it.",
        headlineShare: ({ half, share, m, course }) => half
            ? `More than half of ${EN_MONTHS[m]}’s enrolments (${share}) went to one course: “${course}”.`
            : `${share} of ${EN_MONTHS[m]}’s enrolments went to one course: “${course}”.`,
        headlineFinishedUp: (n, g, m, pm) => `${n} courses finished in ${EN_MONTHS[m]}, ${g} more than in ${EN_MONTHS[pm]}.`,
        headlineEnrolledUp: (n, g, m, pm) => `${n} new enrolments in ${EN_MONTHS[m]}, ${g} more than in ${EN_MONTHS[pm]}.`,
        headlineBusiest: (m, course, n, f) => `The busiest course in ${EN_MONTHS[m]} was “${course}”, with ${f} new ${n === 1 ? "enrolment" : "enrolments"}.`,
        headlineQuiet: (m) => `No new enrolments in ${EN_MONTHS[m]}.`,
    },
    de: {
        displayFont: "Staatliches",
        label: (client) => `${client} · Monatlicher Lernbericht`,
        prepared: "Erstellt von",
        title: (m, y) => `${DE_MONTHS[m]} ${y}`,
        kpiEnrolled: "neue Einschreibungen",
        kpiFinished: "abgeschlossene Kurse",
        kpiCertificates: (score) => (score ? `Zertifikate, Ø ${score}` : "ausgestellte Zertifikate"),
        kpiCompletionAllTime: "Abschlussquote gesamt",
        kpiActive: "aktive Lernende",
        kpiLogins: "Anmeldungen",
        kpiLearners: "registrierte Lernende",
        since: (m, y) => `Seit ${DE_SHORT[m]} ${y}:`,
        allTime: "Insgesamt:",
        sinceEnrolments: (n) => `<b>${n}</b> Einschreibungen`,
        sinceCompleted: (n, rate) => `<b>${n}</b> abgeschlossen (${rate})`,
        sinceLearners: (n) => `<b>${n}</b> registrierte Lernende`,
        sinceCourses: (n) => `<b>${n}</b> Kurse`,
        tableTitle: (m) => `Die meistbesuchten Kurse im ${DE_MONTHS[m]}`,
        colCourse: "Kurs",
        colEnrolled: "Eingeschrieben",
        colFinished: "Abgeschlossen",
        colCompletion: "Abschlussquote gesamt",
        colScore: "Ø-Punktzahl",
        more: (n, f) => (n === 1 ? "1 weiterer Kurs" : `${f} weitere Kurse`),
        whereTitle: "Wo es hakt",
        whereIntro: "Wenn so viele Antworten auf eine Frage falsch sind, liegt es oft an der Frage selbst: eine falsch markierte Antwort, zwei Antworten, die beide richtig wirken, oder eine Lücke in der Lektion.",
        whereAllTime: "Das sind Antworten seit Beginn: In diesem Monat gab es zu wenige.",
        whereClosing: "Wir würden mit Frage 1 anfangen: Prüfen Sie, welche Antwort als richtig markiert ist, und dann die Lektion dazu.",
        wrongOf: (w, t) => `${w} von ${t} falsch`,
        quote: (t) => `„${t}“`,
        period: (first, last, m, y) => `${first}.–${last}. ${DE_MONTHS[m]} ${y}`,
        how: (period, o) => `So haben wir gezählt: ${period} (UTC), ${o.analytics ? "Workademy-Analytics" : "Einschreibungsdaten"}` +
            `${o.analytics && o.toDateFromRecords ? "; Gesamtwerte aus den Einschreibungsdaten" : ""}. ` +
            `Nur Anzahlen, keine Namen. Fragen mit weniger als ${o.minAnswers} Antworten sind nicht enthalten; Lernende können mehrmals antworten.`,
        check: "Wenn Ihnen eine Zahl falsch vorkommt, sagen Sie uns Bescheid – wir prüfen das.",
        headlineShare: ({ half, share, m, course }) => half
            ? `Mehr als die Hälfte der Einschreibungen im ${DE_MONTHS[m]} (${share}) entfiel auf einen Kurs: „${course}“.`
            : `${share} der Einschreibungen im ${DE_MONTHS[m]} entfielen auf einen Kurs: „${course}“.`,
        headlineFinishedUp: (n, g, m, pm) => `${n} abgeschlossene Kurse im ${DE_MONTHS[m]}, ${g} mehr als im ${DE_MONTHS[pm]}.`,
        headlineEnrolledUp: (n, g, m, pm) => `${n} neue Einschreibungen im ${DE_MONTHS[m]}, ${g} mehr als im ${DE_MONTHS[pm]}.`,
        headlineBusiest: (m, course, n, f) => `Der meistbesuchte Kurs im ${DE_MONTHS[m]}: „${course}“ mit ${n === 1 ? "einer neuen Einschreibung" : `${f} neuen Einschreibungen`}.`,
        headlineQuiet: (m) => `Im ${DE_MONTHS[m]} gab es keine neuen Einschreibungen.`,
    },
    uk: {
        displayFont: "Oswald",
        label: (client) => `${client} · Щомісячний звіт про навчання`,
        prepared: "Підготовлено",
        title: (m, y) => `${UK_NOM[m]} ${y}`,
        kpiEnrolled: "нові записи на курси",
        kpiFinished: "завершені курси",
        kpiCertificates: (score) => (score ? `сертифікати, сер. бал ${score}` : "видані сертифікати"),
        kpiCompletionAllTime: "частка завершень за весь час",
        kpiActive: "активні слухачі",
        kpiLogins: "входи на платформу",
        kpiLearners: "зареєстровані слухачі",
        since: (m, y) => `З ${UK_GEN[m]} ${y} року:`,
        allTime: "За весь час:",
        sinceEnrolments: (n) => `записів на курси — <b>${n}</b>`,
        sinceCompleted: (n, rate) => `завершено — <b>${n}</b> (${rate})`,
        sinceLearners: (n) => `зареєстровано слухачів — <b>${n}</b>`,
        sinceCourses: (n) => `курсів — <b>${n}</b>`,
        tableTitle: (m) => `Куди записувалися у ${UK_LOC[m]}`,
        colCourse: "Курс",
        colEnrolled: "Записалися",
        colFinished: "Завершили",
        colCompletion: "Частка завершень",
        colScore: "Середній бал",
        more: (n, f) => `Ще ${f} ${ukPlural(n, "курс", "курси", "курсів")}`,
        whereTitle: "Куди варто подивитися",
        whereIntro: "Коли на одне питання так багато хибних відповідей, причина часто в самому питанні: неправильно позначена відповідь, дві схожі відповіді або прогалина в лекції.",
        whereAllTime: "Це відповіді за весь час: цього місяця їх замало.",
        whereClosing: "Ми б почали з першого: перевірте, яку відповідь позначено правильною, і чи пояснює її лекція.",
        wrongOf: (w, t) => `${w} з ${t} хибних`,
        quote: (t) => `«${t}»`,
        period: (first, last, m, y) => `${first}–${last} ${UK_GEN[m]} ${y}`,
        how: (period, o) => `Як ми рахували: ${period} (UTC), ${o.analytics ? "аналітика Workademy" : "дані записів на курси"}` +
            `${o.analytics && o.toDateFromRecords ? "; підсумки за весь час — із записів на курси" : ""}. ` +
            `Лише кількості, без імен. Питання, на які менше ${o.minAnswers} відповідей, не враховано; слухач може відповідати кілька разів.`,
        check: "Цифра здається неправильною? Напишіть нам — ми перевіримо.",
        headlineShare: ({ half, share, m, course }) => half
            ? `Понад половина ${UK_ADJ[m]} записів (${share}) — на курс «${course}».`
            : `${share} ${UK_ADJ[m]} записів — на курс «${course}».`,
        headlineFinishedUp: (n, g, m, pm) => `Завершених курсів у ${UK_LOC[m]} — ${n}, на ${g} більше, ніж у ${UK_LOC[pm]}.`,
        headlineEnrolledUp: (n, g, m, pm) => `Нових записів у ${UK_LOC[m]} — ${n}, на ${g} більше, ніж у ${UK_LOC[pm]}.`,
        headlineBusiest: (m, course, n, f) => `Найпопулярніший курс у ${UK_LOC[m]} — «${course}»: ${f} ${ukPlural(n, "новий запис", "нові записи", "нових записів")}.`,
        headlineQuiet: (m) => `У ${UK_LOC[m]} нових записів не було.`,
    },
};
export function isReportLanguage(value) {
    return value === "en" || value === "de" || value === "uk";
}
/** Settings first, then the workspace's own locale (uk_UA → uk, de_DE → de), else English. */
export function languageFor(settings, locale) {
    if (isReportLanguage(settings?.language))
        return settings.language;
    const code = String(locale ?? "").slice(0, 2).toLowerCase();
    return code === "uk" || code === "de" ? code : "en";
}
// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const n0 = (value) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
};
/** Whole numbers with the language's thousands separator, kept on one line. */
export function formatNumber(value, lang) {
    return new Intl.NumberFormat(LOCALES[lang], { maximumFractionDigits: 0 })
        .format(value)
        .replace(/[\u202F ]/g, "\u00A0");
}
/** `value` is already a percentage (15.8 = 15.8 %). `fixed` keeps trailing zeros (11.0 %) for table columns. */
export function formatPercent(value, lang, digits = 0, fixed = false) {
    const number = new Intl.NumberFormat(LOCALES[lang], {
        minimumFractionDigits: fixed ? digits : 0,
        maximumFractionDigits: digits,
    }).format(value);
    return lang === "de" ? `${number}\u00A0%` : `${number}%`;
}
/** Course name for a sentence: the part before ":" when that is a real title, otherwise shortened. */
export function shortCourseName(name) {
    const clean = name.replace(/\s+/g, " ").trim();
    const colon = clean.indexOf(":");
    if (colon >= 8 && colon <= 48)
        return clean.slice(0, colon).trim();
    if (clean.length <= 48)
        return clean;
    return clean.slice(0, 46).replace(/\s+\S*$/, "") + "…";
}
/** A question's text when it is readable enough to quote; analytics sometimes only has an id or a fragment. */
export function questionText(raw) {
    const text = stripHtml(String(raw ?? "")).replace(/\s+/g, " ").trim().replace(/\s*\.{3}$/, "…");
    if (!text || /^\d+$/.test(text))
        return null;
    const words = text.split(" ").filter((w) => /\p{L}{2,}/u.test(w));
    if (text.length < 12 || words.length < 2)
        return null;
    // analytics cuts long questions; mark that instead of pretending it is the full text
    const looksCut = text.length >= 45 && !/[.?!:;…»”“"')\]]$/.test(text);
    return looksCut ? `${text.replace(/[\s,;:-]+$/, "")}…` : text;
}
export function buildPageModel(report, options) {
    const lang = options.language;
    const t = STRINGS[lang];
    const [year, month] = String(report.period?.month ?? "").split("-").map(Number);
    const monthIndex = (month || 1) - 1;
    const end = new Date(report.period?.end ?? Date.UTC(year, month, 0));
    const h = report.headline ?? {};
    const fmt = (v) => formatNumber(v, lang);
    const analytics = report.sources?.enrollments === "analytics API";
    const toDateFromRecords = !analytics || Boolean(report.sources?.toDate);
    // --- KPIs ---
    const kpis = [
        { value: fmt(n0(h.newEnrollmentsThisMonth)), label: t.kpiEnrolled },
        { value: fmt(n0(h.completionsThisMonth)), label: t.kpiFinished },
    ];
    if (h.certificatesThisMonth !== null && h.certificatesThisMonth !== undefined) {
        const score = h.avgCertificateScoreThisMonth;
        kpis.push({
            value: fmt(n0(h.certificatesThisMonth)),
            label: t.kpiCertificates(typeof score === "number" && n0(h.certificatesThisMonth) > 0 ? formatPercent(score, lang) : null),
        });
    }
    else if (typeof h.completionRateToDate === "number") {
        kpis.push({ value: formatPercent(h.completionRateToDate, lang), label: t.kpiCompletionAllTime });
    }
    if (typeof h.activeUsers === "number")
        kpis.push({ value: fmt(h.activeUsers), label: t.kpiActive });
    else if (typeof h.logins === "number")
        kpis.push({ value: fmt(h.logins), label: t.kpiLogins });
    else if (typeof h.learners === "number")
        kpis.push({ value: fmt(h.learners), label: t.kpiLearners });
    // --- "Since …" strip ---
    const created = report.workspace?.createdAt ? new Date(report.workspace.createdAt) : null;
    const sinceLabel = created && !Number.isNaN(created.getTime()) ? t.since(created.getUTCMonth(), created.getUTCFullYear()) : t.allTime;
    const parts = [];
    if (toDateFromRecords && n0(h.enrollmentsToDate) > 0) {
        parts.push(t.sinceEnrolments(fmt(n0(h.enrollmentsToDate))));
        parts.push(t.sinceCompleted(fmt(n0(h.completionsToDate)), formatPercent(n0(h.completionRateToDate), lang, 1)));
        if (typeof h.learners === "number")
            parts.push(t.sinceLearners(fmt(h.learners)));
    }
    else {
        if (typeof h.learners === "number")
            parts.push(t.sinceLearners(fmt(h.learners)));
        if (typeof h.courses === "number")
            parts.push(t.sinceCourses(fmt(h.courses)));
    }
    // --- Courses this month ---
    const top = (report.topCoursesThisMonth ?? []).filter((r) => n0(r.enrolled) > 0 || n0(r.finished) > 0);
    const lastColumn = top.some((r) => typeof r.completionRateToDate === "number")
        ? "completion"
        : top.some((r) => typeof r.avgCertificateScorePercent === "number")
            ? "score"
            : null;
    const rows = top.map((r) => ({
        course: stripHtml(String(r.course ?? r.courseId)),
        enrolled: n0(r.enrolled),
        finished: n0(r.finished),
        last: lastColumn === "completion"
            ? (r.completionRateToDate ?? null)
            : lastColumn === "score"
                ? (r.avgCertificateScorePercent ?? null)
                : null,
    }));
    // --- Questions ---
    const questions = report.struggleHotspots?.questions ?? [];
    const hotspots = questions.map((q) => {
        const text = questionText(q.question);
        // short course title, so the lecture still fits on the location line
        const course = shortCourseName(stripHtml(String(q.course ?? "")));
        const module = stripHtml(String(q.module ?? ""));
        const lecture = stripHtml(String(q.lecture ?? ""));
        const trail = [course, module, ...(text ? [lecture] : [])].filter((part, i, all) => part && part !== all[i - 1] && !/^\d+$/.test(part));
        if (!text && lecture === module)
            trail.pop();
        const wrong = n0(q.wrongAnswers);
        const total = wrong + n0(q.correctAnswers);
        return {
            title: text ? t.quote(text) : lecture || module || course,
            where: trail.join(" › "),
            rate: total > 0 ? Math.round((wrong / total) * 100) : 0,
            wrong,
            total,
        };
    });
    // --- Headline: one insight, not a repeat of the tiles ---
    let headline;
    let headlineKind;
    const enrolled = n0(h.newEnrollmentsThisMonth);
    const finished = n0(h.completionsThisMonth);
    const prev = report.previousMonth;
    const prevIndex = prev?.month ? Number(String(prev.month).split("-")[1]) - 1 : (monthIndex + 11) % 12;
    const growth = (now, before) => (before > 0 ? ((now - before) / before) * 100 : 0);
    if (options.headline && options.headline.trim()) {
        headline = options.headline.trim();
        headlineKind = "custom";
    }
    else if (rows[0] && enrolled >= 20 && rows[0].enrolled / enrolled >= 0.4) {
        const share = (rows[0].enrolled / enrolled) * 100;
        headline = t.headlineShare({
            half: share > 50,
            share: formatPercent(Math.round(share), lang),
            m: monthIndex,
            course: shortCourseName(rows[0].course),
        });
        headlineKind = "share";
    }
    else if (prev && n0(prev.completions) >= 5 && finished >= 10 && growth(finished, n0(prev.completions)) >= 15) {
        headline = t.headlineFinishedUp(fmt(finished), formatPercent(Math.round(growth(finished, n0(prev.completions))), lang), monthIndex, prevIndex);
        headlineKind = "finished_up";
    }
    else if (prev && n0(prev.newEnrollments) >= 10 && enrolled >= 20 && growth(enrolled, n0(prev.newEnrollments)) >= 15) {
        headline = t.headlineEnrolledUp(fmt(enrolled), formatPercent(Math.round(growth(enrolled, n0(prev.newEnrollments))), lang), monthIndex, prevIndex);
        headlineKind = "enrolled_up";
    }
    else if (rows[0] && rows[0].enrolled > 0) {
        headline = t.headlineBusiest(monthIndex, shortCourseName(rows[0].course), rows[0].enrolled, fmt(rows[0].enrolled));
        headlineKind = "busiest";
    }
    else {
        headline = t.headlineQuiet(monthIndex);
        headlineKind = "quiet";
    }
    return {
        lang,
        client: options.client,
        monthIndex,
        year: year || new Date().getUTCFullYear(),
        periodFirstDay: 1,
        periodLastDay: Number.isNaN(end.getTime()) ? 30 : end.getUTCDate(),
        headline,
        headlineKind,
        kpis,
        since: parts.length ? { label: sinceLabel, parts } : null,
        table: {
            lastColumn,
            rows,
            activeCourses: Math.max(n0(report.coursesActiveThisMonth), rows.length),
            totalEnrolled: enrolled,
            totalFinished: finished,
        },
        hotspots,
        hotspotsAllTime: /^since/i.test(String(report.struggleHotspots?.window ?? "")),
        minAnswers: n0(report.struggleHotspots?.minAnswers) || 5,
        analytics,
        toDateFromRecords,
    };
}
// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
/** Steps from the designed layout to the most compact one. */
const DENSITY = [
    { rows: 5, hotspots: 3, gap: 14, pad: [38, 52, 36], scale: 1, body: 15, row: 6, hot: 8, kpiLabel: 13 },
    { rows: 5, hotspots: 3, gap: 11, pad: [34, 52, 30], scale: 0.94, body: 15, row: 5, hot: 6, kpiLabel: 13 },
    { rows: 4, hotspots: 3, gap: 10, pad: [32, 48, 28], scale: 0.9, body: 14.5, row: 4, hot: 6, kpiLabel: 12.5 },
    { rows: 3, hotspots: 2, gap: 10, pad: [32, 48, 28], scale: 0.88, body: 14, row: 4, hot: 5, kpiLabel: 12.5 },
    { rows: 3, hotspots: 2, gap: 8, pad: [28, 44, 24], scale: 0.85, body: 13.5, row: 3, hot: 5, kpiLabel: 12 },
];
export const MAX_DENSITY = DENSITY.length - 1;
let fontCss = null;
async function loadFontCss() {
    if (fontCss)
        return fontCss;
    const manifest = JSON.parse(await fs.readFile(path.join(ASSETS, "fonts", "fonts.json"), "utf8"));
    const faces = await Promise.all(manifest.fonts.map(async (f) => {
        const data = (await fs.readFile(path.join(ASSETS, "fonts", f.file))).toString("base64");
        return (`@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:block;` +
            `src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${f.unicodeRange}}`);
    }));
    fontCss = faces.join("\n");
    return fontCss;
}
export async function loadPageAssets(clientLogo) {
    const logo = await fs.readFile(path.join(ASSETS, "workademy-logo.png"));
    return {
        fontCss: await loadFontCss(),
        workademyLogo: `data:image/png;base64,${logo.toString("base64")}`,
        clientLogo,
    };
}
export function buildHtml(model, assets, density = 0) {
    const t = STRINGS[model.lang];
    const d = DENSITY[Math.min(Math.max(density, 0), MAX_DENSITY)];
    const oswald = t.displayFont === "Oswald";
    // Oswald is wider and taller than Staatliches, so its sizes are a little smaller
    const size = (staatliches, oswaldSize) => Math.round((oswald ? oswaldSize : staatliches) * d.scale);
    const fmt = (v) => formatNumber(v, model.lang);
    const title = t.title(model.monthIndex, model.year);
    const rows = model.table.rows.slice(0, d.rows);
    const rest = Math.max(model.table.activeCourses - rows.length, 0);
    const restEnrolled = Math.max(model.table.totalEnrolled - rows.reduce((s, r) => s + r.enrolled, 0), 0);
    const restFinished = Math.max(model.table.totalFinished - rows.reduce((s, r) => s + r.finished, 0), 0);
    const lastHead = model.table.lastColumn === "completion" ? t.colCompletion : model.table.lastColumn === "score" ? t.colScore : null;
    const lastCell = (v) => v === null ? "–" : formatPercent(v, model.lang, model.table.lastColumn === "completion" ? 1 : 0, true);
    const hotspots = model.hotspots.slice(0, d.hotspots);
    const clientLogo = assets.clientLogo;
    const clientLogoHeight = clientLogo && clientLogo.aspect < 3 ? 36 : 30;
    const css = `
${assets.fontCss}
@page{size:210mm 297mm;margin:0}
html,body{margin:0;padding:0;background:#FCFCFC}
*{box-sizing:border-box}
#page{width:210mm;height:297mm;overflow:hidden;padding:${d.pad[0]}px ${d.pad[1]}px ${d.pad[2]}px;display:flex;flex-direction:column;gap:${d.gap}px;background:#FCFCFC;color:#16202B;font-family:'Roboto','Helvetica Neue',Arial,sans-serif;font-size:${d.body}px;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.disp{font-family:'${t.displayFont}','Arial Narrow',sans-serif;font-weight:${oswald ? 500 : 400}}
header{display:flex;flex-direction:column;gap:10px}
.top{display:flex;justify-content:space-between;align-items:center;gap:24px;padding-bottom:10px;border-bottom:1px solid #D5DBE3}
.client-logo{height:${clientLogoHeight}px;width:auto;max-width:300px;display:block}
.client-name{font-size:20px;font-weight:700;line-height:1.2}
.by{display:flex;align-items:center;gap:10px;flex-shrink:0}
.by span{font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:#4A5563}
.by img{height:30px;width:auto;display:block}
.titles{display:flex;flex-direction:column;gap:2px}
.label{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#006FB9}
h1{margin:0;font-size:${size(52, 46)}px;line-height:${oswald ? 1.05 : 1};letter-spacing:.01em${oswald ? ";text-transform:uppercase" : ""}}
.lead{margin:0;font-size:16.5px;line-height:1.5;text-wrap:pretty}
.kpis{display:grid;grid-template-columns:repeat(${Math.max(model.kpis.length, 1)},minmax(0,1fr));gap:16px}
.kpi{border-top:3px solid #006FB9;padding-top:8px}
.kpi .v{font-size:${size(48, 42)}px;line-height:1.05;color:#006FB9;font-variant-numeric:tabular-nums;white-space:nowrap}
.kpi .l{font-size:${d.kpiLabel}px;color:#4A5563;margin-top:4px}
.since{display:flex;flex-wrap:wrap;gap:6px 18px;padding:9px 0;border-top:1px solid #D5DBE3;border-bottom:1px solid #D5DBE3;font-size:14px;color:#2F3A47}
.since b{font-weight:700;color:#16202B}
section{display:flex;flex-direction:column;gap:6px}
h2{margin:0;font-size:${size(26, 23)}px;line-height:1.12;letter-spacing:.02em${oswald ? ";text-transform:uppercase" : ""}}
table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
thead tr{border-bottom:1px solid #9AA5B1}
th{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#4A5563;padding:0 0 6px 16px;text-align:right;white-space:nowrap;width:1%}
th:first-child{text-align:left;padding:0 12px 6px 0;width:auto}
td{padding:${d.row}px 0 ${d.row}px 16px;text-align:right;white-space:nowrap;vertical-align:middle}
td:first-child{padding-left:0;padding-right:12px;text-align:left;white-space:normal}
tbody tr{border-bottom:1px solid #D5DBE3}
tbody tr:last-child{border-bottom:0}
tr.more td{color:#4A5563}
.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
p{margin:0}
ol{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
li{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:14px;align-items:center;padding:${d.hot}px 14px;background:#FDEFEC;border-radius:6px}
.n{width:28px;height:28px;border-radius:50%;background:#C93D2C;color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
.qt{display:flex;flex-direction:column;gap:2px;min-width:0}
.q{font-size:16px;font-weight:500;line-height:1.3}
.where{font-size:12.5px;color:#4A5563;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rate{text-align:right;min-width:104px}
.rate .p{font-size:${size(32, 30)}px;line-height:1;color:#C93D2C}
.rate .o{font-size:12px;color:#4A5563;margin-top:2px;white-space:nowrap}
footer{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:28px;padding-top:10px;border-top:1px solid #D5DBE3;font-size:12px;line-height:1.45;color:#4A5563}
footer .how{max-width:470px}
footer .check{text-align:right;max-width:250px}
footer a{color:#006FB9;font-weight:700;text-decoration:none}
`;
    const header = `
<header>
  <div class="top">
    ${clientLogo
        ? `<img class="client-logo" src="${clientLogo.dataUrl}" alt="${escapeHtml(model.client)}">`
        : `<div class="client-name">${escapeHtml(model.client)}</div>`}
    <div class="by"><span>${escapeHtml(t.prepared)}</span><img src="${assets.workademyLogo}" alt="Workademy"></div>
  </div>
  <div class="titles">
    <div class="label">${escapeHtml(t.label(model.client))}</div>
    <h1 class="disp">${escapeHtml(title)}</h1>
  </div>
  <p class="lead">${escapeHtml(model.headline)}</p>
</header>`;
    const kpis = `
<section class="kpis" aria-label="${escapeHtml(title)}">
  ${model.kpis
        .map((k) => `<div class="kpi"><div class="v disp">${escapeHtml(k.value)}</div><div class="l">${escapeHtml(k.label)}</div></div>`)
        .join("\n  ")}
</section>`;
    // the parts carry <b> from the strings table; their numbers are formatted digits
    const since = model.since
        ? `<div class="since"><span>${escapeHtml(model.since.label)}</span>${model.since.parts.map((p) => `<span>${p}</span>`).join("")}</div>`
        : "";
    const table = rows.length
        ? `
<section>
  <h2 class="disp">${escapeHtml(t.tableTitle(model.monthIndex))}</h2>
  <table>
    <thead><tr><th scope="col">${escapeHtml(t.colCourse)}</th><th scope="col">${escapeHtml(t.colEnrolled)}</th><th scope="col">${escapeHtml(t.colFinished)}</th>${lastHead ? `<th scope="col">${escapeHtml(lastHead)}</th>` : ""}</tr></thead>
    <tbody>
      ${rows
            .map((r) => `<tr><td><div class="clamp">${escapeHtml(r.course)}</div></td><td>${fmt(r.enrolled)}</td><td>${fmt(r.finished)}</td>${lastHead ? `<td>${lastCell(r.last)}</td>` : ""}</tr>`)
            .join("\n      ")}
      ${rest > 0
            ? `<tr class="more"><td>${escapeHtml(t.more(rest, fmt(rest)))}</td><td>${fmt(restEnrolled)}</td><td>${fmt(restFinished)}</td>${lastHead ? "<td>–</td>" : ""}</tr>`
            : ""}
    </tbody>
  </table>
</section>`
        : "";
    const where = hotspots.length
        ? `
<section>
  <h2 class="disp">${escapeHtml(t.whereTitle)}</h2>
  <p>${escapeHtml(t.whereIntro)}${model.hotspotsAllTime ? ` ${escapeHtml(t.whereAllTime)}` : ""}</p>
  <ol>
    ${hotspots
            .map((q, i) => `<li>
      <div class="n" aria-hidden="true">${i + 1}</div>
      <div class="qt"><div class="q clamp">${escapeHtml(q.title)}</div>${q.where ? `<div class="where">${escapeHtml(q.where)}</div>` : ""}</div>
      <div class="rate"><div class="p disp">${formatPercent(q.rate, model.lang)}</div><div class="o">${escapeHtml(t.wrongOf(fmt(q.wrong), fmt(q.total)))}</div></div>
    </li>`)
            .join("\n    ")}
  </ol>
  <p style="margin-top:2px">${escapeHtml(t.whereClosing)}</p>
</section>`
        : "";
    const period = t.period(model.periodFirstDay, model.periodLastDay, model.monthIndex, model.year);
    const footer = `
<footer>
  <p class="how">${escapeHtml(t.how(period, { analytics: model.analytics, toDateFromRecords: model.toDateFromRecords, minAnswers: model.minAnswers }))}</p>
  <p class="check">${escapeHtml(t.check)}<br><a href="https://www.theworkademy.com">theworkademy.com</a></p>
</footer>`;
    return `<!doctype html>
<html lang="${model.lang}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`${model.client} · ${title}`)}</title>
<style>${css}</style>
</head>
<body>
<div id="page">${header}${kpis}${since}${table}${where}${footer}
</div>
</body>
</html>`;
}
// ---------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------
const MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".gif": "image/gif",
};
/** A logo from a URL, a data: URI or a local file (relative to the repo folder), as a data: URI. */
export async function logoDataUri(source) {
    if (source.startsWith("data:"))
        return source;
    if (/^https?:\/\//i.test(source)) {
        const response = await axios.get(source, {
            responseType: "arraybuffer",
            timeout: 10_000,
            maxContentLength: 8 * 1024 * 1024,
        });
        const type = String(response.headers["content-type"] ?? "").split(";")[0].trim() ||
            MIME_BY_EXT[path.extname(new URL(source).pathname).toLowerCase()] ||
            "image/png";
        return `data:${type};base64,${Buffer.from(response.data).toString("base64")}`;
    }
    const file = path.resolve(REPO_ROOT, source.replace(/^~(?=\/)/, os.homedir()));
    const type = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? "image/png";
    return `data:${type};base64,${(await fs.readFile(file)).toString("base64")}`;
}
/** A local Chrome, Chromium or Edge; WORKADEMY_CHROME_PATH wins. */
export function findChrome() {
    const fromEnv = process.env.WORKADEMY_CHROME_PATH;
    if (fromEnv)
        return fromEnv;
    const home = os.homedir();
    const candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];
    for (const candidate of candidates)
        if (existsSync(candidate))
            return candidate;
    // a browser downloaded by Playwright, if any
    const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(home, process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
    try {
        const dirs = readdirSync(browsersDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
        for (const dir of dirs) {
            for (const rel of [
                "chrome-linux/chrome",
                "chrome-linux64/chrome",
                "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
                "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
                "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
                "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            ]) {
                const candidate = path.join(browsersDir, dir, rel);
                if (existsSync(candidate))
                    return candidate;
            }
        }
    }
    catch {
        // no Playwright browsers
    }
    return null;
}
export async function launchBrowser() {
    let chromium;
    try {
        ({ chromium } = await import("playwright-core"));
    }
    catch {
        throw new Error('PDF output needs the "playwright-core" package. Run "npm install" in the workademy-mcp-server folder.');
    }
    const executablePath = findChrome();
    if (!executablePath) {
        throw new Error("PDF output needs Google Chrome (or Chromium/Edge) on this computer. Install Chrome, or set WORKADEMY_CHROME_PATH to the browser's executable.");
    }
    return chromium.launch({ executablePath, headless: true });
}
/**
 * Picks the first logo that shows on a light page (profile logos are sometimes white, for dark
 * headers) and scales it down to a sensible print size.
 */
async function pickLogo(page, candidates) {
    if (!candidates.length)
        return null;
    await page.setContent("<!doctype html><html><body></body></html>");
    return page.evaluate(async (sources) => {
        for (let i = 0; i < sources.length; i++) {
            const img = new Image();
            img.src = sources[i];
            try {
                await img.decode();
            }
            catch {
                continue;
            }
            const w = img.naturalWidth || 400;
            const h = img.naturalHeight || 100;
            const H = 144;
            const W = Math.min(Math.round((w * H) / h), 1400);
            const canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext("2d");
            if (!ctx)
                continue;
            ctx.drawImage(img, 0, 0, W, H);
            const data = ctx.getImageData(0, 0, W, H).data;
            let opaque = 0;
            let visible = 0;
            let minX = W, minY = H, maxX = -1, maxY = -1;
            for (let p = 0, k = 0; p < data.length; p += 4, k++) {
                if (data[p + 3] < 128)
                    continue;
                opaque++;
                const lum = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
                if (lum < 0.9) {
                    visible++;
                    const x = k % W;
                    const y = Math.floor(k / W);
                    if (x < minX)
                        minX = x;
                    if (x > maxX)
                        maxX = x;
                    if (y < minY)
                        minY = y;
                    if (y > maxY)
                        maxY = y;
                }
            }
            // white (or empty) logo: nothing would show on the page
            if (opaque === 0 || visible < opaque * 0.02 || maxX < 0)
                continue;
            // trim empty margins around the mark so heights line up with the Workademy logo
            const tw = maxX - minX + 1;
            const th = maxY - minY + 1;
            const out = document.createElement("canvas");
            out.width = tw;
            out.height = th;
            out.getContext("2d").drawImage(canvas, minX, minY, tw, th, 0, 0, tw, th);
            return { index: i, dataUrl: out.toDataURL("image/png"), aspect: tw / th };
        }
        return null;
    }, candidates);
}
/** Counts /Type /Page objects (not /Pages) in a PDF. */
export function countPdfPages(pdf) {
    return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}
export async function renderPdf(model, options = {}) {
    const browser = options.browser ?? (await launchBrowser());
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
    try {
        const logo = await pickLogo(page, options.logoCandidates ?? []).catch(() => null);
        const assets = await loadPageAssets(logo ? { dataUrl: logo.dataUrl, aspect: logo.aspect } : null);
        let density = 0;
        let html = "";
        let naturalHeight = 0;
        for (; density <= MAX_DENSITY; density++) {
            html = buildHtml(model, assets, density);
            await page.setContent(html, { waitUntil: "load" });
            await page.evaluate(() => document.fonts.ready.then(() => undefined));
            naturalHeight = await page.evaluate(() => {
                const el = document.getElementById("page");
                el.style.height = "auto";
                const height = el.getBoundingClientRect().height;
                el.style.height = "";
                return Math.ceil(height);
            });
            if (naturalHeight <= FIT_LIMIT)
                break;
        }
        density = Math.min(density, MAX_DENSITY);
        await page.emulateMedia({ media: "print" });
        const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } }));
        const pages = countPdfPages(pdf);
        return {
            pdf,
            html,
            pages,
            density,
            naturalHeight,
            fitsOnePage: naturalHeight <= FIT_LIMIT && pages === 1,
            logo: { used: Boolean(logo), index: logo?.index ?? null },
        };
    }
    finally {
        await page.close().catch(() => undefined);
        if (!options.browser)
            await browser.close().catch(() => undefined);
    }
}
/** "SE Ranking" → "SE-Ranking"; Latin letters only so attachments survive every mail client. */
export function pdfFileName(client, month, fallback) {
    const slug = client
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const base = /[A-Za-z]/.test(slug) ? slug : fallback.replace(/[^A-Za-z0-9]+/g, "-");
    return `${base}_Workademy_report_${month}.pdf`;
}
//# sourceMappingURL=report-pdf.js.map