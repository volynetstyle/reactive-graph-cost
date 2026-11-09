// Renders paper/main.tex to paper/build/main.pdf through the browser installed on this machine,
// for reading. It handles only the LaTeX this manuscript uses, and an unknown construct stops it.
// The layout is not pdflatex's: arXiv compiles the TeX source itself.
//   node paper/tools/render-pdf.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const paper = path.join(root, "paper");
const read = (f) => readFileSync(path.join(paper, f), "utf8").replace(/\r\n/g, "\n");
const stripComments = (s) => s.split("\n").map((l) => l.replace(/(^|[^\\])%.*$/, "$1")).join("\n");

const macros = new Map([...read("numbers.tex").matchAll(/^\\newcommand\{\\([A-Za-z]+)\}\{(.*)\}$/gm)].map((m) => [m[1], m[2]]));
const include = (file) => stripComments(read(file.endsWith(".tex") ? file : `${file}.tex`)).replace(/\\input\{([^}]+)\}/g, (_, f) => (f === "numbers" ? "" : include(f)));
const full = include("main.tex").replace(/\\([A-Za-z]+)\{\}/g, (m, k) => macros.get(k) ?? m);

function group(s, at) {
  if (s[at] !== "{") throw new Error(`expected a group at: ${s.slice(at, at + 40)}`);
  let depth = 0;
  for (let j = at; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === "{") depth++;
    if (s[j] === "}" && --depth === 0) return [s.slice(at + 1, j), j + 1];
  }
  throw new Error(`unbalanced group at: ${s.slice(at, at + 40)}`);
}
const preambleArg = (name) => group(full, full.indexOf(`\\${name}{`) + name.length + 1)[0];
const body = full.slice(full.indexOf("\\begin{document}") + "\\begin{document}".length, full.indexOf("\\end{document}"));

// ---- numbering ----------------------------------------------------------------------------------
function numberer() {
  let sec = 0, sub = 0, table = 0, figure = 0, appendix = false;
  return {
    section() { sec++; sub = 0; return appendix ? String.fromCharCode(64 + sec) : String(sec); },
    subsection() { sub++; return `${appendix ? String.fromCharCode(64 + sec) : sec}.${sub}`; },
    appendix() { appendix = true; sec = 0; sub = 0; },
    table() { return ++table; },
    figure() { return ++figure; },
  };
}
const labels = new Map();
{
  const n = numberer();
  let current = "", inFigure = false;
  for (const m of body.matchAll(/\\(section\*|section|subsection|appendix|caption|label)(?![A-Za-z])|\\begin\{figure\}/g)) {
    if (m[0] === "\\begin{figure}") { inFigure = true; continue; }
    if (m[1] === "section") current = n.section();
    else if (m[1] === "subsection") current = n.subsection();
    else if (m[1] === "appendix") n.appendix();
    else if (m[1] === "caption") { if (inFigure) { current = n.figure(); inFigure = false; } else current = n.table(); }
    else if (m[1] === "label") labels.set(group(body, m.index + m[0].length)[0], current);
  }
}
const references = new Map([...body.matchAll(/\\bibitem\{([^}]+)\}/g)].map((m, i) => [m[1], i + 1]));

// ---- inline text ---------------------------------------------------------------------------------
const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const ACCENTS = { "'": "\u0301", "`": "\u0300", '"': "\u0308", "~": "\u0303", "^": "\u0302", c: "\u0327" };
const accent = (mark, s) => `${s === "\\i" ? "i" : inline(s)}${ACCENTS[mark]}`.normalize("NFC");

function math(s) {
  return s.replace(/\\mathit\{([^}]*)\}|\\cap|[A-Za-z]|[<>&]/g, (t, word) => {
    if (word !== undefined) return `<i>${word}</i>`;
    if (t === "\\cap") return "\u2229";
    return /[A-Za-z]/.test(t) ? `<i>${t}</i>` : escape(t);
  });
}

function inline(s) {
  let o = "";
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "\\") {
      const word = /^[A-Za-z]+/.exec(s.slice(i + 1))?.[0];
      if (word === undefined) {
        const n = s[i + 1];
        i += 2;
        if (n === "\\") o += "<br>";
        else if ("%&_#$".includes(n)) o += escape(n);
        else if (n === ",") o += "\u2009";
        else if (n === " " || n === "\n") o += " ";
        else if (n in ACCENTS) { const [a, e] = group(s, i); o += accent(n, a); i = e; }
        else throw new Error(`unknown control symbol \\${n} near ${s.slice(i - 2, i + 30)}`);
        continue;
      }
      i += 1 + word.length;
      const take = () => { const [a, e] = group(s, i); i = e; return a; };
      if (word === "emph" || word === "textit") o += `<em>${inline(take())}</em>`;
      else if (word === "textbf") o += `<strong>${inline(take())}</strong>`;
      else if (word === "texttt") o += `<code>${inline(take())}</code>`;
      else if (word === "url" || word === "nolinkurl") { const u = take(); o += `<a class="u" href="${u}">${escape(u)}</a>`; }
      else if (word === "doi") { const u = take(); o += `<a class="u" href="https://doi.org/${u}">doi:${escape(u)}</a>`; }
      else if (word === "cite") o += `[${take().split(",").map((k) => { const n = references.get(k.trim()); if (n === undefined) throw new Error(`no reference ${k}`); return `<a href="#ref-${n}">${n}</a>`; }).join(", ")}]`;
      else if (word === "ref") { const k = take(); if (!labels.has(k)) throw new Error(`no label ${k}`); o += labels.get(k); }
      else if (word === "label") take();
      else if (word === "c") o += accent("c", take());
      else throw new Error(`unknown command \\${word} near ${s.slice(i - 20, i + 30)}`);
      continue;
    }
    if (c === "$") { const e = s.indexOf("$", i + 1); o += math(s.slice(i + 1, e)); i = e + 1; continue; }
    if (c === "{") { const [a, e] = group(s, i); o += inline(a); i = e; continue; }
    if (s.startsWith("``", i)) { o += "\u201c"; i += 2; continue; }
    if (s.startsWith("''", i)) { o += "\u201d"; i += 2; continue; }
    if (s.startsWith("---", i)) { o += "\u2014"; i += 3; continue; }
    if (s.startsWith("--", i)) { o += "\u2013"; i += 2; continue; }
    if (c === "`") o += "\u2018";
    else if (c === "'") o += "\u2019";
    else if (c === "~") o += "\u00a0";
    else if (c === "\n") o += " ";
    else o += escape(c);
    i++;
  }
  return o;
}

// ---- tables --------------------------------------------------------------------------------------
function splitCells(row) {
  const cells = [];
  let depth = 0, cur = "";
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "\\") { cur += row[i] + (row[i + 1] ?? ""); i++; continue; }
    if (row[i] === "{") depth++;
    if (row[i] === "}") depth--;
    if (row[i] === "&" && depth === 0) { cells.push(cur); cur = ""; continue; }
    cur += row[i];
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function tabular(s) {
  const open = "\\begin{tabular}";
  const at = s.indexOf(open);
  const [spec, afterSpec] = group(s, at + open.length);
  const columns = [...spec.matchAll(/p\{([^}]+)\}|[lrc]/g)].map((m) => (m[1] ? { align: "l", width: m[1] } : { align: m[0] }));
  const rows = [];
  let rule = false, space = false, headerDone = false;
  for (let chunk of s.slice(afterSpec, s.indexOf("\\end{tabular}")).split("\\\\")) {
    for (;;) {
      chunk = chunk.trimStart();
      const m = /^\\(toprule|midrule|bottomrule|addlinespace)(?![A-Za-z])/.exec(chunk);
      if (m === null) break;
      chunk = chunk.slice(m[0].length);
      if (m[1] === "addlinespace") space = true;
      if (m[1] === "midrule") { if (rows.length === 1 && !headerDone) headerDone = true; else rule = true; }
    }
    if (chunk.trim() === "") continue;
    const cells = splitCells(chunk);
    if (cells.length !== columns.length) throw new Error(`row has ${cells.length} cells, expected ${columns.length}: ${chunk.slice(0, 60)}`);
    rows.push({ cells, rule, space });
    rule = false;
    space = false;
  }
  const cell = (tag, text, c) => `<${tag} class="${c.align}"${c.width ? ` style="width:${c.width}"` : ""}>${inline(text)}</${tag}>`;
  const head = `<thead><tr>${rows[0].cells.map((t, i) => cell("th", t, columns[i])).join("")}</tr></thead>`;
  const lines = rows.slice(1).map((r) => `<tr class="${r.rule ? "rule" : ""}${r.space ? " gap" : ""}">${r.cells.map((t, i) => cell("td", t, columns[i])).join("")}</tr>`);
  return { html: `<table class="t">${head}<tbody>${lines.join("\n")}</tbody></table>`, rows: rows.length };
}

// ---- blocks --------------------------------------------------------------------------------------
const items = (s) => s.split(/\\item(?![A-Za-z])/).slice(1).map((t) => t.trim());

function blocks(s) {
  const n = numberer();
  let html = "", runIn = "", text = "";
  const flush = () => {
    for (const p of text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) { html += `<p>${runIn}${inline(p)}</p>\n`; runIn = ""; }
    text = "";
  };
  const endRunIn = () => { if (runIn !== "") { html += `<p class="lead">${runIn}</p>\n`; runIn = ""; } };
  const token = /\\(section\*|section|subsection|paragraph|appendix|maketitle|label|begin)(?![A-Za-z])/g;
  let at = 0;
  for (let m = token.exec(s); m !== null; m = token.exec(s)) {
    text += s.slice(at, m.index);
    flush();
    let next = m.index + m[0].length;
    const kind = m[1];
    if (kind === "maketitle") {
      html += `<header><h1>${inline(preambleArg("title"))}</h1><div class="author">${inline(preambleArg("author"))}</div><div class="date">${inline(preambleArg("date"))}</div></header>\n`;
    } else if (kind === "appendix") {
      n.appendix();
    } else if (kind === "label") {
      next = group(s, next)[1];
    } else if (kind === "paragraph") {
      endRunIn();
      const [title, e] = group(s, next);
      runIn = `<strong>${inline(title)}</strong> `;
      next = e;
    } else if (kind === "section" || kind === "section*" || kind === "subsection") {
      endRunIn();
      const [title, e] = group(s, next);
      const number = kind === "section" ? `${n.section()}\u2003` : kind === "subsection" ? `${n.subsection()}\u2003` : "";
      html += `<${kind === "subsection" ? "h3" : "h2"}>${number}${inline(title)}</${kind === "subsection" ? "h3" : "h2"}>\n`;
      next = e;
    } else {
      endRunIn();
      const [env, afterName] = group(s, next);
      const close = `\\end{${env}}`;
      const end = s.indexOf(close, afterName);
      if (end < 0) throw new Error(`no ${close}`);
      const inner = s.slice(afterName, end);
      next = end + close.length;
      if (env === "abstract") {
        html += `<section class="abstract"><h2>Abstract</h2><p>${inline(inner.trim())}</p></section>\n`;
      } else if (env === "description") {
        for (const it of items(inner)) {
          const label = /^\[([^\]]*)\]/.exec(it);
          html += `<p class="item"><strong>${inline(label[1])}</strong> ${inline(it.slice(label[0].length).trim())}</p>\n`;
        }
      } else if (env === "itemize") {
        html += `<ul>${items(inner).map((it) => `<li>${inline(it)}</li>`).join("\n")}</ul>\n`;
      } else if (env === "table") {
        const size = /\\scriptsize/.test(inner) ? "script" : "foot";
        const t = tabular(inner);
        const capAt = inner.indexOf("\\caption");
        const [caption] = group(inner, capAt + "\\caption".length);
        html += `<figure class="float ${size}${t.rows > 40 ? " long" : ""}">${t.html}<figcaption><strong>Table ${n.table()}:</strong> ${inline(caption)}</figcaption></figure>\n`;
      } else if (env === "figure") {
        const levels = [...inner.matchAll(/\\figlevel\{\d\}/g)].map((m) => { const [q, e] = group(inner, m.index + m[0].length); const [a] = group(inner, e); return `<div class="lv"><div class="q">${inline(q)}</div><div class="a">${inline(a)}</div></div>`; });
        const [caption] = group(inner, inner.indexOf("\\caption") + "\\caption".length);
        html += `<figure class="float levels">${levels.join('<div class="arrow">\u2193</div>')}<figcaption><strong>Figure ${n.figure()}:</strong> ${inline(caption)}</figcaption></figure>\n`;
      } else if (env === "thebibliography") {
        const parts = inner.replace(/^\{\d+\}/, "").split(/\\bibitem\{[^}]+\}/).slice(1);
        html += `<h2>References</h2>\n${parts.map((p, i) => `<div class="ref" id="ref-${i + 1}"><span class="n">[${i + 1}]</span><span>${inline(p.trim())}</span></div>`).join("\n")}\n`;
      } else {
        throw new Error(`unknown environment ${env}`);
      }
    }
    at = next;
    token.lastIndex = next;
  }
  text += s.slice(at);
  flush();
  endRunIn();
  return html;
}

const CSS = `
@page { size: letter; margin: 1in 1in 0.95in; @bottom-center { content: counter(page); font-family: "Times New Roman", serif; font-size: 10pt; } }
html { font-family: "Times New Roman", Times, serif; font-size: 11pt; line-height: 1.27; }
body { margin: 0; }
header { text-align: center; margin: 0.25in 0 0.28in; }
h1 { font-size: 17.5pt; font-weight: normal; line-height: 1.25; margin: 0 0 15pt; }
.author, .date { font-size: 12pt; margin-bottom: 5pt; }
.abstract { margin: 0 0.42in 16pt; font-size: 10pt; }
.abstract h2 { text-align: center; font-size: 10pt; margin: 0 0 4pt; }
h2 { font-size: 14pt; margin: 17pt 0 7pt; break-after: avoid; }
h3 { font-size: 12pt; margin: 13pt 0 5pt; break-after: avoid; }
p { margin: 0 0 7pt; text-align: justify; hyphens: auto; orphans: 2; widows: 2; }
p.lead { margin-bottom: 3pt; break-after: avoid; }
p.item { margin-left: 18pt; }
ul { margin: 0 0 8pt; padding-left: 20pt; }
li { margin-bottom: 4pt; text-align: justify; hyphens: auto; }
code { font-family: Consolas, "Courier New", monospace; font-size: 0.9em; }
a { color: inherit; text-decoration: none; }
a.u { font-family: Consolas, "Courier New", monospace; font-size: 0.86em; overflow-wrap: anywhere; }
.float { margin: 12pt 0 13pt; break-inside: avoid; }
.float.long { break-inside: auto; }
.lv { display: flex; gap: 10pt; font-size: 9.4pt; align-items: stretch; }
.lv .q { width: 112pt; border: 0.7pt solid #000; padding: 5pt; text-align: center; font-weight: bold; display: flex; align-items: center; justify-content: center; }
.lv .a { flex: 1; padding: 3pt 0; text-align: left; align-self: center; }
.arrow { width: 124pt; text-align: center; line-height: 1; }
.float.foot table { font-size: 9pt; }
.float.script table { font-size: 7.9pt; }
table.t { border-collapse: collapse; margin: 0 auto; border-top: 1.1pt solid #000; border-bottom: 1.1pt solid #000; line-height: 1.2; }
table.t th { font-weight: normal; border-bottom: 0.6pt solid #000; }
table.t th, table.t td { padding: 1.6pt 4.5pt; vertical-align: top; }
.l { text-align: left; } .r { text-align: right; white-space: nowrap; } .c { text-align: center; }
tr.rule td { border-top: 0.6pt solid #000; }
tr.gap td { padding-top: 4pt; }
tr { break-inside: avoid; }
figcaption { font-size: 9.6pt; margin: 6pt 0 0; text-align: justify; hyphens: auto; }
.ref { display: flex; gap: 6pt; margin-bottom: 4.5pt; font-size: 9.8pt; text-align: left; break-inside: avoid; }
.ref .n { min-width: 24pt; }
`;

const title = preambleArg("title").replace(/\\\\\s*/g, " ");
const htmlDoc = `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${inline(title)}</title><style>${CSS}</style></head><body>\n${blocks(body)}</body></html>\n`;

const work = path.join(root, ".cache/paper/render");
mkdirSync(work, { recursive: true });
mkdirSync(path.join(paper, "build"), { recursive: true });
const htmlFile = path.join(work, "main.html");
writeFileSync(htmlFile, htmlDoc);

const browsers = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const browser = browsers.find(existsSync);
if (browser === undefined) throw new Error("no installed browser found");
const pdf = path.join(paper, "build/main.pdf");
const r = spawnSync(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "render-"))}`, "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, pathToFileURL(htmlFile).href], { encoding: "utf8", timeout: 120000 });
if (r.status !== 0 || !existsSync(pdf)) throw new Error(`browser failed: ${r.status} ${r.stderr}`);
console.log(`wrote ${path.relative(root, pdf)} (${readFileSync(pdf).length} bytes) using ${path.basename(browser)}`);
