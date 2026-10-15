(function initTextHighlighting(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.__qtsTextHighlighting = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

  function normalizeRule(rule) {
    if (!rule || typeof rule !== 'object') {
      throw new TypeError('A highlight rule must be an object.');
    }
    const id = String(rule.id || '').trim();
    const text = String(rule.text || '').trim();
    const textColor = String(rule.textColor || '').trim();
    const backgroundColor = String(rule.backgroundColor || '').trim();
    if (!id) throw new TypeError('A highlight rule needs an ID.');
    if (!text) throw new TypeError('Enter text or characters to highlight.');
    if (!COLOR_PATTERN.test(textColor) || !COLOR_PATTERN.test(backgroundColor)) {
      throw new TypeError('Choose valid text and background colors.');
    }
    return { id, text, textColor, backgroundColor };
  }

  function normalizeRules(rules) {
    if (!Array.isArray(rules)) {
      throw new TypeError('Saved highlight rules must be a list.');
    }
    const normalized = rules.map(normalizeRule);
    const ids = new Set();
    for (const rule of normalized) {
      if (ids.has(rule.id)) throw new TypeError('Saved highlight rules contain a duplicate ID.');
      ids.add(rule.id);
    }
    return normalized;
  }

  function getPageStorageKey(pageUrl) {
    let page;
    try {
      page = new URL(pageUrl);
    } catch {
      throw new TypeError('Open a supported web page before managing text highlights.');
    }
    if (page.protocol !== 'http:' && page.protocol !== 'https:') {
      throw new TypeError('Text highlights are available on HTTP and HTTPS pages only.');
    }
    page.hash = '';
    return `qtsPageTextHighlights:${encodeURIComponent(page.href)}`;
  }

  return { normalizeRule, normalizeRules, getPageStorageKey };
});
