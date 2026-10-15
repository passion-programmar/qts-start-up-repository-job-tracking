import assert from 'node:assert/strict';
import { it } from 'node:test';
import { PDFParse } from 'pdf-parse';
import { renderResumePdfBuffer } from './application-document-pdf';

it('renders Markdown bold markers in resume bullets without printing the markers', async () => {
  const pdf = await renderResumePdfBuffer({
    candidate: { fullName: 'Taylor Candidate', email: 'taylor@example.com' },
    targetRole: 'Software Engineer',
    sections: [{
      title: 'Professional Experience',
      items: [{
        heading: 'Software Engineer | Node.js, PostgreSQL',
        bullets: ['Built a service using **Node.js** and PostgreSQL.'],
      }],
    }],
  });
  const parser = new PDFParse({ data: pdf });

  try {
    const result = await parser.getText();
    assert.match(result.text, /Node\.js/);
    assert.doesNotMatch(result.text, /\*\*/);
  } finally {
    await parser.destroy();
  }
});
