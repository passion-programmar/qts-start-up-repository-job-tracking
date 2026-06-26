// Detect apply template from page URL + DOM structure (runs on page load / navigation).

(function initApplyTemplateDetector() {
  function detectPlatformFromUrl(url) {
    const host = String(url || window.location.href).toLowerCase();
    if (host.includes('justjoin.it')) return 'justjoin';
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('workable.com')) return 'workable';
    return null;
  }

  function isTemplateCandidateUrl(url) {
    const platform = detectPlatformFromUrl(url);
    if (!platform) return false;
    if (platform === 'justjoin') return /justjoin\.it\/job-offer\//i.test(url || '');
    return false;
  }

  function detectApplyTemplateOnPage() {
    const url = window.location.href;
    const platform = detectPlatformFromUrl(url);
    if (!platform) {
      return {
        platform: null,
        templateId: null,
        templateName: null,
        url,
        detectedAt: new Date().toISOString(),
        formOpen: false,
        signals: {},
      };
    }

    const adapterByPlatform = {
      justjoin: () => window.__qtsPlatformJustjoin,
    };
    const adapter = adapterByPlatform[platform]?.();
    const external = adapter?.detectExternalApplyLink?.() || null;
    const template = adapter?.resolveTemplate?.({
      url,
      external,
      mode: 'page_load',
    }) || window.__qtsTemplateRegistry?.resolveTemplate?.(platform, {
      url,
      external,
      mode: 'page_load',
    });

    const signals = typeof template?.hooks?.collectPageSignals === 'function'
      ? template.hooks.collectPageSignals({ url, external })
      : {};

    const scan = window.__scanApplicationForm?.();
    const formOpen = Boolean(
      window.__looksLikeApplicationForm?.(scan)
      || (scan?.fields?.length > 0 && signals.modalOpen)
    );

    return {
      platform,
      templateId: template?.id || null,
      templateName: template?.name || null,
      templateDescription: template?.description || null,
      guestApply: template?.guestApply === true,
      url,
      detectedAt: new Date().toISOString(),
      formOpen,
      externalUrl: external?.url || null,
      signals,
      fieldCount: scan?.fields?.length || 0,
    };
  }

  window.__detectApplyTemplateOnPage = detectApplyTemplateOnPage;
  window.__qtsApplyTemplateDetector = {
    detectPlatformFromUrl,
    isTemplateCandidateUrl,
    detectApplyTemplateOnPage,
  };
})();
