// alien-signals@8734d38 src/system.ts, with Link objects replaced by slots in one Int32Array.
// The algorithm is unchanged, line for line. See research/M6-ALIEN-DENSE-PROTOCOL.md.
// Derived from alien-signals (MIT, Johnson Chu).

export const NIL = 0;
export type Link = number;

export interface ReactiveNode {
	deps?: Link;
	depsTail?: Link;
	subs?: Link;
	subsTail?: Link;
	flags: ReactiveFlags;
	slot: number;
	refs: number;
}

interface Stack<T> {
	value: T;
	prev: Stack<T> | undefined;
}

export const enum ReactiveFlags {
	None = 0,
	Mutable = 1,
	Watching = 2,
	RecursedCheck = 4,
	Recursed = 8,
	Dirty = 16,
	Pending = 32,
}

const VERSION = 0, DEP = 1, SUB = 2, PREV_SUB = 3, NEXT_SUB = 4, PREV_DEP = 5, NEXT_DEP = 6, STRIDE = 7;

// A link is the offset of its first word, so that a field access needs no multiplication.
let L = new Int32Array(STRIDE * 1024);
let top = STRIDE;
const freeLinks: number[] = [];
let retired: number[] = [];

// Node slot to node. Holds a node strongly while any link, live or retired, names it.
const nodes: (ReactiveNode | undefined)[] = [undefined];
const freeNodes: number[] = [];

// Above zero while user code or a walk may hold a removed link.
let busy = 0;

export function enter(): void { ++busy; }
export function leave(): void { --busy; }

export const prevDepOf = (link: Link): Link => L[link + PREV_DEP]!;
export const nextDepOf = (link: Link): Link => L[link + NEXT_DEP]!;
export const depOf = (link: Link): ReactiveNode => nodes[L[link + DEP]!]!;
export const subOf = (link: Link): ReactiveNode => nodes[L[link + SUB]!]!;

function slotOf(node: ReactiveNode): number {
	if (node.slot === NIL) {
		if (freeNodes.length > 0) {
			node.slot = freeNodes.pop()!;
			nodes[node.slot] = node;
		} else {
			node.slot = nodes.length;
			nodes.push(node);
		}
	}
	++node.refs;
	return node.slot;
}

function release(slot: number): void {
	const node = nodes[slot]!;
	if (--node.refs === 0) {
		node.slot = NIL;
		nodes[slot] = undefined;
		freeNodes.push(slot);
	}
}

function allocate(): Link {
	if (freeLinks.length > 0) {
		return freeLinks.pop()!;
	}
	if (top === L.length) {
		const bigger = new Int32Array(L.length * 2);
		bigger.set(L);
		L = bigger;
	}
	const link = top;
	top += STRIDE;
	return link;
}

/** Quiescent point: removed links can no longer be read by anyone. */
export function reclaim(): void {
	if (busy !== 0 || retired.length === 0) {
		return;
	}
	const done = retired;
	retired = [];
	for (let i = 0; i < done.length; i++) {
		const link = done[i]!;
		// Alien can unlink one link twice during a walk: only the first retirement counts.
		if (L[link + DEP] === NIL) {
			continue;
		}
		release(L[link + DEP]!);
		release(L[link + SUB]!);
		L[link + DEP] = NIL;
		freeLinks.push(link);
	}
}

/** Frozen Alien reads `subs.nextSub` here and throws a TypeError when the node lost its subscribers. */
function nextSubOf(subs: Link): Link {
	if (subs === NIL) {
		throw new TypeError("Cannot read properties of undefined (reading 'nextSub')");
	}
	return L[subs + NEXT_SUB]!;
}

export function createReactiveSystem({
	update,
	notify,
	unwatched,
}: {
	update(sub: ReactiveNode): boolean;
	notify(sub: ReactiveNode): void;
	unwatched(sub: ReactiveNode): void;
}) {
	return {
		link,
		unlink,
		propagate,
		checkDirty,
		shallowPropagate,
	};

	function link(dep: ReactiveNode, sub: ReactiveNode, version: number): void {
		const prevDep = sub.depsTail!;
		if (prevDep !== NIL && L[prevDep + DEP] === dep.slot) {
			return;
		}
		const nextDep = prevDep !== NIL ? L[prevDep + NEXT_DEP]! : sub.deps!;
		if (nextDep !== NIL && L[nextDep + DEP] === dep.slot) {
			L[nextDep + VERSION] = version;
			sub.depsTail = nextDep;
			return;
		}
		const prevSub = dep.subsTail!;
		if (prevSub !== NIL && L[prevSub + VERSION] === version && L[prevSub + SUB] === sub.slot) {
			return;
		}
		const newLink
			= sub.depsTail
			= dep.subsTail
			= allocate();
		L[newLink + VERSION] = version;
		L[newLink + DEP] = slotOf(dep);
		L[newLink + SUB] = slotOf(sub);
		L[newLink + PREV_DEP] = prevDep;
		L[newLink + NEXT_DEP] = nextDep;
		L[newLink + PREV_SUB] = prevSub;
		L[newLink + NEXT_SUB] = NIL;
		if (nextDep !== NIL) {
			L[nextDep + PREV_DEP] = newLink;
		}
		if (prevDep !== NIL) {
			L[prevDep + NEXT_DEP] = newLink;
		} else {
			sub.deps = newLink;
		}
		if (prevSub !== NIL) {
			L[prevSub + NEXT_SUB] = newLink;
		} else {
			dep.subs = newLink;
		}
	}

	function unlink(link: Link, sub: ReactiveNode = nodes[L[link + SUB]!]!): Link {
		const dep = nodes[L[link + DEP]!]!;
		const prevDep = L[link + PREV_DEP]!;
		const nextDep = L[link + NEXT_DEP]!;
		const nextSub = L[link + NEXT_SUB]!;
		const prevSub = L[link + PREV_SUB]!;
		retired.push(link);
		if (nextDep !== NIL) {
			L[nextDep + PREV_DEP] = prevDep;
		}
		// The depsTail fix of the M2.5 "wide-fix" variant, which matched frozen Alien on 4,000
		// programs. Without it a node can keep naming a removed link after its slot is reused.
		if (nextDep === NIL || sub.depsTail === link) {
			sub.depsTail = prevDep;
		}
		if (prevDep !== NIL) {
			L[prevDep + NEXT_DEP] = nextDep;
		} else {
			sub.deps = nextDep;
		}
		if (nextSub !== NIL) {
			L[nextSub + PREV_SUB] = prevSub;
		} else {
			dep.subsTail = prevSub;
		}
		if (prevSub !== NIL) {
			L[prevSub + NEXT_SUB] = nextSub;
		} else if ((dep.subs = nextSub) === NIL) {
			unwatched(dep);
		}
		return nextDep;
	}

	function propagate(link: Link, innerWrite: boolean): void {
		let next = L[link + NEXT_SUB]!;
		let stack: Stack<Link> | undefined;

		top: do {
			const sub = nodes[L[link + SUB]!]!;
			let flags = sub.flags;

			if (!(flags & (ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed | ReactiveFlags.Dirty | ReactiveFlags.Pending))) {
				sub.flags = flags | ReactiveFlags.Pending;
				if (innerWrite) {
					sub.flags |= ReactiveFlags.Recursed;
				}
			} else if (!(flags & (ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed))) {
				flags = ReactiveFlags.None;
			} else if (!(flags & ReactiveFlags.RecursedCheck)) {
				sub.flags = (flags & ~ReactiveFlags.Recursed) | ReactiveFlags.Pending;
			} else if (!(flags & (ReactiveFlags.Dirty | ReactiveFlags.Pending)) && isValidLink(link, sub)) {
				sub.flags = flags | (ReactiveFlags.Recursed | ReactiveFlags.Pending);
				flags &= ReactiveFlags.Mutable;
			} else {
				flags = ReactiveFlags.None;
			}

			if (flags & ReactiveFlags.Watching) {
				notify(sub);
			}

			if (flags & ReactiveFlags.Mutable) {
				const subSubs = sub.subs;
				if (subSubs !== undefined && subSubs !== NIL) {
					const nextSub = L[(link = subSubs) + NEXT_SUB]!;
					if (nextSub !== NIL) {
						stack = { value: next, prev: stack };
						next = nextSub;
					}
					continue;
				}
			}

			if ((link = next) !== NIL) {
				next = L[link + NEXT_SUB]!;
				continue;
			}

			while (stack !== undefined) {
				link = stack.value;
				stack = stack.prev;
				if (link !== NIL) {
					next = L[link + NEXT_SUB]!;
					continue top;
				}
			}

			break;
		} while (true);
	}

	function checkDirty(link: Link, sub: ReactiveNode): boolean {
		++busy;
		try {
			return walkDirty(link, sub);
		} finally {
			--busy;
		}
	}

	function walkDirty(link: Link, sub: ReactiveNode): boolean {
		let stack: Stack<Link> | undefined;
		let checkDepth = 0;
		let dirty = false;

		top: do {
			const dep = nodes[L[link + DEP]!]!;
			const flags = dep.flags;

			if (sub.flags & ReactiveFlags.Dirty) {
				dirty = true;
			} else if ((flags & (ReactiveFlags.Mutable | ReactiveFlags.Dirty)) === (ReactiveFlags.Mutable | ReactiveFlags.Dirty)) {
				const subs = dep.subs!;
				if (update(dep)) {
					if (nextSubOf(subs) !== NIL) {
						shallowPropagate(subs);
					}
					dirty = true;
				}
			} else if ((flags & (ReactiveFlags.Mutable | ReactiveFlags.Pending)) === (ReactiveFlags.Mutable | ReactiveFlags.Pending)) {
				stack = { value: link, prev: stack };
				link = dep.deps!;
				sub = dep;
				++checkDepth;
				continue;
			}

			if (!dirty) {
				const nextDep = L[link + NEXT_DEP]!;
				if (nextDep !== NIL) {
					link = nextDep;
					continue;
				}
			}

			while (checkDepth--) {
				link = stack!.value;
				stack = stack!.prev;
				if (dirty) {
					const subs = sub.subs!;
					if (update(sub)) {
						if (nextSubOf(subs) !== NIL) {
							shallowPropagate(subs);
						}
						sub = nodes[L[link + SUB]!]!;
						continue;
					}
					dirty = false;
				} else {
					sub.flags &= ~ReactiveFlags.Pending;
				}
				sub = nodes[L[link + SUB]!]!;
				const nextDep = L[link + NEXT_DEP]!;
				if (nextDep !== NIL) {
					link = nextDep;
					continue top;
				}
			}

			return dirty && !!sub.flags;
		} while (true);
	}

	function shallowPropagate(link: Link): void {
		do {
			const sub = nodes[L[link + SUB]!]!;
			const flags = sub.flags;
			if ((flags & (ReactiveFlags.Pending | ReactiveFlags.Dirty)) === ReactiveFlags.Pending) {
				sub.flags = flags | ReactiveFlags.Dirty;
				if ((flags & (ReactiveFlags.Watching | ReactiveFlags.RecursedCheck)) === ReactiveFlags.Watching) {
					notify(sub);
				}
			}
		} while ((link = L[link + NEXT_SUB]!) !== NIL);
	}

	function isValidLink(checkLink: Link, sub: ReactiveNode): boolean {
		let link = sub.depsTail!;
		while (link !== NIL) {
			if (link === checkLink) {
				return true;
			}
			link = L[link + PREV_DEP]!;
		}
		return false;
	}
}
