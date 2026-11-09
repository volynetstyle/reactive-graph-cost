// Queries Crossref for each candidate reference, and prints what the registry actually holds.
// A reference enters refs.bib only with the registry's title, authors, year, venue and DOI.
//   node paper/tools/lookup-refs.mjs > .cache/paper/lookup.json
const MAIL = "relation-store-paper-check";
const candidates = [
  ["demers1981", "Incremental evaluation for attribute grammars with application to syntax-directed editors Demers Reps Teitelbaum"],
  ["hudson1991", "Incremental attribute evaluation: a flexible algorithm for lazy update Hudson"],
  ["pugh1989", "Incremental computation via function caching Pugh Teitelbaum"],
  ["ramalingam1993", "A categorized bibliography on incremental computation Ramalingam Reps"],
  ["acar2006", "Adaptive functional programming Acar Blelloch Harper"],
  ["acar2009", "An experimental analysis of self-adjusting computation Acar Blelloch Blume Harper Tangwongsan"],
  ["acar2010", "Traceable data types for self-adjusting computation Acar Blelloch Ley-Wild Tangwongsan Turkoglu"],
  ["leywild2012", "Efficient lazy self-adjusting computation non-monotonic self-adjusting computation Ley-Wild Acar Blelloch"],
  ["hammer2014", "Adapton: composable, demand-driven incremental computation Hammer Phang Hicks Foster"],
  ["hammer2015", "Incremental computation with names Hammer Dunfield Headley Labich Foster Hicks Van Horn"],
  ["mokhov2018", "Build systems a la carte Mokhov Mitchell Peyton Jones"],
  ["mokhov2020", "Build systems a la carte: Theory and practice Mokhov Mitchell Peyton Jones"],
  ["erdweg2015", "A sound and optimal incremental build system with dynamic dependencies Erdweg Lichter Weiel"],
  ["cooper2006", "Embedding dynamic dataflow in a call-by-value language Cooper Krishnamurthi"],
  ["elliott2009", "Push-pull functional reactive programming Elliott"],
  ["elliott1997", "Functional reactive animation Elliott Hudak"],
  ["bainomugisha2013", "A survey on reactive programming Bainomugisha Carreton Van Cutsem Mostinckx De Meuter"],
  ["czaplicki2013", "Asynchronous functional reactive programming for GUIs Czaplicki Chong"],
  ["salvaneschi2014", "REScala: bridging between object-oriented and functional style in reactive applications Salvaneschi Hintz Mezini"],
  ["drechsler2014", "Distributed REScala: an update algorithm for distributed reactive programming Drechsler Salvaneschi Mogk Mezini"],
  ["margara2018", "On the semantics of distributed reactive programming: the cost of consistency Margara Salvaneschi"],
  ["maier2013", "Higher-order reactive programming with incremental lists Maier Odersky"],
  ["hayes1997", "Ephemerons: a new finalization mechanism Hayes"],
  ["donnelly2006", "Formal semantics of weak references Donnelly Hallett Kfoury"],
  ["boehm2003", "Destructors, finalizers, and synchronization Boehm"],
  ["chilimbi1999", "Cache-conscious structure layout Chilimbi Hill Larus"],
  ["chilimbi1999b", "Cache-conscious structure definition Chilimbi Davidson Larus"],
  ["ailamaki2001", "Weaving relations for cache performance Ailamaki DeWitt Hill Skounakis"],
  ["lattner2005", "Automatic pool allocation: improving performance by controlling data structure layout in the heap Lattner Adve"],
  ["shun2013", "Ligra: a lightweight graph processing framework for shared memory Shun Blelloch"],
  ["dhulipala2019", "Low-latency graph streaming using compressed purely-functional trees Dhulipala Blelloch Shun"],
  ["grinten2022", "Fast dynamic graphs: dynamic hash-based block adjacency van der Grinten Predari Willich DHB"],
  ["dietz1987", "Two algorithms for maintaining order in a list Dietz Sleator"],
  ["rumbaugh1987", "Relations as semantic constructs in an object-oriented language Rumbaugh"],
  ["bierman2005", "First-class relationships in an object-oriented language Bierman Wren"],
  ["balzer2007", "A relational model of object collaborations and its use in reasoning about relationships Balzer Gross Eugster"],
  ["georges2007", "Statistically rigorous Java performance evaluation Georges Buytaert Eeckhout"],
  ["mytkowicz2009", "Producing wrong data without doing anything obviously wrong Mytkowicz Diwan Hauswirth Sweeney"],
  ["kalibera2013", "Rigorous benchmarking in reasonable time Kalibera Jones"],
  ["barrett2017", "Virtual machine warmup blows hot and cold Barrett Bolz-Tereick Killick Mount Tratt"],
  ["blackburn2006", "The DaCapo benchmarks: Java benchmarking development and analysis Blackburn"],
  ["jangda2019", "Not so fast: analyzing the performance of WebAssembly vs. native code Jangda Powers Berger Guha"],
  ["haas2017", "Bringing the web up to speed with WebAssembly Haas Rossberg"],
  ["mckeeman1998", "Differential testing for software McKeeman"],
  ["claessen2000", "QuickCheck: a lightweight tool for random testing of Haskell programs Claessen Hughes"],
  ["yang2011", "Finding and understanding bugs in C compilers Yang Chen Eide Regehr"],
  ["mcsherry2013", "Differential dataflow McSherry Murray Isaacs Abadi"],
  ["murray2013", "Naiad: a timely dataflow system Murray McSherry Isaacs Isard Barham Abadi"],
  ["wirfsbrock2020", "JavaScript: the first 20 years Wirfs-Brock Eich"],
];

const clean = (s) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const out = {};
for (const [key, query] of candidates) {
  const url = `https://api.crossref.org/works?rows=3&select=DOI,title,author,issued,container-title,published,type,volume,issue,page,publisher&query.bibliographic=${encodeURIComponent(query)}&mailto=${MAIL}@example.org`;
  let items = [];
  for (let attempt = 0; attempt < 4 && items.length === 0; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) items = (await response.json()).message.items;
      else await new Promise((r) => setTimeout(r, 1500));
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  out[key] = items.map((w) => ({
    doi: w.DOI,
    title: clean(w.title?.[0]),
    authors: (w.author ?? []).map((a) => `${a.given ?? ""} ${a.family ?? a.name ?? ""}`.trim()),
    year: w.issued?.["date-parts"]?.[0]?.[0],
    venue: clean(w["container-title"]?.[0]),
    type: w.type,
    volume: w.volume,
    issue: w.issue,
    page: w.page,
    publisher: w.publisher,
  }));
  process.stderr.write(`${key}: ${out[key][0]?.title?.slice(0, 70) ?? "NOT FOUND"} (${out[key][0]?.year})\n`);
  await new Promise((r) => setTimeout(r, 250));
}
console.log(JSON.stringify(out, null, 1));
