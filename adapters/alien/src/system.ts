// Derived from alien-signals@8734d38 by adapters/alien/derive.mjs. Do not edit.
import {
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

export interface ReactiveNode extends BoundNode {
	depsTail?: Link;
	subsTail?: Link;
	flags: ReactiveFlags;
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
		const prevDep = sub.depsTail;
		if (prevDep !== undefined && depOf(prevDep) === dep) {
			noteLink('prev');
			return;
		}
		const nextDep = prevDep !== undefined ? nextDepOf(prevDep) : firstDep(sub);
		if (nextDep !== undefined && depOf(nextDep) === dep) {
			setVersionOf(nextDep, version);
			noteLink('next');
			sub.depsTail = nextDep;
			return;
		}
		const prevSub = dep.subsTail;
		if (prevSub !== undefined && versionOf(prevSub) === version && subOf(prevSub) === sub) {
			noteLink('tail');
			return;
		}
		sub.depsTail
			= dep.subsTail
			= createLink(dep, sub, version, prevDep, nextDep, prevSub);
	}

	function unlink(link: Link, sub = subOf(link)): Link | undefined {
		const dep = depOf(link);
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
		return nextDep;
	}

	function propagate(link: Link, innerWrite: boolean): void {
		let next = nextSubOf(link);
		let stack: Stack<Link | undefined> | undefined;

		top: do {
			const sub = subOf(link);
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
				const subSubs = firstSub(sub);
				if (subSubs !== undefined) {
					const nextSub = nextSubOf(link = subSubs);
					if (nextSub !== undefined) {
						stack = { value: next, prev: stack };
						next = nextSub;
					}
					continue;
				}
			}

			if ((link = next!) !== undefined) {
				next = nextSubOf(link);
				continue;
			}

			while (stack !== undefined) {
				link = stack.value!;
				stack = stack.prev;
				if (link !== undefined) {
					next = nextSubOf(link);
					continue top;
				}
			}

			break;
		} while (true);
	}

	function checkDirty(link: Link, sub: ReactiveNode): boolean {
		let stack: Stack<Link> | undefined;
		let checkDepth = 0;
		let dirty = false;

		top: do {
			const dep = depOf(link);
			const flags = dep.flags;

			if (sub.flags & ReactiveFlags.Dirty) {
				dirty = true;
			} else if ((flags & (ReactiveFlags.Mutable | ReactiveFlags.Dirty)) === (ReactiveFlags.Mutable | ReactiveFlags.Dirty)) {
				const subs = firstSub(dep)!;
				if (crossing(() => update(dep), link, stack, subs)) {
					if (nextSubOf(subs) !== undefined) {
						shallowPropagate(subs);
					}
					dirty = true;
				}
			} else if ((flags & (ReactiveFlags.Mutable | ReactiveFlags.Pending)) === (ReactiveFlags.Mutable | ReactiveFlags.Pending)) {
				stack = { value: link, prev: stack };
				link = firstDep(dep)!;
				sub = dep;
				++checkDepth;
				continue;
			}

			if (!dirty) {
				const nextDep = nextDepOf(link);
				if (nextDep !== undefined) {
					link = nextDep;
					continue;
				}
			}

			while (checkDepth--) {
				link = stack!.value;
				stack = stack!.prev;
				if (dirty) {
					const subs = firstSub(sub)!;
					if (crossing(() => update(sub), link, stack, subs)) {
						if (nextSubOf(subs) !== undefined) {
							shallowPropagate(subs);
						}
						sub = subOf(link);
						continue;
					}
					dirty = false;
				} else {
					sub.flags &= ~ReactiveFlags.Pending;
				}
				sub = subOf(link);
				const nextDep = nextDepOf(link);
				if (nextDep !== undefined) {
					link = nextDep;
					continue top;
				}
			}

			return dirty && !!sub.flags;
		} while (true);
	}

	function shallowPropagate(link: Link): void {
		do {
			const sub = subOf(link);
			const flags = sub.flags;
			if ((flags & (ReactiveFlags.Pending | ReactiveFlags.Dirty)) === ReactiveFlags.Pending) {
				sub.flags = flags | ReactiveFlags.Dirty;
				if ((flags & (ReactiveFlags.Watching | ReactiveFlags.RecursedCheck)) === ReactiveFlags.Watching) {
					notify(sub);
				}
			}
		} while ((link = nextSubOf(link)!) !== undefined);
	}

	function isValidLink(checkLink: Link, sub: ReactiveNode): boolean {
		let link = sub.depsTail;
		while (link !== undefined) {
			if (same(link, checkLink)) {
				return true;
			}
			link = validStep(link);
		}
		return false;
	}
}
