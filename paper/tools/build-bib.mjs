// Writes paper/bibliography.tex from Crossref's records and a short list of non-DOI sources.
// Only keys cited in main.tex are emitted, and a key with no registry record stops the build.
// A thebibliography file needs no BibTeX run, so arXiv compiles it with pdflatex alone.
//   node paper/tools/fetch-sources.mjs && node paper/tools/build-bib.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const crossref = JSON.parse(readFileSync(path.join(root, ".cache/paper/crossref.json"), "utf8"));
const tex = readFileSync(path.join(root, "paper/main.tex"), "utf8");

// Corrections of registry formatting only. Each was checked against the publisher's page.
const overrides = {
  mokhov2020: { authors: [["Andrey", "Mokhov"], ["Neil", "Mitchell"], ["Simon", "Peyton Jones"]], title: "Build systems \\`{a} la carte: Theory and practice", venue: "Journal of Functional Programming" },
  mokhov2018: { title: "Build systems \\`{a} la carte", venue: "Proceedings of the ACM on Programming Languages" },
  bainomugisha2013: { authors: [["Engineer", "Bainomugisha"], ["Andoni Lombide", "Carreton"], ["Tom", "Van Cutsem"], ["Stijn", "Mostinckx"], ["Wolfgang", "De Meuter"]] },
  blackburn2006: { title: "The DaCapo benchmarks: Java benchmarking development and analysis" },
  georges2007: { title: "Statistically rigorous Java performance evaluation" },
  balzer2007: { year: 2007 },
  chilimbi1999: { year: 1999 },
};

const manual = {
  ailamaki2001: { authors: "Anastassia Ailamaki, David J. DeWitt, Mark D. Hill, and Marios Skounakis", title: "Weaving relations for cache performance", where: "In \\emph{Proceedings of the 27th International Conference on Very Large Data Bases (VLDB)}, pages 169--180, 2001", year: 2001 },
  grinten2022: { authors: "Alexander van der Grinten, Maria Predari, and Florian Willich", title: "A fast data structure for dynamic graphs based on hash-indexed adjacency blocks", where: "In \\emph{20th International Symposium on Experimental Algorithms (SEA)}, 2022. \\doi{10.4230/LIPIcs.SEA.2022.11}", year: 2022 },
  jangda2019: { authors: "Abhinav Jangda, Bobby Powers, Emery D. Berger, and Arjun Guha", title: "Not so fast: Analyzing the performance of WebAssembly vs.\\ native code", where: "In \\emph{2019 USENIX Annual Technical Conference (USENIX ATC)}, pages 107--120, 2019", year: 2019 },
  mcsherry2013d: { authors: "Frank McSherry, Derek G. Murray, Rebecca Isaacs, and Michael Isard", title: "Differential dataflow", where: "In \\emph{6th Biennial Conference on Innovative Data Systems Research (CIDR)}, 2013", year: 2013 },
  mckeeman1998: { authors: "William M. McKeeman", title: "Differential testing for software", where: "\\emph{Digital Technical Journal}, 10(1):100--107, 1998", year: 1998 },
  tc39signals: { authors: "Rob Eisenberg and Daniel Ehrenberg", title: "JavaScript Signals standard proposal", where: "TC39 Stage 1 proposal, \\url{https://github.com/tc39/proposal-signals}, commit \\texttt{9124ed9}, 2025", year: 2025, sort: "tc39" },
  tc39issue259: { authors: "TC39 Signals proposal contributors", title: "Focusing only on signals interoperability", where: "Issue 259, \\url{https://github.com/tc39/proposal-signals/issues/259}, 2025", year: 2025, sort: "tc39 issue 259" },
  tc39issue258: { authors: "TC39 Signals proposal contributors", title: "The signal graph protocol should be exposed for novel implementations", where: "Issue 258, \\url{https://github.com/tc39/proposal-signals/issues/258}, 2025", year: 2025, sort: "tc39 issue 258" },
  signalpolyfill: { authors: "Signal polyfill contributors", title: "signal-polyfill 0.2.2", where: "\\url{https://github.com/proposal-signals/signal-polyfill}, commit \\texttt{fba09f8}", year: 2025, sort: "signal polyfill" },
  aliensignals: { authors: "alien-signals contributors", title: "alien-signals 3.2.1", where: "\\url{https://github.com/stackblitz/alien-signals}, commit \\texttt{8734d38}", year: 2026, sort: "alien signals" },
  quant: { authors: "Andrii Volynets", title: "Reflex Quant", where: "\\url{https://github.com/volynetstyle/reflex-quant}, commit \\texttt{241a3b7}, 2026", year: 2026 },
  salsa: { authors: "Salsa contributors", title: "Salsa 0.28.5", where: "\\url{https://github.com/salsa-rs/salsa}, commit \\texttt{6d59529}, 2026", year: 2026, sort: "salsa" },
  wpf: { authors: "WPF contributors", title: "Windows Presentation Foundation", where: "\\url{https://github.com/dotnet/wpf}, commit \\texttt{49ae5cd}, 2026", year: 2026, sort: "wpf" },
  ecma262: { authors: "Ecma International", title: "ECMAScript 2025 language specification (ECMA-262, 16th edition)", where: "\\url{https://262.ecma-international.org/16.0/}, 2025", year: 2025 },
  promisesaplus: { authors: "Promises/A+ organization", title: "Promises/A+", where: "\\url{https://promisesaplus.com/}", year: 2014, sort: "promises" },
  reactivestreams: { authors: "Reactive Streams initiative", title: "Reactive Streams specification for the JVM", where: "\\url{https://github.com/reactive-streams/reactive-streams-jvm}", year: 2017, sort: "reactive streams" },
  vue10397: { authors: "Evan You", title: "Refactor reactivity system to use version counting and doubly-linked list tracking", where: "Vue.js pull request 10397, \\url{https://github.com/vuejs/core/pull/10397}, 2024", year: 2024, sort: "you" },
  vue16176: { authors: "Vue.js contributors", title: "Removed reactive links keep younger effects alive across scavenges", where: "Vue.js issue 16176, \\url{https://github.com/vuejs/core/issues/16176}, 2026", year: 2026, sort: "vue" },
  preactsignals: { authors: "Preact contributors", title: "Preact Signals", where: "\\url{https://github.com/preactjs/signals}", year: 2022, sort: "preact" },
};

const cited = new Set();
for (const m of tex.matchAll(/\\cite\{([^}]+)\}/g)) for (const k of m[1].split(",")) cited.add(k.trim());

const esc = (s) => s.replaceAll("&amp;", "&").replace(/([&%#_])/g, "\\$1");
const joinAuthors = (a) => {
  const names = a.map(([g, f]) => `${g} ${f}`.trim());
  if (names.length <= 1) return names.join("");
  if (names.length > 6) return `${names.slice(0, 5).join(", ")}, et al.`;
  return names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
};

// Crossref keeps a subtitle apart from the title, and names the LNCS series before the volume.
const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);
const fullTitle = (c) => (c.subtitle ? `${c.title}: ${c.subtitle[0].toUpperCase()}${c.subtitle.slice(1)}` : c.title);
const venueOf = (c) => (/^Lecture Notes/.test(c.containers?.[0] ?? "") && c.containers[1] ? c.containers[1] : c.venue || c.event);

const entries = [];
for (const key of cited) {
  if (key in manual) {
    const m = manual[key];
    entries.push({ key, sort: (m.sort ?? m.authors.split(",")[0].split(" ").at(-1)).toLowerCase() + m.year, text: `${sentence(m.authors)} ${sentence(m.title)} ${m.where}.` });
    continue;
  }
  const c = crossref[key];
  if (c === undefined || c.error !== undefined) throw new Error(`no registry record for ${key}`);
  const o = { ...c, ...overrides[key] };
  const year = o.year ?? o.issued;
  if (year === null || year === undefined) throw new Error(`no year for ${key}`);
  const venue = esc(venueOf(overrides[key]?.venue ? { venue: overrides[key].venue } : o));
  const loc = [o.volume ? `${o.volume}` : "", o.issue ? `(${o.issue})` : ""].join("");
  const pages = o.page ? (loc ? `:${o.page.replace("-", "--")}` : `, pages ${o.page.replace("-", "--")}`) : "";
  const title = overrides[key]?.title ?? esc(fullTitle(o));
  const prefix = /^10\.(1145|1007)/.test(o.doi) && o.type !== "journal-article" ? "In " : "";
  entries.push({ key, sort: o.authors[0][1].toLowerCase() + year, text: `${sentence(joinAuthors(o.authors))} ${sentence(title)} ${prefix}\\emph{${venue}}${loc ? `, ${loc}` : ""}${pages}, ${year}. \\doi{${esc(o.doi).replaceAll("\\_", "_")}}.` });
}
entries.sort((a, b) => (a.sort < b.sort ? -1 : 1));

// pdflatex accepts these through inputenc, but plain accents survive any toolchain.
const accents = { á: "\\'{a}", é: "\\'{e}", í: "\\'{\\i}", ó: "\\'{o}", ú: "\\'{u}", ñ: "\\~{n}", ö: '\\"{o}', ü: '\\"{u}', ä: '\\"{a}', ç: "\\c{c}", "–": "--", "—": "---" };
const ascii = (s) => s.replace(/[^\x00-\x7f]/g, (c) => accents[c] ?? (() => { throw new Error(`no TeX form for ${c}`); })());
const body = entries.map((e) => `\\bibitem{${e.key}}\n${ascii(e.text)}\n`).join("\n");
writeFileSync(path.join(root, "paper/bibliography.tex"), `% Generated by paper/tools/build-bib.mjs. Do not edit.\n\\begin{thebibliography}{${entries.length}}\n\n${body}\n\\end{thebibliography}\n`);
console.log(`${entries.length} entries for ${cited.size} cited keys`);
