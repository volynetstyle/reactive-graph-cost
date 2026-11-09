// Derives the port's system.ts and index.ts from the frozen sources, so that
// the whole difference from Alien is the list of rules below.
//
//   node adapters/alien/derive.mjs           writes adapters/alien/src
//   node adapters/alien/derive.mjs --check   fails if they differ
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const frozen = path.resolve(here, "../../.cache/alien-8734d38/src");

const IMPORT = `import {
	createLink,
	crossing,
	depOf,
	firstDep,
	firstSub,
	nextDepOf,
	nextSubOf,
	noteAfterUnwatched,
	noteLink,
	noteUnwatched,
	prevSubOf,
	removeLink,
	same,
	setVersionOf,
	snapshotPrevDep,
	subOf,
	validStep,
	versionOf,
	type BoundNode,
	type Link,
} from './backend';

export type { Link } from './backend';
`;

/** Sites whose shape the field rules cannot express. Each `find` must be unique. */
const SITES = {
  "system.ts": [
    [`export interface ReactiveNode {
	deps?: Link;
	depsTail?: Link;
	subs?: Link;
	subsTail?: Link;
`, `${IMPORT}
export interface ReactiveNode extends BoundNode {
	depsTail?: Link;
	subsTail?: Link;
`],
    [`export interface Link {
	version: number;
	dep: ReactiveNode;
	sub: ReactiveNode;
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	prevDep: Link | undefined;
	nextDep: Link | undefined;
}

`, ""],
    [`			nextDep.version = version;
`, `			setVersionOf(nextDep, version);
			noteLink('next');
`],
    [`		const newLink
			= sub.depsTail
			= dep.subsTail
			= {
				version,
				dep,
				sub,
				prevDep,
				nextDep,
				prevSub,
				nextSub: undefined,
			};
		if (nextDep !== undefined) {
			nextDep.prevDep = newLink;
		}
		if (prevDep !== undefined) {
			prevDep.nextDep = newLink;
		} else {
			sub.deps = newLink;
		}
		if (prevSub !== undefined) {
			prevSub.nextSub = newLink;
		} else {
			dep.subs = newLink;
		}
`, `		sub.depsTail
			= dep.subsTail
			= createLink(dep, sub, version, prevDep, nextDep, prevSub);
`],
    [`		const { dep, prevDep, nextDep, nextSub, prevSub } = link;
		if (nextDep !== undefined) {
			nextDep.prevDep = prevDep;
		} else {
			sub.depsTail = prevDep;
		}
		if (prevDep !== undefined) {
			prevDep.nextDep = nextDep;
		} else {
			sub.deps = nextDep;
		}
		if (nextSub !== undefined) {
			nextSub.prevSub = prevSub;
		} else {
			dep.subsTail = prevSub;
		}
		if (prevSub !== undefined) {
			prevSub.nextSub = nextSub;
		} else if ((dep.subs = nextSub) === undefined) {
			unwatched(dep);
		}
`, `		const dep = depOf(link);
		const prevDep = snapshotPrevDep(link);
		const nextDep = nextDepOf(link);
		const nextSub = nextSubOf(link);
		const prevSub = prevSubOf(link);
		removeLink(link, prevDep, nextDep, prevSub, nextSub);
		if (nextDep === undefined) {
			sub.depsTail = prevDep;
		}
		if (nextSub === undefined) {
			dep.subsTail = prevSub;
		}
		if (prevSub === undefined && nextSub === undefined) {
			noteUnwatched(dep);
			unwatched(dep);
			noteAfterUnwatched(nextDep);
		}
`],
    [`const nextSub = (link = subSubs).nextSub;`, `const nextSub = nextSubOf(link = subSubs);`],
    [`if (link === checkLink) {`, `if (same(link, checkLink)) {`],
    [`prevDep.dep === dep) {\n\t\t\treturn;`, `prevDep.dep === dep) {\n\t\t\tnoteLink('prev');\n\t\t\treturn;`],
    [`prevSub.sub === sub) {\n\t\t\treturn;`, `prevSub.sub === sub) {\n\t\t\tnoteLink('tail');\n\t\t\treturn;`],
    [`link = link.prevDep;`, `link = validStep(link);`],
    [`if (update(dep)) {`, `if (crossing(() => update(dep), link, stack, subs)) {`],
    [`if (update(sub)) {`, `if (crossing(() => update(sub), link, stack, subs)) {`],
  ],
  "index.ts": [
    [`import { createReactiveSystem, ReactiveFlags, type ReactiveNode } from './system.js';
`, `import { createReactiveSystem, ReactiveFlags, type ReactiveNode } from './system.js';
import { depOf, enterEpoch, exitEpoch, firstDep, firstSub, nextDepOf, ownerOf, prevDepOf } from './backend';
`],
    [`effect = effect.subs?.sub as EffectNode;`, `effect = ownerOf(effect) as EffectNode;`],
    // Witnessed by conformance #141 and #201 to #203: run reads Links retired during it.
    [`function run(e: EffectNode): void {
`, `function run(e: EffectNode): void {
	enterEpoch();
	try {
		runEffect(e);
	} finally {
		exitEpoch();
	}
}

function runEffect(e: EffectNode): void {
`],
  ],
};

const LINK = "link|prevDep|nextDep|prevSub|subs|subSubs|depsTail";
const NODE = "sub|dep|this|e|node|effect";

/** Field access on code lines. */
const FIELDS = [
  [new RegExp(`\\b(${LINK})\\.dep\\b`, "g"), "depOf($1)"],
  [new RegExp(`\\b(${LINK})\\.sub\\b`, "g"), "subOf($1)"],
  [new RegExp(`\\b(${LINK})\\.nextSub\\b`, "g"), "nextSubOf($1)"],
  [new RegExp(`\\b(${LINK})\\.nextDep\\b`, "g"), "nextDepOf($1)"],
  [new RegExp(`\\b(${LINK})\\.prevDep\\b`, "g"), "prevDepOf($1)"],
  [new RegExp(`\\b(${LINK})\\.version\\b`, "g"), "versionOf($1)"],
  [new RegExp(`\\b(${NODE})\\.deps\\b`, "g"), "firstDep($1)"],
  [new RegExp(`\\b(${NODE})\\.subs\\b`, "g"), "firstSub($1)"],
];

function derive(file) {
  let text = readFileSync(path.join(frozen, file), "utf8").replaceAll("\r\n", "\n");
  for (const [find, replace] of SITES[file]) {
    if (text.split(find).length !== 2) throw new Error(`${file}: not unique: ${find}`);
    text = text.replace(find, () => replace);
  }
  text = text.replace(/^\s*(?:deps|subs): undefined,\n/gm, "");
  const lines = text.split("\n").map((line) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return line;
    return FIELDS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), line);
  });
  return `// Derived from alien-signals@8734d38 by adapters/alien/derive.mjs. Do not edit.\n${lines.join("\n")}`;
}

const check = process.argv.includes("--check");
for (const file of Object.keys(SITES)) {
  const target = path.join(here, "src", file);
  const derived = derive(file);
  if (check) {
    if (readFileSync(target, "utf8") !== derived) throw new Error(`${file} differs from its derivation`);
  } else {
    writeFileSync(target, derived);
  }
}
console.log(check ? "port matches its derivation" : "port derived");
