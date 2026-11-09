// M5D, first level: can a client with only WeakRef, WeakMap and FinalizationRegistry get the
// properties behind the case for GC integration? No `collect` hook and no "before collect".
// global.gc is used by this harness only, as a way to make a collection happen. A result is
// about feasibility: ECMAScript does not promise any object is ever collected.
//   node --expose-gc adapters/m5/gc-feasibility.mjs [rounds]
const turn = () => new Promise((r) => setImmediate(r));
async function settle() {
  for (let i = 0; i < 4; i++) {
    await turn();
    globalThis.gc();
  }
  await turn();
}
const make = (name) => ({ name, payload: new Array(32).fill(name) });

// A WPF-shaped client: ordered records in an array, a target dereferenced on reaching it.
class Source {
  records = [];
  add(target, fn) { this.records.push({ ref: new WeakRef(target), fn: new WeakRef(fn) }); }
  deliver(log) {
    const snapshot = this.records.slice();
    let stale = 0;
    for (const record of snapshot) {
      const target = record.ref.deref();
      if (target === undefined) { stale++; continue; }
      record.fn.deref()?.(target, log);
    }
    return stale;
  }
}

const scenarios = {
  async "unreachable listener is not delivered, later job"() {
    const s = new Source();
    const hold = new WeakMap();
    let a = make("a");
    const b = make("b");
    const fn = (t, l) => l.push(t.name);
    s.add(a, fn);
    s.add(b, fn);
    hold.set(a, fn);
    hold.set(b, fn);
    await turn();
    a = null;
    await settle();
    const log = [];
    const stale = s.deliver(log);
    return log.join() === "b" && stale === 1;
  },

  async "a WeakRef created in this job holds its target to the end of the job"() {
    const r = new WeakRef(make("x"));
    globalThis.gc();
    const alive = r.deref() !== undefined;
    await settle();
    return alive && r.deref() === undefined;
  },

  async "a target not dereferenced in this job can die during a callback"() {
    const s = new Source();
    const names = ["a", "b", "c"];
    const strong = names.map(make);
    const fns = strong.map((t) => (target, log) => { log.push(target.name); if (target.name === "a") { strong[1] = null; globalThis.gc(); } });
    strong.forEach((t, i) => s.add(t, fns[i]));
    await turn();
    await turn();
    const log = [];
    const stale = s.deliver(log);
    return log.join() === "a,c" && stale === 1;
  },

  async "a target dereferenced earlier in the job survives a collection"() {
    const s = new Source();
    const strong = [make("a"), make("b")];
    const fns = strong.map(() => (target, log) => { log.push(target.name); if (target.name === "a") { strong[1] = null; globalThis.gc(); } });
    strong.forEach((t, i) => s.add(t, fns[i]));
    await turn();
    await turn();
    s.records[1].ref.deref();
    const log = [];
    s.deliver(log);
    return log.join() === "a,b";
  },

  async "traversal continues over every entry with a collection in every callback"() {
    const s = new Source();
    const strong = Array.from({ length: 12 }, (_, i) => make(`t${i}`));
    const fns = strong.map((_, i) => (target, log) => { log.push(i); if (i + 2 < 12) strong[i + 2] = null; globalThis.gc(); });
    strong.forEach((t, i) => s.add(t, fns[i]));
    await turn();
    await turn();
    const log = [];
    s.deliver(log);
    return log.join() === "0,1,4,5,8,9";
  },

  async "a finalizer does not run during synchronous execution"() {
    let ran = false;
    const registry = new FinalizationRegistry(() => { ran = true; });
    (() => registry.register(make("f"), 1))();
    await turn();
    globalThis.gc();
    const duringJob = ran;
    await settle();
    return duringJob === false && ran === true;
  },

  async "structural cleanup is later than endpoint death"() {
    const s = new Source();
    let removed = 0;
    const registry = new FinalizationRegistry((record) => { s.records.splice(s.records.indexOf(record), 1); removed++; });
    let a = make("a");
    const fn = () => {};
    s.add(a, fn);
    registry.register(a, s.records[0], s.records[0]);
    await turn();
    a = null;
    globalThis.gc();
    const deadBeforeCleanup = s.records.length === 1 && s.records[0].ref.deref() === undefined && removed === 0;
    await settle();
    return deadBeforeCleanup && s.records.length === 0;
  },

  async "a cycle through client records does not retain itself"() {
    let a = make("a");
    let b = make("b");
    a.other = { ref: new WeakRef(b), strong: b };
    b.other = { ref: new WeakRef(a), strong: a };
    const ra = new WeakRef(a);
    a = null;
    b = null;
    await settle();
    return ra.deref() === undefined;
  },

  async "handler lives while its target does, without extending it"() {
    const table = new WeakMap();
    let target = make("t");
    let handler = () => target;
    const closure = { self: target };
    handler = () => closure.self;
    table.set(target, handler);
    const hr = new WeakRef(handler);
    const tr = new WeakRef(target);
    handler = null;
    await settle();
    const whileAlive = hr.deref() !== undefined && tr.deref() !== undefined;
    target = null;
    closure.self = null;
    await settle();
    return whileAlive && tr.deref() === undefined;
  },

  async "retention can follow activation without changing the record"() {
    const state = { sinks: [] };
    let consumer = make("c");
    const record = { weak: new WeakRef(consumer), strong: null };
    state.sinks.push(record);
    record.strong = consumer;
    consumer = null;
    await settle();
    const heldWhileActive = record.weak.deref() !== undefined;
    record.strong = null;
    await settle();
    return heldWhileActive && record.weak.deref() === undefined;
  },

  async "without a forced collection, allocation alone eventually clears a target"() {
    let t = make("p");
    const r = new WeakRef(t);
    t = null;
    // V8 clears WeakRefs in a major collection, so memory has to survive long enough to force one.
    const hoard = [];
    for (let i = 0; i < 4000; i++) {
      await turn();
      hoard.push(Array.from({ length: 20000 }, (_, j) => ({ j })));
      if (hoard.length > 60) hoard.shift();
      // Not polled every turn: a successful deref keeps its target for that job, and polling
      // alongside incremental marking was observed to keep the target alive indefinitely.
      if (i % 500 === 499 && r.deref() === undefined) return true;
    }
    return false;
  },
};

const rounds = Number(process.argv[2] ?? 20);
const summary = {};
for (const [name, run] of Object.entries(scenarios)) {
  let pass = 0;
  for (let i = 0; i < rounds; i++) if (await run()) pass++;
  summary[name] = pass;
  console.log(`${String(pass).padStart(3)} of ${rounds}  ${name}`);
}
if (process.argv[3] !== undefined) {
  (await import("node:fs")).writeFileSync(process.argv[3], JSON.stringify({ node: process.version, v8: process.versions.v8, rounds, summary }, null, 1));
}
