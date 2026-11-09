# The Cost of Reactive Graph Abstractions

Code, data and manuscript for an experimental study of whether reactive graph topology requires
runtime-level primitives. Semantically equivalent implementations with alternative memory
layouts are built and measured across JavaScript and Rust.

The study does not propose a signal API.

**Result, within its limits.** Every tested observable behaviour of five systems (Quant, Alien
Signals, the TC39 signal polyfill, WPF weak events, Salsa) was reproduced with client-owned state.
The systems divide into trace-shaped and graph-shaped workloads that favour different layouts, and
the dense-layout advantage on graph-shaped work reproduces in plain JavaScript over typed arrays.
Within the tested single-threaded incremental workloads, no evidence remains that representation
must be owned by the VM. All measurements come from one machine and one JavaScript engine, no store
was built inside a VM, and interoperability between libraries was not studied.

## Layout

| Path | Contents |
| --- | --- |
| `CONTRACT.md` | the candidate primitive, stated as 15 clauses |
| `reference/` | executable reference machine |
| `test/` | contract and model tests |
| `adapters/` | client ports, oracles, generators, physical harnesses |
| `research/` | per-client inventories, ablation records and syntheses |
| `paper/` | manuscript, generated tables, `data/results.json`, tools |

## Running

Requires Node 25 or later. Client sources are not vendored: the sync scripts clone each one at its
pinned commit into `.cache/`.

```sh
npm ci
npm test
npm run quant:sync && npm run quant:port
npm run alien:sync && npm run alien:port
```

The WPF oracle needs a Windows machine (`npm run wpf:bootstrap`, `wpf:build`, `wpf:oracle`). The
Salsa oracle is `adapters/salsa/run-oracle.sh`. The physical campaign is `adapters/m5/repeat.sh`;
its core-affinity mask is specific to the machine described in the paper.

## Manuscript

Every number and table in `paper/` is generated. No value is typed by hand.

```sh
node paper/tools/collect.mjs      # needs the tapes, oracles and runs above
node paper/tools/gen-numbers.mjs  # fails if a claim in the text stops holding
node paper/tools/build-bib.mjs
node paper/tools/check-quotes.mjs
node paper/tools/lint-tex.mjs
cd paper && pdflatex main.tex && pdflatex main.tex
```

## License

MIT, see `LICENSE`. Parts derived from other projects keep their licenses, see
`THIRD-PARTY-NOTICES.md`.
