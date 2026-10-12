export function replaceResumePages(document: Document, html: string): void {
  const sourceDocument = new DOMParser().parseFromString(html, 'text/html');
  const sourcePages = sourceDocument.getElementById('resumePages');
  const targetPages = document.getElementById('resumePages');
  if (!sourcePages || !targetPages) {
    throw new Error('Could not update the resume preview content.');
  }

  const pages = Array.from(sourcePages.childNodes, (node) => document.importNode(node, true));
  targetPages.replaceChildren(...pages);
}
