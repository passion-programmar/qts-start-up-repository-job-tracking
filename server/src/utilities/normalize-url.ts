const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'trk', 'trackingId', 'trackingid', 'ref', 'refId', 'refid',
  'source', 'campaign', 'fbclid', 'gclid', 'msclkid',
  'mc_eid', 'mc_cid', '_ga', 'yclid',
]);

export function normalizeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim().toLowerCase();
  }

  // Lowercase hostname
  url.hostname = url.hostname.toLowerCase();

  // Force https when possible? No — preserve original protocol
  // Remove fragment
  url.hash = '';

  // Remove tracking params
  const params = new URLSearchParams();
  const seen = new Set<string>();
  url.searchParams.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!TRACKING_PARAMS.has(lower) && !TRACKING_PARAMS.has(key) && !seen.has(lower)) {
      params.set(key, value);
      seen.add(lower);
    }
  });
  url.search = params.toString() ? `?${params.toString()}` : '';

  // Remove trailing slash from path (but preserve root /)
  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  url.pathname = path;

  return url.toString();
}
