(function initScannerChatGpt(global) {
  if (global.__qtsScannerChatGpt) return;

  function buildPrompt(context) {
    const payload = {
      jobContext: context.jobContext || {},
      candidate: context.candidate || {},
      managerAnswers: context.managerAnswers || {},
      resumeText: context.resumeText || '',
      previousAnswers: context.previousAnswers || [],
      previousUnresolvedFields: context.previousUnresolvedFields || [],
      page: context.page || {},
    };
    return [
      'Help complete only the current application page using the supplied QTS data.',
      'Return exactly one valid JSON object and no markdown, code fence, or commentary.',
      'Use only facts in candidate, managerAnswers, resumeText, and previousAnswers. Never invent or infer personal facts.',
      'For accountSpecific fields, use only candidate facts and candidate.customAnswers. Do not use managerAnswers.',
      'For jobSpecific fields, create fresh job-tailored wording grounded in the supplied job and profile.',
      'Answer only fields listed in page.fields. Use each stableFieldId exactly once and do not create field IDs.',
      'Do not answer consent, legal certification, equal-opportunity, or security verification fields. Put them in unresolvedFields.',
      'If an answer is not clearly supported by the supplied facts, omit it from answers and include it in unresolvedFields with a short reason.',
      'Include resume only when the current page requests a resume documentSlot and the supplied candidate has a fullName and email. Include coverLetter only when it requests a cover_letter documentSlot and the supplied candidate has a fullName and email.',
      'The JSON shape is {"answers":[{"stableFieldId":"...","answer":"..."}],"unresolvedFields":[{"stableFieldId":"...","question":"...","reason":"..."}],"notes":""}.',
      'Omit unused resume or coverLetter keys. Resume JSON must use candidate {fullName,email,phone?,linkedinUrl?,location?,headline?}, targetRole, optional targetCompany/targetJobsite/summary, and non-empty sections [{title,items:[{heading?,subheading?,dateRange?,bullets:string[]}]}].',
      'Cover letter JSON must use candidate {fullName,email,phone?,linkedinUrl?}, targetRole, targetCompany, and bodyParagraphs with 1 to 6 strings, each no longer than 900 characters. Include only verifiable profile facts.',
      'Return valid JSON strings and arrays only. Escape quotes and newlines according to JSON.',
      'QTS task context follows:',
      JSON.stringify(payload),
    ].join('\n\n');
  }

  function extractPackage(responseText) {
    const text = String(responseText || '').trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [fenced?.[1], text].filter(Boolean);
    for (const candidate of candidates) {
      const start = candidate.indexOf('{');
      if (start < 0) continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < candidate.length; index += 1) {
        const character = candidate[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') inString = true;
        else if (character === '{') depth += 1;
        else if (character === '}') {
          depth -= 1;
          if (depth === 0) {
            const parsed = JSON.parse(candidate.slice(start, index + 1));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.answers)) {
              throw new Error('ChatGPT response JSON must contain an answers array.');
            }
            return parsed;
          }
        }
      }
    }
    throw new Error('ChatGPT finished without returning a valid JSON answer package.');
  }

  const api = { buildPrompt, extractPackage };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.__qtsScannerChatGpt = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
