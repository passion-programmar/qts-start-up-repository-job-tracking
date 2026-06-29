export const DEFAULT_CUSTOM_GPT_URL =
  'https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking';

export const DEFAULT_CUSTOM_GPT_ID = 'g-6a3dc5525fac819198dccf1c216e3fc0';

export interface ResolvedCustomGpt {
  url: string;
  id: string;
  source: 'bidder' | 'default';
}

export function parseCustomGptId(url: string): string | null {
  const match = String(url || '').match(/\/g\/(g-[a-f0-9]+)/i);
  return match ? match[1] : null;
}

export function normalizeCustomGptUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function validateCustomGptUrl(
  raw: string
): { ok: true; url: string; id: string } | { ok: false; message: string } {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { ok: false, message: 'Custom GPT URL is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
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

export function resolveCustomGptConfig(
  bidderUrl?: string | null
): ResolvedCustomGpt {
  const trimmed = String(bidderUrl || '').trim();
  if (trimmed) {
    const validated = validateCustomGptUrl(trimmed);
    if (validated.ok) {
      return { url: validated.url, id: validated.id, source: 'bidder' };
    }
  }

  return {
    url: DEFAULT_CUSTOM_GPT_URL,
    id: DEFAULT_CUSTOM_GPT_ID,
    source: 'default',
  };
}
