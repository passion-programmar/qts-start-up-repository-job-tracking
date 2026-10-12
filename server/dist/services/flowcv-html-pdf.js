"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderFlowCvHtmlPdfBuffer = renderFlowCvHtmlPdfBuffer;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const chromium_1 = __importDefault(require("@sparticuz/chromium"));
const puppeteer_core_1 = __importDefault(require("puppeteer-core"));
const MAX_HTML_LENGTH = 1500000;
const CSP = [
    "default-src 'none'",
    "font-src data:",
    "img-src data:",
    "style-src 'unsafe-inline' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-src 'none'",
].join('; ');
let browserPromise = null;
function findLocalBrowser() {
    const configuredPath = process.env.CHROME_EXECUTABLE_PATH;
    if (configuredPath) {
        if (!node_fs_1.default.existsSync(configuredPath)) {
            throw new Error('CHROME_EXECUTABLE_PATH does not point to an existing browser executable.');
        }
        return configuredPath;
    }
    const candidates = process.platform === 'win32'
        ? [
            node_path_1.default.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            node_path_1.default.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            node_path_1.default.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
        : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    const localBrowser = candidates.find((candidate) => node_fs_1.default.existsSync(candidate));
    if (localBrowser)
        return localBrowser;
    try {
        const command = process.platform === 'win32' ? 'where.exe' : 'which';
        const executable = process.platform === 'win32' ? 'chrome.exe' : 'chromium';
        return (0, node_child_process_1.execFileSync)(command, [executable], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
            .split(/\r?\n/)[0] || null;
    }
    catch {
        return null;
    }
}
async function launchBrowser() {
    const isVercel = Boolean(process.env.VERCEL);
    const executablePath = isVercel
        ? await chromium_1.default.executablePath()
        : findLocalBrowser();
    if (!executablePath) {
        throw new Error('Could not find Chrome or Chromium. Install a local browser or set CHROME_EXECUTABLE_PATH.');
    }
    const args = isVercel
        ? await puppeteer_core_1.default.defaultArgs({ args: chromium_1.default.args, headless: 'shell' })
        : ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
    return puppeteer_core_1.default.launch({
        args,
        defaultViewport: { width: 816, height: 1056, deviceScaleFactor: 1 },
        executablePath,
        headless: isVercel ? 'shell' : true,
    });
}
function getBrowser() {
    if (!browserPromise) {
        browserPromise = launchBrowser().catch((error) => {
            browserPromise = null;
            throw error;
        });
    }
    return browserPromise;
}
function prepareHtml(html) {
    if (html.length > MAX_HTML_LENGTH
        || !/<html\b/i.test(html)
        || !/<div\b[^>]*id=["']resumePages["']/i.test(html)
        || !/<(?:div|article)\b[^>]*class=["'][^"']*\bresumePage\b/i.test(html)
        || /<(?:script|iframe|object|embed|form)\b/i.test(html)
        || /\son[a-z]+\s*=/i.test(html)) {
        throw new Error('The rendered resume document is invalid or too large to convert to PDF.');
    }
    const contentSecurityPolicy = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}${contentSecurityPolicy}`);
}
async function renderFlowCvHtmlPdfBuffer(html) {
    const pageHtml = prepareHtml(html);
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const requestUrl = request.url();
            const action = requestUrl === 'about:blank' || requestUrl.startsWith('data:')
                ? request.continue()
                : request.abort('blockedbyclient');
            void action.catch((error) => {
                console.warn('Could not handle a request while rendering a FlowCV PDF', error);
            });
        });
        await page.setContent(pageHtml, { waitUntil: 'load', timeout: 20000 });
        await page.emulateMediaType('print');
        const pdf = await page.pdf({
            preferCSSPageSize: true,
            printBackground: true,
            waitForFonts: true,
        });
        return Buffer.from(pdf);
    }
    finally {
        await page.close();
    }
}
//# sourceMappingURL=flowcv-html-pdf.js.map