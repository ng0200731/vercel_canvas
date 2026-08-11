import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';

const data = new Uint8Array(fs.readFileSync('C:/Users/ng/Desktop/source/source/portal-partner-guide.pdf'));
const doc = await pdfjs.getDocument({ data, useSystemCode: true, isEvalSupported: false }).promise;

let out = '';
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  const strings = tc.items.map((it) => (it && typeof it === 'object' && 'str' in it ? it.str : '')).filter(Boolean);
  out += `\n\n========= PAGE ${i} =========\n` + strings.join(' ');
}
process.stdout.write(out);
