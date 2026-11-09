// Test-only. Quant's unchanged corpus reads `n.deps`, `e.next`, `e.from` and so
// on directly. This setup file gives it a read-only view of the store with
// those names. It is loaded only through vitest's setupFiles: nothing under
// src/ imports it, so the port cannot base a decision on it.
import { firstDep, firstSub, generationOf, nextDep, nextSub, observed, prevDep, source, target } from "./src/backend";
import { QuantNode, type Edge, type Node } from "./src/model";

const cache = new Map<string, EdgeView>();

function view(e: Edge | null): EdgeView | null {
  if (e === null) return null;
  const key = `${e.slot}:${e.generation}`;
  let found = cache.get(key);
  if (found === undefined) {
    found = new EdgeView(e);
    cache.set(key, found);
  }
  return found;
}

class EdgeView {
  readonly id: Edge;

  constructor(id: Edge) {
    this.id = id;
  }

  get from(): Node {
    return source(this.id);
  }

  get to(): Node {
    return target(this.id);
  }

  get ver(): number {
    return observed(this.id);
  }

  get gen(): number {
    return generationOf(this.id);
  }

  get next(): EdgeView | null {
    return view(nextDep(this.id));
  }

  get prev(): EdgeView | null {
    return view(prevDep(this.id));
  }

  get nextSub(): EdgeView | null {
    return view(nextSub(this.id));
  }

  get prevSub(): EdgeView | null {
    let previous: Edge | null = null;
    for (let e = firstSub(source(this.id)); e !== null; e = nextSub(e)) {
      if (e.slot === this.id.slot && e.generation === this.id.generation) return view(previous);
      previous = e;
    }
    return null;
  }
}

Object.defineProperties(QuantNode.prototype, {
  deps: {
    get(this: Node) {
      return view(firstDep(this));
    },
  },
  subs: {
    get(this: Node) {
      return view(firstSub(this));
    },
  },
  lastSub: {
    get(this: Node) {
      let tail: Edge | null = null;
      for (let e = firstSub(this); e !== null; e = nextSub(e)) tail = e;
      return view(tail);
    },
  },
});
