// Fetches the primary text behind the claims the paper makes about other work, into .cache/paper.
// Exact DOIs are confirmed against Crossref, abstracts come from Semantic Scholar where present.
//   node paper/tools/fetch-sources.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, ".cache/paper");
mkdirSync(path.join(out, "pdf"), { recursive: true });

export const dois = {
  demers1981: "10.1145/567532.567544",
  hudson1991: "10.1145/117009.117012",
  pugh1989: "10.1145/75277.75305",
  ramalingam1993: "10.1145/158511.158710",
  acar2006: "10.1145/1186632.1186634",
  acar2009: "10.1145/1596527.1596530",
  acar2010: "10.1145/1806596.1806650",
  leywild2012: "10.1007/978-3-642-28869-2_24",
  hammer2008: "10.1145/1375634.1375642",
  hammer2014: "10.1145/2594291.2594324",
  hammer2015: "10.1145/2814270.2814305",
  mokhov2018: "10.1145/3236774",
  mokhov2020: "10.1017/S0956796820000088",
  erdweg2015: "10.1145/2814270.2814316",
  cooper2006: "10.1007/11693024_20",
  elliott2009: "10.1145/1596638.1596643",
  elliott1997: "10.1145/258948.258973",
  bainomugisha2013: "10.1145/2501654.2501666",
  czaplicki2013: "10.1145/2491956.2462161",
  salvaneschi2014: "10.1145/2577080.2577083",
  drechsler2014: "10.1145/2660193.2660240",
  margara2018: "10.1109/TSE.2018.2833109",
  maier2013: "10.1007/978-3-642-39038-8_29",
  hayes1997: "10.1145/263698.263733",
  donnelly2006: "10.1145/1133956.1133974",
  boehm2003: "10.1145/604131.604153",
  chilimbi1999: "10.1145/301618.301633",
  chilimbi1999b: "10.1145/301618.301635",
  lattner2005: "10.1145/1065010.1065027",
  shun2013: "10.1145/2442516.2442530",
  dhulipala2019: "10.1145/3314221.3314598",
  dietz1987: "10.1145/28395.28434",
  rumbaugh1987: "10.1145/38765.38850",
  bierman2005: "10.1007/11531142_12",
  balzer2007: "10.1007/978-3-540-73589-2_16",
  georges2007: "10.1145/1297027.1297033",
  mytkowicz2009: "10.1145/1508244.1508275",
  kalibera2013: "10.1145/2464157.2464160",
  barrett2017: "10.1145/3133876",
  blackburn2006: "10.1145/1167473.1167488",
  haas2017: "10.1145/3062341.3062363",
  claessen2000: "10.1145/351240.351266",
  yang2011: "10.1145/1993498.1993532",
  murray2013: "10.1145/2517349.2522738",
  wirfsbrock2020: "10.1145/3386327",
};

const clean = (s) => (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const get = async (url, headers = {}) => {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers });
      if (r.ok) return r;
      if (r.status === 404) return r;
    } catch {}
    await new Promise((d) => setTimeout(d, 1500 * (i + 1)));
  }
  return { ok: false, status: 0 };
};

const result = {};
for (const [key, doi] of Object.entries(dois)) {
  const r = await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=relation-store-paper-check@example.org`);
  if (!r.ok) {
    result[key] = { doi, error: r.status };
    console.log(`${key}: NOT RESOLVED ${doi} (${r.status})`);
    continue;
  }
  const w = (await r.json()).message;
  result[key] = {
    doi,
    title: clean(w.title?.[0]),
    subtitle: clean(w.subtitle?.[0]),
    containers: (w["container-title"] ?? []).map(clean),
    authors: (w.author ?? []).map((a) => [a.given ?? "", a.family ?? a.name ?? ""]),
    year: (w["published-print"] ?? w.issued)?.["date-parts"]?.[0]?.[0],
    issued: w.issued?.["date-parts"]?.[0]?.[0],
    venue: clean(w["container-title"]?.[0]),
    event: clean(w.event?.name),
    type: w.type,
    volume: w.volume,
    issue: w.issue,
    page: w.page ?? w["article-number"],
    publisher: w.publisher,
    abstract: clean(w.abstract),
  };
  console.log(`${key}: ${result[key].title.slice(0, 74)} | ${result[key].issued} | ${result[key].authors.map((a) => a[1]).join(",").slice(0, 40)}`);
  await new Promise((d) => setTimeout(d, 200));
}
writeFileSync(path.join(out, "crossref.json"), JSON.stringify(result, null, 1));
