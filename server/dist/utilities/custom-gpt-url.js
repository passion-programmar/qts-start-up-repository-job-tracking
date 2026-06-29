"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CUSTOM_GPT_ID = exports.DEFAULT_CUSTOM_GPT_URL = void 0;
exports.parseCustomGptId = parseCustomGptId;
exports.normalizeCustomGptUrl = normalizeCustomGptUrl;
exports.validateCustomGptUrl = validateCustomGptUrl;
exports.resolveCustomGptConfig = resolveCustomGptConfig;
exports.DEFAULT_CUSTOM_GPT_URL = 'https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking';
exports.DEFAULT_CUSTOM_GPT_ID = 'g-6a3dc5525fac819198dccf1c216e3fc0';
function parseCustomGptId(url) {
    const match = String(url || '').match(/\/g\/(g-[a-f0-9]+)/i);
    return match ? match[1] : null;
}
function normalizeCustomGptUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
}
function validateCustomGptUrl(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) {
        return { ok: false, message: 'Custom GPT URL is required.' };
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        return { ok: false, message: 'Invalid Custom GPT URL.' };
    }
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'chatgpt.com' && host !== 'chat.openai.com') {
        return { ok: false, message: 'Custom GPT URL must be on chatgpt.com.' };
    }
    if (!parsed.pathname.includes('/g/')) {
        return { ok: false, message: 'URL must point to a Custom GPT (/g/...).' };
    }
    const url = normalizeCustomGptUrl(parsed.toString());
    const id = parseCustomGptId(url);
    if (!id) {
        return { ok: false, message: 'Could not read Custom GPT id from URL.' };
    }
    return { ok: true, url, id };
}
function resolveCustomGptConfig(bidderUrl) {
    const trimmed = String(bidderUrl || '').trim();
    if (trimmed) {
        const validated = validateCustomGptUrl(trimmed);
        if (validated.ok) {
            return { url: validated.url, id: validated.id, source: 'bidder' };
        }
    }
    return {
        url: exports.DEFAULT_CUSTOM_GPT_URL,
        id: exports.DEFAULT_CUSTOM_GPT_ID,
        source: 'default',
    };
}
//# sourceMappingURL=custom-gpt-url.js.map