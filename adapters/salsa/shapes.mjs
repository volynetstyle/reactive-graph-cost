// M4B.4: programs with a chosen shape of trace transition. A selector cell, the last one,
// toggles between two traces, and each toggle forces a re-execution.
//   node adapters/salsa/shapes.mjs output.json
import { writeFileSync } from "node:fs";

const L = 24;
const S = L;
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const plain = (cells) => cells.map((cell) => ({ cell }));
const guarded = (cells, eq) => cells.map((cell) => ({ when: { cell: S, eq }, cell }));
const shuffled = [13, 2, 21, 7, 16, 0, 11, 23, 5, 18, 9, 3, 20, 14, 1, 22, 6, 12, 17, 4, 10, 19, 8, 15];

const shapes = {
  "stable [A,B,C] to the same": [plain([S]), plain(range(0, L))],
  "suffix drop and add": [plain([S]), plain(range(0, 12)), guarded(range(12, L), 0)],
  "branch switch": [plain([S, 0]), guarded(range(1, 12), 0), guarded(range(12, 23), 1)],
  reorder: [plain([S]), guarded(range(0, L), 0), guarded(shuffled, 1)],
  "replace half": [plain([S]), plain(range(0, 12)), guarded(range(12, 18), 0), guarded(range(18, L), 1)],
  "alternating short branches": [plain([S]), guarded([0, 1], 0), guarded([2, 3], 1)],
  "repeated reads": [plain([S, 0, 1, 0, 2, 1, 3, 0]), guarded([2, 4, 2], 0), guarded([4, 2, 4], 1)],
  "long trace, tiny edit": [plain([S]), plain(range(0, 12)), guarded([12], 0), guarded([13], 1), plain(range(14, L))],
  "long trace, complete replacement": [plain([S]), guarded(range(0, 12), 0), guarded(range(12, L), 1)],
};

const toggles = 20;
const programs = Object.entries(shapes).map(([name, parts]) => {
  const ops = [{ kind: "get", i: 0 }];
  for (let i = 1; i <= toggles; i++) {
    ops.push({ kind: "set", i: name.startsWith("stable") ? 0 : S, v: name.startsWith("stable") ? i : i % 2 }, { kind: "get", i: 0 });
  }
  return { name, cells: L + 1, queries: [{ steps: parts.flat() }], ops };
});
writeFileSync(process.argv[2], JSON.stringify(programs));
console.log(`${programs.length} shapes`);
