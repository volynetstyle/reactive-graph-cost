// M5F: is the graph-shaped advantage native, or that of dense indexed storage? Replays the same
// tapes as the Rust harness in plain JavaScript, through objects and through typed arrays.
//   node --expose-gc --max-old-space-size=12000 adapters/m5/js-dense.mjs <tapes dir>
import { readFileSync } from "node:fs";
import path from "node:path";

const KIND = { P: 0, N: 1, R: 2, U: 3, M: 4, F: 5, X: 6, E: 7, B: 8, C: 9 };
const NIL = -1;

function parse(file) {
  const b = readFileSync(file);
  let cap = 1 << 20;
  let ops = new Int32Array(cap * 4);
  let n = 0;
  let nodes = 0;
  let rels = 0;
  for (let i = 0; i < b.length; ) {
    const kind = KIND[String.fromCharCode(b[i++])];
    const args = [0, 0, 0];
    let k = 0;
    while (i < b.length && b[i] !== 10) {
      if (b[i] === 13) { i++; continue; }
      i++;
      let neg = false;
      if (b[i] === 45) { neg = true; i++; }
      let v = 0;
      while (i < b.length && b[i] >= 48 && b[i] <= 57) v = v * 10 + b[i++] - 48;
      if (k < 3) args[k++] = neg ? -v : v;
    }
    i++;
    if (kind === undefined) continue;
    // Same rule as the Rust harness: a truncated tape can name what it never created.
    let keep = true;
    if (kind === 0) { nodes = 0; rels = 0; }
    else if (kind === 1) nodes++;
    else if (kind === 2) { if (args[0] >= nodes || args[1] >= nodes) keep = false; else rels++; }
    else if (kind === 3) keep = args[0] < rels;
    else if (kind === 4) keep = args[1] < rels && (args[2] === -1 || args[2] < rels);
    else if (kind === 5) keep = args[1] < nodes;
    else if (kind === 6 || kind === 7) keep = args[1] < rels;
    if (!keep) continue;
    if (n === cap) {
      const bigger = new Int32Array(cap * 8);
      bigger.set(ops);
      ops = bigger;
      cap *= 2;
    }
    ops[n * 4] = kind;
    ops[n * 4 + 1] = args[0];
    ops[n * 4 + 2] = args[1];
    ops[n * 4 + 3] = args[2];
    n++;
  }
  return { ops, n };
}

// One replay body, instantiated per layout so that each gets its own inline caches.
const replay = `
  return function run(ops, n) {
    let store = new Store();
    let peakBytes = 0, peakLive = 0, sum = 0;
    let map = new MapType(1 << 16), mapped = 0;
    for (let i = 0; i < n; i++) {
      const at = i * 4;
      const a = ops[at + 1], b = ops[at + 2], c = ops[at + 3];
      switch (ops[at]) {
        case 0:
          peakBytes += store.peakBytes; peakLive += store.peakLive;
          store = new Store(); mapped = 0;
          break;
        case 1: store.node(); break;
        case 2: {
          if (mapped === map.length) { const m = new MapType(map.length * 2); for (let j = 0; j < mapped; j++) m[j] = map[j]; map = m; }
          map[mapped++] = store.relate(a, b);
          break;
        }
        case 3: store.unlink(map[a]); if (Store.RELEASE_HANDLES && store.depth === 0) map[a] = null; break;
        case 4: store.moveAfter(a, map[b], c === -1 ? store.NIL : map[c]); break;
        case 5: if (store.first(a, b) !== store.NIL) sum++; break;
        case 6: if (store.next(a, map[b]) !== store.NIL) sum++; break;
        case 7: sum += store.endpoint(map[b], a === 1); break;
        case 8: store.enter(); break;
        case 9: store.exit(); break;
      }
    }
    peakBytes += store.peakBytes; peakLive += store.peakLive;
    return { peakBytes, peakLive, sum, grows: store.grows, reused: store.reused };
  };
`;

class Rec {
  constructor(l, r) {
    this.l = l; this.r = r;
    this.lp = null; this.ln = null; this.rp = null; this.rn = null;
    this.meta = 0; this.retired = false;
  }
}

class Head {
  constructor() { this.lf = null; this.ll = null; this.rf = null; this.rl = null; }
}

class JsObjectIntrusive {
  static RELEASE_HANDLES = true;
  NIL = null; peakBytes = 0; peakLive = 0; grows = 0; reused = 0;
  heads = []; depth = 0; retiredList = []; live = 0;
  node() { this.heads.push(new Head()); }
  insertL(h, id, after) {
    const succ = after === null ? h.lf : after.ln;
    id.lp = after; id.ln = succ;
    if (after === null) h.lf = id; else after.ln = id;
    if (succ === null) h.ll = id; else succ.lp = id;
  }
  insertR(h, id, after) {
    const succ = after === null ? h.rf : after.rn;
    id.rp = after; id.rn = succ;
    if (after === null) h.rf = id; else after.rn = id;
    if (succ === null) h.rl = id; else succ.rp = id;
  }
  detachL(h, id) {
    const a = id.lp, b = id.ln;
    if (a === null) h.lf = b; else a.ln = b;
    if (b === null) h.ll = a; else b.lp = a;
  }
  detachR(h, id) {
    const a = id.rp, b = id.rn;
    if (a === null) h.rf = b; else a.rn = b;
    if (b === null) h.rl = a; else b.rp = a;
  }
  relate(l, r) {
    const id = new Rec(l, r);
    const hl = this.heads[l], hr = this.heads[r];
    this.insertL(hl, id, hl.ll);
    this.insertR(hr, id, hr.rl);
    if (++this.live > this.peakLive) this.peakLive = this.live;
    return id;
  }
  unlink(id) {
    if (id.retired) return;
    this.detachL(this.heads[id.l], id);
    this.detachR(this.heads[id.r], id);
    this.live--;
    if (this.depth > 0) { id.retired = true; this.retiredList.push(id); }
  }
  moveAfter(axis, id, cursor) {
    if (axis === 0) { const h = this.heads[id.l]; this.detachL(h, id); this.insertL(h, id, cursor); }
    else { const h = this.heads[id.r]; this.detachR(h, id); this.insertR(h, id, cursor); }
  }
  first(axis, n) { const h = this.heads[n]; return axis === 0 ? h.lf : h.rf; }
  next(axis, id) {
    if (axis === 0) { let e = id.ln; while (e !== null && e.retired) e = e.ln; return e; }
    let e = id.rn; while (e !== null && e.retired) e = e.rn; return e;
  }
  endpoint(id, right) { return right ? id.r : id.l; }
  enter() { this.depth++; }
  exit() { if (--this.depth === 0) this.retiredList.length = 0; }
}

const L = 0, R = 1, LP = 2, LN = 3, RP = 4, RN = 5, META = 6, GEN = 7;

class DenseBase {
  NIL = NIL; peakLive = 0; peakBytes = 0; grows = 0; reused = 0;
  heads = new Int32Array(64).fill(NIL); nodes = 0; depth = 0; live = 0;
  freeList = new Int32Array(16); freeCount = 0;
  retired = new Int32Array(16); retiredCount = 0;
  slots = 0;
  bytes = 0;
  account(extra) { const t = this.bytes + extra; if (t > this.peakBytes) this.peakBytes = t; }
  node() {
    if ((this.nodes + 1) * 4 > this.heads.length) {
      const h = new Int32Array(this.heads.length * 2).fill(NIL);
      this.account(h.byteLength);
      this.bytes += h.byteLength - this.heads.byteLength;
      h.set(this.heads); this.heads = h; this.grows++;
    }
    this.nodes++;
  }
  pushFree(s) {
    if (this.freeCount === this.freeList.length) { const f = new Int32Array(this.freeCount * 2); f.set(this.freeList); this.account(f.byteLength); this.bytes += this.freeCount * 4; this.freeList = f; }
    this.freeList[this.freeCount++] = s;
  }
  enter() { this.depth++; }
  exit() {
    if (--this.depth === 0) { while (this.retiredCount > 0) this.release(this.retired[--this.retiredCount]); }
  }
  pushRetired(s) {
    if (this.retiredCount === this.retired.length) { const f = new Int32Array(this.retiredCount * 2); f.set(this.retired); this.account(f.byteLength); this.bytes += this.retiredCount * 4; this.retired = f; }
    this.retired[this.retiredCount++] = s;
  }
  first(axis, n) { return this.heads[n * 4 + axis * 2]; }
}

class JsAoS extends DenseBase {
  a = new Int32Array(16 * 8); cap = 16;
  constructor() { super(); this.bytes = this.a.byteLength + this.heads.byteLength; this.peakBytes = this.bytes; }
  alloc(l, r) {
    let s;
    if (this.freeCount > 0) {
      s = this.freeList[--this.freeCount]; this.reused++;
      this.a[s * 8 + GEN] = (this.a[s * 8 + GEN] + 2) & ~1;
    } else {
      if (this.slots === this.cap) {
        const b = new Int32Array(this.cap * 16);
        this.account(b.byteLength); this.bytes += this.a.byteLength;
        b.set(this.a); this.a = b; this.cap *= 2; this.grows++;
      }
      s = this.slots++;
      this.a[s * 8 + GEN] = 0;
    }
    const o = s * 8, a = this.a;
    a[o + L] = l; a[o + R] = r; a[o + LP] = NIL; a[o + LN] = NIL; a[o + RP] = NIL; a[o + RN] = NIL; a[o + META] = 0;
    return s;
  }
  insert(axis, owner, id, after) {
    const a = this.a, h = this.heads, base = owner * 4 + axis * 2, p = 2 + axis * 2, n = p + 1;
    const succ = after === NIL ? h[base] : a[after * 8 + n];
    a[id * 8 + p] = after; a[id * 8 + n] = succ;
    if (after === NIL) h[base] = id; else a[after * 8 + n] = id;
    if (succ === NIL) h[base + 1] = id; else a[succ * 8 + p] = id;
  }
  detach(axis, owner, id) {
    const a = this.a, h = this.heads, base = owner * 4 + axis * 2, p = 2 + axis * 2, n = p + 1;
    const x = a[id * 8 + p], y = a[id * 8 + n];
    if (x === NIL) h[base] = y; else a[x * 8 + n] = y;
    if (y === NIL) h[base + 1] = x; else a[y * 8 + p] = x;
  }
  relate(l, r) {
    const id = this.alloc(l, r);
    this.insert(0, l, id, this.heads[l * 4 + 1]);
    this.insert(1, r, id, this.heads[r * 4 + 3]);
    if (++this.live > this.peakLive) this.peakLive = this.live;
    return id;
  }
  unlink(id) {
    const o = id * 8, a = this.a;
    if (a[o + GEN] & 1) return;
    this.detach(0, a[o + L], id);
    this.detach(1, a[o + R], id);
    this.live--;
    if (this.depth > 0) { a[o + GEN] |= 1; this.pushRetired(id); } else this.pushFree(id);
  }
  release(id) { this.a[id * 8 + GEN] &= ~1; this.pushFree(id); }
  moveAfter(axis, id, cursor) {
    const owner = this.a[id * 8 + axis];
    this.detach(axis, owner, id);
    this.insert(axis, owner, id, cursor);
  }
  next(axis, id) {
    const a = this.a, f = 3 + axis * 2;
    let e = a[id * 8 + f];
    while (e !== NIL && (a[e * 8 + GEN] & 1)) e = a[e * 8 + f];
    return e;
  }
  endpoint(id, right) { return this.a[id * 8 + (right ? R : L)]; }
}

class JsSoA extends DenseBase {
  f = Array.from({ length: 8 }, () => new Int32Array(16));
  fl = this.f[L]; fr = this.f[R]; flp = this.f[LP]; fln = this.f[LN]; frp = this.f[RP]; frn = this.f[RN]; fm = this.f[META]; fg = this.f[GEN];
  cap = 16;
  constructor() { super(); this.bytes = 8 * 16 * 4 + this.heads.byteLength; this.peakBytes = this.bytes; }
  grow() {
    this.account(this.cap * 8 * 8);
    this.bytes += this.cap * 8 * 4;
    this.cap *= 2;
    for (let i = 0; i < 8; i++) { const b = new Int32Array(this.cap); b.set(this.f[i]); this.f[i] = b; }
    [this.fl, this.fr, this.flp, this.fln, this.frp, this.frn, this.fm, this.fg] = this.f;
    this.grows++;
  }
  alloc(l, r) {
    let s;
    if (this.freeCount > 0) { s = this.freeList[--this.freeCount]; this.reused++; this.fg[s] = (this.fg[s] + 2) & ~1; }
    else { if (this.slots === this.cap) this.grow(); s = this.slots++; this.fg[s] = 0; }
    this.fl[s] = l; this.fr[s] = r; this.flp[s] = NIL; this.fln[s] = NIL; this.frp[s] = NIL; this.frn[s] = NIL; this.fm[s] = 0;
    return s;
  }
  insertL(owner, id, after) {
    const h = this.heads, ln = this.fln, lp = this.flp, base = owner * 4;
    const succ = after === NIL ? h[base] : ln[after];
    lp[id] = after; ln[id] = succ;
    if (after === NIL) h[base] = id; else ln[after] = id;
    if (succ === NIL) h[base + 1] = id; else lp[succ] = id;
  }
  insertR(owner, id, after) {
    const h = this.heads, rn = this.frn, rp = this.frp, base = owner * 4 + 2;
    const succ = after === NIL ? h[base] : rn[after];
    rp[id] = after; rn[id] = succ;
    if (after === NIL) h[base] = id; else rn[after] = id;
    if (succ === NIL) h[base + 1] = id; else rp[succ] = id;
  }
  detachL(owner, id) {
    const h = this.heads, ln = this.fln, lp = this.flp, base = owner * 4;
    const x = lp[id], y = ln[id];
    if (x === NIL) h[base] = y; else ln[x] = y;
    if (y === NIL) h[base + 1] = x; else lp[y] = x;
  }
  detachR(owner, id) {
    const h = this.heads, rn = this.frn, rp = this.frp, base = owner * 4 + 2;
    const x = rp[id], y = rn[id];
    if (x === NIL) h[base] = y; else rn[x] = y;
    if (y === NIL) h[base + 1] = x; else rp[y] = x;
  }
  relate(l, r) {
    const id = this.alloc(l, r);
    this.insertL(l, id, this.heads[l * 4 + 1]);
    this.insertR(r, id, this.heads[r * 4 + 3]);
    if (++this.live > this.peakLive) this.peakLive = this.live;
    return id;
  }
  unlink(id) {
    if (this.fg[id] & 1) return;
    this.detachL(this.fl[id], id);
    this.detachR(this.fr[id], id);
    this.live--;
    if (this.depth > 0) { this.fg[id] |= 1; this.pushRetired(id); } else this.pushFree(id);
  }
  release(id) { this.fg[id] &= ~1; this.pushFree(id); }
  moveAfter(axis, id, cursor) {
    if (axis === 0) { const o = this.fl[id]; this.detachL(o, id); this.insertL(o, id, cursor); }
    else { const o = this.fr[id]; this.detachR(o, id); this.insertR(o, id, cursor); }
  }
  next(axis, id) {
    const g = this.fg, n = axis === 0 ? this.fln : this.frn;
    let e = n[id];
    while (e !== NIL && (g[e] & 1)) e = n[e];
    return e;
  }
  endpoint(id, right) { return right ? this.fr[id] : this.fl[id]; }
}

const variants = [
  ["JsObjectIntrusive", JsObjectIntrusive, Array],
  ["JsAoS", JsAoS, Int32Array],
  ["JsSoA", JsSoA, Int32Array],
];

function median(fn, repeats) {
  const times = [];
  let last;
  for (let i = 0; i < repeats; i++) {
    const t = process.hrtime.bigint();
    last = fn();
    times.push(Number(process.hrtime.bigint() - t));
    globalThis.gc();
  }
  times.sort((a, b) => a - b);
  return { ns: times[times.length >> 1], last };
}

/** Bytes of objects after the graph is built, the one form whose size JS does not state. */
function objectBytes(ops, n) {
  let end = 0;
  while (end < n && ops[end * 4] <= 2) end++;
  const before = () => { globalThis.gc(); globalThis.gc(); return process.memoryUsage().heapUsed; };
  const base = before();
  const store = new JsObjectIntrusive();
  const refs = [];
  for (let i = 0; i < end; i++) {
    if (ops[i * 4] === 1) store.node();
    else if (ops[i * 4] === 2) refs.push(store.relate(ops[i * 4 + 1], ops[i * 4 + 2]));
  }
  refs.length = 0;
  const used = before() - base;
  globalThis.gc();
  const live = store.live;
  return live === 0 ? 0 : used / live;
}

function boundary() {
  const count = 200000;
  const objects = Array.from({ length: count }, (_, id) => ({ id, payload: id * 2 }));
  const weak = new WeakMap(objects.map((o, i) => [o, i]));
  const rounds = 40;
  // One loop per probe, so that neither shares inline caches with the other.
  const probe = (read) => new Function("objects", "weak", "rounds", "count", `return function loop() { let s = 0; for (let r = 0; r < rounds; r++) for (let i = 0; i < count; i++) { const o = objects[i]; s += ${read}; } return s; };`)(objects, weak, rounds, count);
  const measure = (read) => median(probe(read), 5).ns / (rounds * count);
  const result = {};
  for (const k of rotated([0, 1])) {
    if (k === 0) result.field = measure("o.id");
    else result.weakMap = measure("weak.get(o)");
  }
  return result;
}

/** Starts from an offset that changes with the run, so that no layout is always measured first. */
function rotated(xs) {
  const start = Number(process.env.M5_ROTATE ?? 0) % xs.length;
  return xs.map((_, i) => xs[(start + i) % xs.length]);
}

const dir = process.argv[2];
const output = process.argv[3];
const rows = {};
for (const [name, file, repeats] of [["quant", "quant.tape", 5], ["synthetic-calm", "synthetic-calm.tape", 5], ["synthetic-churn", "synthetic-churn.tape", 5], ["alien", "alien.tape", 15]]) {
  const { ops, n } = parse(path.join(dir, file));
  const objectSize = name.startsWith("synthetic") ? objectBytes(ops, n) : undefined;
  for (const [label, Store, MapType] of rotated(variants)) {
    const run = new Function("Store", "MapType", replay)(Store, MapType);
    run(ops, Math.min(n, 2000000));
    globalThis.gc();
    const { ns, last } = median(() => run(ops, n), repeats);
    const line = { nsPerOp: ns / n, bytesPerRelation: last.peakBytes / Math.max(1, last.peakLive), grows: last.grows, reused: last.reused, peakLive: last.peakLive };
    if (label === "JsObjectIntrusive") { line.bytesPerRelation = objectSize; }
    rows[`${name}/${label}`] = line;
    console.log(`${name.padEnd(16)} ${label.padEnd(18)} ns/op ${line.nsPerOp.toFixed(2).padStart(8)}  bytes/rel ${line.bytesPerRelation === undefined ? "    -" : line.bytesPerRelation.toFixed(1).padStart(7)}  grows ${line.grows} reused ${line.reused}`);
  }
}
const b = boundary();
rows.boundary = b;
if (output !== undefined) (await import("node:fs")).writeFileSync(output, JSON.stringify(rows, null, 1));
console.log(`boundary object to id, ns: field ${b.field.toFixed(2)}, WeakMap ${b.weakMap.toFixed(2)}`);
