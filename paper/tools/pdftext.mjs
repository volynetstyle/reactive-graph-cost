// Extracts plain text from the fetched PDFs, so that claims about them can be checked by search.
//   node paper/tools/pdftext.mjs  (needs pdfjs-dist under .cache/paper/pdftext)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const base = path.resolve(import.meta.dirname, "../../.cache/paper");
const require = createRequire(path.join(base, "pdftext/x.js"));
const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);

for (const name of readdirSync(path.join(base, "pdf")).filter((f) => f.endsWith(".pdf"))) {
  const data = new Uint8Array(readFileSync(path.join(base, "pdf", name)));
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = await page.getTextContent();
    pages.push(`\n=== page ${i} ===\n${text.items.map((t) => t.str + (t.hasEOL ? "\n" : " ")).join("")}`);
  }
  writeFileSync(path.join(base, "pdf", name.replace(/\.pdf$/, ".txt")), pages.join("\n"));
  console.log(`${name}: ${doc.numPages} pages`);
}
