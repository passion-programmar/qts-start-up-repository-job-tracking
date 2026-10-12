import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser } from 'puppeteer-core';

const MAX_HTML_LENGTH = 1_500_000;
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

let browserPromise: Promise<Browser> | null = null;

function findLocalBrowser(): string | null {
  const configuredPath = process.env.CHROME_EXECUTABLE_PATH;
  if (configuredPath) {
    if (!fs.existsSync(configuredPath)) {
      throw new Error('CHROME_EXECUTABLE_PATH does not point to an existing browser executable.');
    }
    return configuredPath;
  }

  const candidates = process.platform === 'win32'
    ? [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  const localBrowser = candidates.find((candidate) => fs.existsSync(candidate));
  if (localBrowser) return localBrowser;

  try {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const executable = process.platform === 'win32' ? 'chrome.exe' : 'chromium';
    return execFileSync(command, [executable], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

async function launchBrowser(): Promise<Browser> {
  const isVercel = Boolean(process.env.VERCEL);
  const executablePath = isVercel
    ? await chromium.executablePath()
    : findLocalBrowser();
  if (!executablePath) {
    throw new Error('Could not find Chrome or Chromium. Install a local browser or set CHROME_EXECUTABLE_PATH.');
  }

  const args = isVercel
    ? await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' })
    : ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  return puppeteer.launch({
    args,
    defaultViewport: { width: 816, height: 1056, deviceScaleFactor: 1 },
    executablePath,
    headless: isVercel ? 'shell' : true,
  });
}

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error: unknown) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

function prepareHtml(html: string): string {
  if (
    html.length > MAX_HTML_LENGTH
    || !/<html\b/i.test(html)
    || !/<div\b[^>]*id=["']resumePages["']/i.test(html)
    || !/<(?:div|article)\b[^>]*class=["'][^"']*\bresumePage\b/i.test(html)
    || /<(?:script|iframe|object|embed|form)\b/i.test(html)
    || /\son[a-z]+\s*=/i.test(html)
  ) {
    throw new Error('The rendered resume document is invalid or too large to convert to PDF.');
  }

  const contentSecurityPolicy = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  return html.replace(/<head\b[^>]*>/i, (head) => `${head}${contentSecurityPolicy}`);
}

export async function renderFlowCvHtmlPdfBuffer(html: string): Promise<Buffer> {
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
      void action.catch((error: unknown) => {
        console.warn('Could not handle a request while rendering a FlowCV PDF', error);
      });
    });

    await page.setContent(pageHtml, { waitUntil: 'load', timeout: 20_000 });
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      waitForFonts: true,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
