// Static checks for a manuscript that cannot be compiled on this machine. They catch the errors
// that stop pdflatex, and they do not replace a real compile.
//   node paper/tools/lint-tex.mjs
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "..");
const problems = [];
const stripComment = (line) => line.replace(/(^|[^\\])%.*$/, "$1");

function expand(file, seen = new Set()) {
  if (seen.has(file)) return "";
  seen.add(file);
  const full = path.join(dir, file.endsWith(".tex") ? file : `${file}.tex`);
  if (!existsSync(full)) {
    problems.push(`missing input ${file}`);
    return "";
  }
  return readFileSync(full, "utf8").split("\n").map(stripComment).join("\n").replace(/\\input\{([^}]+)\}/g, (_, f) => expand(f, seen));
}
const tex = expand("main.tex");

// Verbatim-like arguments are dropped so that their characters are not misread.
const prose = tex.replace(/\\url\{[^}]*\}/g, "\\url{}").replace(/\\doi\{[^}]*\}/g, "\\doi{}").replace(/\\href\{[^}]*\}/g, "\\href{}");

let depth = 0;
for (let i = 0; i < prose.length; i++) {
  if (prose[i] === "\\") { i++; continue; }
  if (prose[i] === "{") depth++;
  if (prose[i] === "}") { depth--; if (depth < 0) { problems.push(`unbalanced } near: ${prose.slice(Math.max(0, i - 40), i + 10)}`); depth = 0; } }
}
if (depth !== 0) problems.push(`unbalanced braces: depth ${depth}`);

const stack = [];
for (const m of prose.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
  if (m[1] === "begin") stack.push(m[2]);
  else if (stack.pop() !== m[2]) problems.push(`environment mismatch at \\end{${m[2]}}`);
}
if (stack.length > 0) problems.push(`unclosed environments: ${stack}`);

const dollars = (prose.replace(/\\\$/g, "").match(/\$/g) ?? []).length;
if (dollars % 2 !== 0) problems.push("odd number of $");

const noMath = prose.replace(/\$[^$]*\$/g, "");
for (const m of noMath.matchAll(/[^\\]([_#])/g)) {
  const near = noMath.slice(Math.max(0, m.index - 40), m.index + 15);
  if (m[1] === "_" && /\\(label|ref|cite|input|begin|end|newcommand)\{[^}]*$/.test(near)) continue;
  const lineStart = noMath.lastIndexOf("\n", m.index) + 1;
  if (m[1] === "#" && /\\newcommand/.test(noMath.slice(lineStart, m.index))) continue;
  problems.push(`unescaped ${m[1]} near: ${near.replace(/\n/g, " ")}`);
}

// Row width of every tabular against its column specification.
for (const m of prose.matchAll(/\\begin\{tabular\}\{((?:[^{}]|\{[^{}]*\})*)\}([\s\S]*?)\\end\{tabular\}/g)) {
  const columns = (m[1].replace(/\{[^}]*\}/g, "").match(/[lcrpXS]/g) ?? []).length;
  const rows = m[2].replace(/\\(toprule|midrule|bottomrule)(\[[^\]]*\])?/g, "").replace(/\\multicolumn\{(\d+)\}\{[^}]*\}\{[^}]*\}/g, (_, n) => "x" + "&x".repeat(Number(n) - 1)).split("\\\\");
  for (const row of rows) {
    if (row.trim() === "") continue;
    const cells = (row.replace(/\\&/g, "").match(/&/g) ?? []).length + 1;
    if (cells !== columns) problems.push(`row has ${cells} cells, expected ${columns}: ${row.trim().slice(0, 70)}`);
  }
}

const labels = new Set([...prose.matchAll(/\\label\{([^}]+)\}/g)].map((m) => m[1]));
for (const m of prose.matchAll(/\\(?:ref|autoref|eqref)\{([^}]+)\}/g)) if (!labels.has(m[1])) problems.push(`undefined label ${m[1]}`);

const bib = existsSync(path.join(dir, "bibliography.tex")) ? readFileSync(path.join(dir, "bibliography.tex"), "utf8") : "";
const items = new Set([...bib.matchAll(/\\bibitem\{([^}]+)\}/g)].map((m) => m[1]));
const usedKeys = new Set();
for (const m of prose.matchAll(/\\cite\{([^}]+)\}/g)) for (const k of m[1].split(",")) usedKeys.add(k.trim());
for (const k of usedKeys) if (!items.has(k)) problems.push(`citation without bibitem: ${k}`);
for (const k of items) if (!usedKeys.has(k)) problems.push(`bibitem never cited: ${k}`);

const defined = new Set([...prose.matchAll(/\\(?:newcommand|providecommand|renewcommand)\{?\\([A-Za-z]+)\}?/g)].map((m) => m[1]));
const known = new Set("documentclass usepackage title author date begin end maketitle section subsection subsubsection paragraph label ref cite textbf emph texttt textit small footnotesize normalsize large caption centering toprule midrule bottomrule item input url doi hline newcommand href bibliography setlength parskip parindent tableofcontents noindent footnote hspace vspace quad qquad times ldots dots cdot approx leq geq neq rightarrow to mathrm mathit bibitem appendix sloppy hbox raggedright arraybackslash tabularnewline textsc textsuperscript clearpage newpage pagestyle thispagestyle sffamily ttfamily rmfamily bfseries itshape vfill hfill today hypersetup urlstyle DeclareUnicodeCharacter textasciitilde allowbreak nolinkurl linebreak pagebreak smallskip medskip bigskip footnotetext footnotemark ne le ge scriptsize tiny cap in mid addlinespace i node draw tikzset".split(" "));
for (const m of prose.matchAll(/\\([A-Za-z]+)/g)) if (!known.has(m[1]) && !defined.has(m[1])) problems.push(`unknown macro \\${m[1]}`);

// A shell or script that eats a backslash leaves these behind, and they are valid TeX.
if (prose.includes("\t")) problems.push("tab character in the source");
for (const m of prose.matchAll(/(^|[^\\a-zA-Z])(exttt|extbf|extit|mph|cite|ref)\{/g)) problems.push(`command without backslash: ${m[2]}`);

const nonAscii = [...new Set(prose.match(/[^\x00-\x7f]/g) ?? [])];
if (nonAscii.length > 0) problems.push(`non-ASCII characters: ${nonAscii.join(" ")}`);

for (const p of [...new Set(problems)]) console.log(p);
console.log(`${new Set(problems).size} problems`);
process.exitCode = problems.length === 0 ? 0 : 1;
