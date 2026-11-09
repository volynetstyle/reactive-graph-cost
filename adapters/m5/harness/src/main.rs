// M5A, M5B, M5C: replays the same operation tapes through competing physical representations.
// Nothing here is L0 v2: Store* are candidates, and every store pays for its whole structure.
//   m5-harness <tapes dir> <output.json>
use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::hint::black_box;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Instant;

struct Counting;
static CUR: AtomicU64 = AtomicU64::new(0);
static PEAK: AtomicU64 = AtomicU64::new(0);
static ALLOCS: AtomicU64 = AtomicU64::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Relaxed);
        let now = CUR.fetch_add(l.size() as u64, Relaxed) + l.size() as u64;
        PEAK.fetch_max(now, Relaxed);
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        CUR.fetch_sub(l.size() as u64, Relaxed);
        unsafe { System.dealloc(p, l) }
    }
}

#[global_allocator]
static A: Counting = Counting;

fn mark() -> u64 {
    let c = CUR.load(Relaxed);
    PEAK.store(c, Relaxed);
    c
}

// ---- linked representations, one algorithm over several layouts --------------------------

trait Slots: Default {
    type Id: Copy + PartialEq;
    const NIL: Self::Id;
    const NAME: &'static str;
    const RIGHT: bool = true;
    fn alloc(&mut self, l: u32, r: u32, m: u32) -> Self::Id;
    fn free(&mut self, id: Self::Id);
    fn link(&self, id: Self::Id, f: usize) -> Self::Id;
    fn set_link(&mut self, id: Self::Id, f: usize, v: Self::Id);
    fn endpoint(&self, id: Self::Id, right: bool) -> u32;
    fn retired(&self, id: Self::Id) -> bool;
    fn set_retired(&mut self, id: Self::Id);
}

const NIL32: u32 = u32::MAX;

#[derive(Default)]
struct StoreAos {
    recs: Vec<[u32; 8]>,
    free: Vec<u32>,
}

impl Slots for StoreAos {
    type Id = u32;
    const NIL: u32 = NIL32;
    const NAME: &'static str = "StoreAoS";
    fn alloc(&mut self, l: u32, r: u32, m: u32) -> u32 {
        let rec = [l, r, NIL32, NIL32, NIL32, NIL32, m, 0];
        if let Some(s) = self.free.pop() {
            let g = self.recs[s as usize][7].wrapping_add(2) & !1;
            self.recs[s as usize] = rec;
            self.recs[s as usize][7] = g;
            s
        } else {
            self.recs.push(rec);
            self.recs.len() as u32 - 1
        }
    }
    fn free(&mut self, id: u32) {
        self.free.push(id);
    }
    #[inline]
    fn link(&self, id: u32, f: usize) -> u32 {
        self.recs[id as usize][2 + f]
    }
    #[inline]
    fn set_link(&mut self, id: u32, f: usize, v: u32) {
        self.recs[id as usize][2 + f] = v;
    }
    #[inline]
    fn endpoint(&self, id: u32, right: bool) -> u32 {
        self.recs[id as usize][right as usize]
    }
    #[inline]
    fn retired(&self, id: u32) -> bool {
        self.recs[id as usize][7] & 1 == 1
    }
    fn set_retired(&mut self, id: u32) {
        self.recs[id as usize][7] |= 1;
    }
}

#[derive(Default)]
struct StoreSoa {
    ends: [Vec<u32>; 2],
    links: [Vec<u32>; 4],
    meta: Vec<u32>,
    gen_state: Vec<u32>,
    free: Vec<u32>,
}

impl Slots for StoreSoa {
    type Id = u32;
    const NIL: u32 = NIL32;
    const NAME: &'static str = "StoreSoA";
    fn alloc(&mut self, l: u32, r: u32, m: u32) -> u32 {
        if let Some(s) = self.free.pop() {
            let i = s as usize;
            self.ends[0][i] = l;
            self.ends[1][i] = r;
            for f in 0..4 {
                self.links[f][i] = NIL32;
            }
            self.meta[i] = m;
            self.gen_state[i] = self.gen_state[i].wrapping_add(2) & !1;
            s
        } else {
            self.ends[0].push(l);
            self.ends[1].push(r);
            for f in 0..4 {
                self.links[f].push(NIL32);
            }
            self.meta.push(m);
            self.gen_state.push(0);
            self.meta.len() as u32 - 1
        }
    }
    fn free(&mut self, id: u32) {
        self.free.push(id);
    }
    #[inline]
    fn link(&self, id: u32, f: usize) -> u32 {
        self.links[f][id as usize]
    }
    #[inline]
    fn set_link(&mut self, id: u32, f: usize, v: u32) {
        self.links[f][id as usize] = v;
    }
    #[inline]
    fn endpoint(&self, id: u32, right: bool) -> u32 {
        self.ends[right as usize][id as usize]
    }
    #[inline]
    fn retired(&self, id: u32) -> bool {
        self.gen_state[id as usize] & 1 == 1
    }
    fn set_retired(&mut self, id: u32) {
        self.gen_state[id as usize] |= 1;
    }
}

/// Identity and endpoints apart from incidence; the right incidence is simply absent.
#[derive(Default)]
struct StoreSplit {
    ident: Vec<[u32; 4]>,
    left_links: Vec<[u32; 2]>,
    free: Vec<u32>,
}

impl Slots for StoreSplit {
    type Id = u32;
    const NIL: u32 = NIL32;
    const NAME: &'static str = "StoreSplitLeftOnly";
    const RIGHT: bool = false;
    fn alloc(&mut self, l: u32, r: u32, m: u32) -> u32 {
        if let Some(s) = self.free.pop() {
            let i = s as usize;
            let g = self.ident[i][3].wrapping_add(2) & !1;
            self.ident[i] = [l, r, m, g];
            self.left_links[i] = [NIL32, NIL32];
            s
        } else {
            self.ident.push([l, r, m, 0]);
            self.left_links.push([NIL32, NIL32]);
            self.ident.len() as u32 - 1
        }
    }
    fn free(&mut self, id: u32) {
        self.free.push(id);
    }
    #[inline]
    fn link(&self, id: u32, f: usize) -> u32 {
        if f < 2 { self.left_links[id as usize][f] } else { NIL32 }
    }
    #[inline]
    fn set_link(&mut self, id: u32, f: usize, v: u32) {
        if f < 2 {
            self.left_links[id as usize][f] = v;
        }
    }
    #[inline]
    fn endpoint(&self, id: u32, right: bool) -> u32 {
        self.ident[id as usize][right as usize]
    }
    #[inline]
    fn retired(&self, id: u32) -> bool {
        self.ident[id as usize][3] & 1 == 1
    }
    fn set_retired(&mut self, id: u32) {
        self.ident[id as usize][3] |= 1;
    }
}

struct BoxRec {
    links: [*mut BoxRec; 4],
    l: u32,
    r: u32,
    meta: u32,
    retired: bool,
}

/// Individually allocated records joined by pointers, as a client writes them.
#[derive(Default)]
struct ClientIntrusive;

impl Slots for ClientIntrusive {
    type Id = *mut BoxRec;
    const NIL: *mut BoxRec = std::ptr::null_mut();
    const NAME: &'static str = "ClientIntrusive";
    fn alloc(&mut self, l: u32, r: u32, m: u32) -> *mut BoxRec {
        Box::into_raw(Box::new(BoxRec { links: [std::ptr::null_mut(); 4], l, r, meta: m, retired: false }))
    }
    fn free(&mut self, id: *mut BoxRec) {
        unsafe { drop(Box::from_raw(id)) }
    }
    #[inline]
    fn link(&self, id: *mut BoxRec, f: usize) -> *mut BoxRec {
        unsafe { (*id).links[f] }
    }
    #[inline]
    fn set_link(&mut self, id: *mut BoxRec, f: usize, v: *mut BoxRec) {
        unsafe { (*id).links[f] = v }
    }
    #[inline]
    fn endpoint(&self, id: *mut BoxRec, right: bool) -> u32 {
        unsafe { black_box((*id).meta); if right { (*id).r } else { (*id).l } }
    }
    #[inline]
    fn retired(&self, id: *mut BoxRec) -> bool {
        unsafe { (*id).retired }
    }
    fn set_retired(&mut self, id: *mut BoxRec) {
        unsafe { (*id).retired = true }
    }
}

struct Linked<S: Slots> {
    s: S,
    heads: Vec<[S::Id; 4]>,
    depth: u32,
    retired: Vec<S::Id>,
    live: u64,
    peak_live: u64,
}

impl<S: Slots> Linked<S> {
    fn new() -> Self {
        Self { s: S::default(), heads: Vec::new(), depth: 0, retired: Vec::new(), live: 0, peak_live: 0 }
    }
    fn node(&mut self) {
        self.heads.push([S::NIL; 4]);
    }
    fn nodes(&mut self, n: usize) {
        self.heads.resize(n, [S::NIL; 4]);
    }
    fn insert(&mut self, axis: usize, owner: usize, id: S::Id, after: S::Id) {
        let (p, n) = (axis * 2, axis * 2 + 1);
        let (first, last) = (axis * 2, axis * 2 + 1);
        let succ = if after == S::NIL { self.heads[owner][first] } else { self.s.link(after, n) };
        self.s.set_link(id, p, after);
        self.s.set_link(id, n, succ);
        if after == S::NIL { self.heads[owner][first] = id } else { self.s.set_link(after, n, id) }
        if succ == S::NIL { self.heads[owner][last] = id } else { self.s.set_link(succ, p, id) }
    }
    fn detach(&mut self, axis: usize, owner: usize, id: S::Id) {
        let (p, n) = (axis * 2, axis * 2 + 1);
        let (first, last) = (axis * 2, axis * 2 + 1);
        let (a, b) = (self.s.link(id, p), self.s.link(id, n));
        if a == S::NIL { self.heads[owner][first] = b } else { self.s.set_link(a, n, b) }
        if b == S::NIL { self.heads[owner][last] = a } else { self.s.set_link(b, p, a) }
    }
    #[inline]
    fn relate(&mut self, l: u32, r: u32, m: u32) -> S::Id {
        let id = self.s.alloc(l, r, m);
        let tail = self.heads[l as usize][1];
        self.insert(0, l as usize, id, tail);
        if S::RIGHT {
            let tail = self.heads[r as usize][3];
            self.insert(1, r as usize, id, tail);
        }
        self.live += 1;
        self.peak_live = self.peak_live.max(self.live);
        id
    }
    fn unlink(&mut self, id: S::Id) {
        if self.s.retired(id) {
            return;
        }
        let (l, r) = (self.s.endpoint(id, false), self.s.endpoint(id, true));
        self.detach(0, l as usize, id);
        if S::RIGHT {
            self.detach(1, r as usize, id);
        }
        self.live -= 1;
        if self.depth > 0 {
            self.s.set_retired(id);
            self.retired.push(id);
        } else {
            self.s.free(id);
        }
    }
    fn move_after(&mut self, axis: usize, id: S::Id, cursor: S::Id) {
        if axis == 1 && !S::RIGHT {
            return;
        }
        let owner = self.s.endpoint(id, axis == 1) as usize;
        self.detach(axis, owner, id);
        self.insert(axis, owner, id, cursor);
    }
    #[inline]
    fn first(&self, axis: usize, n: u32) -> S::Id {
        self.heads[n as usize][axis * 2]
    }
    #[inline]
    fn next(&self, axis: usize, id: S::Id) -> S::Id {
        let f = axis * 2 + 1;
        let mut e = self.s.link(id, f);
        while e != S::NIL && self.s.retired(e) {
            e = self.s.link(e, f);
        }
        e
    }
    fn enter(&mut self) {
        self.depth += 1;
    }
    fn exit(&mut self) {
        self.depth -= 1;
        if self.depth == 0 {
            while let Some(id) = self.retired.pop() {
                self.s.free(id);
            }
        }
    }
    fn clear(&mut self) {
        // Release everything still held: individually allocated records must be returned.
        for i in 0..self.heads.len() {
            let mut e = self.heads[i][0];
            while e != S::NIL {
                let n = self.s.link(e, 1);
                self.s.free(e);
                e = n;
            }
        }
        while let Some(id) = self.retired.pop() {
            self.s.free(id);
        }
    }
}

// ---- tapes ---------------------------------------------------------------------------------

#[derive(Clone)]
enum G {
    Program,
    Node,
    Relate(u32, u32),
    Unlink(u32),
    Move(u8, u32, u32),
    First(u8, u32),
    Next(u8, u32),
    End(u8, u32),
    Enter,
    Exit,
}

fn parse_graph(text: &str) -> Vec<G> {
    let mut out = Vec::new();
    for line in text.lines() {
        let mut p = line.split(' ');
        let k = p.next().unwrap_or("");
        let mut n = || p.next().unwrap().parse::<i64>().unwrap();
        out.push(match k {
            "P" => G::Program,
            "N" => G::Node,
            "R" => { let (a, b) = (n(), n()); G::Relate(a as u32, b as u32) }
            "U" => G::Unlink(n() as u32),
            "M" => { let (a, e, c) = (n(), n(), n()); G::Move(a as u8, e as u32, c as u32) }
            "F" => { let (a, x) = (n(), n()); G::First(a as u8, x as u32) }
            "X" => { let (a, x) = (n(), n()); G::Next(a as u8, x as u32) }
            "E" => { let (a, x) = (n(), n()); G::End(a as u8, x as u32) }
            "B" => G::Enter,
            "C" => G::Exit,
            _ => continue,
        });
    }
    out
}

/// A tape cut off by a worker's exit can name a relation it never saw created.
fn sanitize(ops: Vec<G>) -> Vec<G> {
    let mut out = Vec::with_capacity(ops.len());
    let (mut nodes, mut rels) = (0u32, 0u32);
    for op in ops {
        match &op {
            G::Program => { nodes = 0; rels = 0; }
            G::Node => nodes += 1,
            G::Relate(a, b) => { if *a >= nodes || *b >= nodes { continue; } rels += 1; }
            G::Unlink(e) | G::Next(_, e) | G::End(_, e) if *e >= rels => continue,
            G::Move(_, e, c) if *e >= rels || (*c != u32::MAX && *c >= rels) => continue,
            G::First(_, n) if *n >= nodes => continue,
            _ => {}
        }
        out.push(op);
    }
    out
}

struct Measured {
    ns: f64,
    allocs: f64,
    peak_sum: u64,
    peak_live_sum: u64,
    ops: u64,
}

fn replay_graph<S: Slots>(ops: &[G]) -> (u64, u64, u64) {
    let mut sum = 0u64;
    let (mut peak_sum, mut peak_live) = (0u64, 0u64);
    let mut map: Vec<S::Id> = Vec::with_capacity(1 << 16);
    let mut store = Linked::<S>::new();
    let mut base = mark();
    for op in ops {
        match *op {
            G::Program => {
                peak_sum += PEAK.load(Relaxed).saturating_sub(base);
                peak_live += store.peak_live;
                store.clear();
                store = Linked::new();
                map.clear();
                base = mark();
            }
            G::Node => store.node(),
            G::Relate(a, b) => { let id = store.relate(a, b, 0); map.push(id); }
            G::Unlink(e) => store.unlink(map[e as usize]),
            G::Move(a, e, c) => {
                let cur = if c == u32::MAX { S::NIL } else { map[c as usize] };
                store.move_after(a as usize, map[e as usize], cur);
            }
            G::First(a, n) => { let id = store.first(a as usize, n); black_box(id != S::NIL); }
            G::Next(a, e) => { let id = store.next(a as usize, map[e as usize]); black_box(id != S::NIL); }
            G::End(r, e) => sum = sum.wrapping_add(store.s.endpoint(map[e as usize], r == 1) as u64),
            G::Enter => store.enter(),
            G::Exit => store.exit(),
        }
    }
    peak_sum += PEAK.load(Relaxed).saturating_sub(base);
    peak_live += store.peak_live;
    store.clear();
    black_box(sum);
    (peak_sum, peak_live, 0)
}

fn timed<F: FnMut() -> (u64, u64, u64)>(ops: u64, repeats: usize, mut f: F) -> Measured {
    let (mut times, mut allocs) = (Vec::new(), 0u64);
    let mut last = (0, 0, 0);
    for _ in 0..repeats {
        let a0 = ALLOCS.load(Relaxed);
        let t = Instant::now();
        last = f();
        times.push(t.elapsed().as_nanos() as f64);
        allocs = ALLOCS.load(Relaxed) - a0;
    }
    times.sort_by(f64::total_cmp);
    Measured { ns: times[times.len() / 2], allocs: allocs as f64, peak_sum: last.0, peak_live_sum: last.1, ops }
}

// Trace-shaped work: each query's trace is replaced whole, validated forward.

enum T {
    Program(usize),
    Trace(u32, Vec<u32>),
    Validate(u32, u32),
}

fn parse_trace(text: &str) -> Vec<T> {
    let mut out = Vec::new();
    for line in text.lines() {
        let mut p = line.split(' ');
        match p.next().unwrap_or("") {
            "P" => out.push(T::Program(p.next().unwrap().parse().unwrap())),
            "T" => {
                let q = p.next().unwrap().parse().unwrap();
                out.push(T::Trace(q, p.filter(|x| !x.is_empty()).map(|x| x.parse().unwrap()).collect()));
            }
            "V" => { let (a, b) = (p.next().unwrap().parse().unwrap(), p.next().unwrap().parse().unwrap()); out.push(T::Validate(a, b)); }
            _ => {}
        }
    }
    out
}

fn trace_packed(tape: &[T]) -> (u64, u64, u64) {
    let (mut peak, mut live_peak, mut sum) = (0u64, 0u64, 0u64);
    let mut memos: Vec<Option<Box<[u32]>>> = Vec::new();
    let mut scratch: Vec<u32> = Vec::new();
    let mut live = 0u64;
    let mut pl = 0u64;
    let mut base = mark();
    for op in tape {
        match op {
            T::Program(n) => {
                peak += PEAK.load(Relaxed).saturating_sub(base);
                live_peak += pl;
                memos = Vec::new();
                scratch = Vec::new();
                base = mark();
                memos = vec![None; *n];
                live = 0;
                pl = 0;
            }
            T::Trace(q, deps) => {
                live += deps.len() as u64;
                if let Some(old) = memos[*q as usize].take() { live -= old.len() as u64; }
                scratch.clear();
                for d in deps { scratch.push(black_box(*d)); }
                memos[*q as usize] = Some(scratch.as_slice().into());
                pl = pl.max(live);
            }
            T::Validate(q, k) => {
                if let Some(m) = &memos[*q as usize] {
                    for d in m.iter().take(*k as usize) { sum = sum.wrapping_add(*d as u64); }
                }
            }
        }
    }
    peak += PEAK.load(Relaxed).saturating_sub(base);
    black_box(sum);
    (peak, live_peak + pl, 0)
}

fn trace_persistent(tape: &[T]) -> (u64, u64, u64) {
    let (mut peak, mut live_peak, mut sum) = (0u64, 0u64, 0u64);
    let mut memos: Vec<(Vec<u32>, HashMap<u32, u32>)> = Vec::new();
    let mut live = 0i64;
    let mut pl = 0i64;
    let mut base = mark();
    for op in tape {
        match op {
            T::Program(n) => {
                peak += PEAK.load(Relaxed).saturating_sub(base);
                live_peak += pl as u64;
                memos = Vec::new();
                base = mark();
                memos = (0..*n).map(|_| (Vec::new(), HashMap::new())).collect();
                live = 0;
                pl = 0;
            }
            T::Trace(q, deps) => {
                let (list, map) = &mut memos[*q as usize];
                live += deps.len() as i64 - list.len() as i64;
                let wanted: std::collections::HashSet<u32> = deps.iter().copied().collect();
                map.retain(|k, _| wanted.contains(k));
                for (i, d) in deps.iter().enumerate() {
                    map.insert(*d, i as u32);
                    if list.get(i) != Some(d) {
                        if i < list.len() { list[i] = *d } else { list.push(*d) }
                    }
                }
                list.truncate(deps.len());
                pl = pl.max(live);
            }
            T::Validate(q, k) => {
                for d in memos[*q as usize].0.iter().take(*k as usize) { sum = sum.wrapping_add(*d as u64); }
            }
        }
    }
    peak += PEAK.load(Relaxed).saturating_sub(base);
    black_box(sum);
    (peak, live_peak + pl as u64, 0)
}

const REBUILD: u8 = 0;
const HASH: u8 = 1;
const CURSOR: u8 = 2;

fn trace_linked<S: Slots>(tape: &[T], mode: u8) -> (u64, u64, u64) {
    let (mut peak, mut live_peak, mut sum) = (0u64, 0u64, 0u64);
    let mut store = Linked::<S>::new();
    let mut maps: Vec<HashMap<u32, S::Id>> = Vec::new();
    let mut base = mark();
    for op in tape {
        match op {
            T::Program(n) => {
                peak += PEAK.load(Relaxed).saturating_sub(base);
                live_peak += store.peak_live;
                store.clear();
                store = Linked::new();
                maps = Vec::new();
                base = mark();
                store.nodes(*n);
                maps = if mode == HASH { (0..*n).map(|_| HashMap::new()).collect() } else { Vec::new() };
            }
            T::Trace(q, deps) => {
                match mode {
                    HASH => reconcile(&mut store, &mut maps[*q as usize], *q, deps),
                    CURSOR => reconcile_cursor(&mut store, *q, deps),
                    _ => rebuild(&mut store, *q, deps),
                }
            }
            T::Validate(q, k) => {
                let mut e = store.first(0, *q);
                let mut i = 0;
                while e != S::NIL && i < *k {
                    sum = sum.wrapping_add(store.s.endpoint(e, true) as u64);
                    e = store.next(0, e);
                    i += 1;
                }
            }
        }
    }
    peak += PEAK.load(Relaxed).saturating_sub(base);
    live_peak += store.peak_live;
    store.clear();
    black_box(sum);
    (peak, live_peak, 0)
}

fn rebuild<S: Slots>(store: &mut Linked<S>, q: u32, deps: &[u32]) {
    let mut e = store.first(0, q);
    while e != S::NIL {
        let n = store.s.link(e, 1);
        store.unlink(e);
        e = n;
    }
    for d in deps {
        store.relate(q, *d, 0);
    }
}

fn reconcile<S: Slots>(store: &mut Linked<S>, map: &mut HashMap<u32, S::Id>, q: u32, deps: &[u32]) {
    let wanted: std::collections::HashSet<u32> = deps.iter().copied().collect();
    let dead: Vec<u32> = map.keys().filter(|k| !wanted.contains(k)).copied().collect();
    for k in dead {
        let id = map.remove(&k).unwrap();
        store.unlink(id);
    }
    let mut cursor = S::NIL;
    for d in deps {
        let id = match map.get(d) {
            Some(id) => *id,
            None => { let id = store.relate(q, *d, 0); map.insert(*d, id); id }
        };
        let expected = if cursor == S::NIL { store.first(0, q) } else { store.next(0, cursor) };
        if expected != id {
            store.move_after(0, id, cursor);
        }
        cursor = id;
    }
}

/// Reuse as trackers actually do it: walk the old list against the new sequence and touch a hash
/// only for what is left after the first mismatch. Keeps no persistent map.
fn reconcile_cursor<S: Slots>(store: &mut Linked<S>, q: u32, deps: &[u32]) {
    let mut e = store.first(0, q);
    let mut cursor = S::NIL;
    let mut i = 0;
    while i < deps.len() && e != S::NIL && store.s.endpoint(e, true) == deps[i] {
        cursor = e;
        e = store.next(0, e);
        i += 1;
    }
    if i == deps.len() {
        while e != S::NIL {
            let n = store.s.link(e, 1);
            store.unlink(e);
            e = n;
        }
        return;
    }
    let mut rest: HashMap<u32, S::Id> = HashMap::new();
    while e != S::NIL {
        rest.insert(store.s.endpoint(e, true), e);
        e = store.next(0, e);
    }
    let wanted: std::collections::HashSet<u32> = deps[i..].iter().copied().collect();
    let dead: Vec<u32> = rest.keys().filter(|k| !wanted.contains(k)).copied().collect();
    for k in dead {
        let id = rest.remove(&k).unwrap();
        store.unlink(id);
    }
    for d in &deps[i..] {
        let id = match rest.get(d) {
            Some(id) => *id,
            None => store.relate(q, *d, 0),
        };
        let expected = if cursor == S::NIL { store.first(0, q) } else { store.next(0, cursor) };
        if expected != id {
            store.move_after(0, id, cursor);
        }
        cursor = id;
    }
}

/// Prefix reuse with no hash: keep what matches in place, unlink the rest, append the new tail.
fn reconcile_tail<S: Slots>(store: &mut Linked<S>, q: u32, deps: &[u32]) {
    let mut e = store.first(0, q);
    let mut i = 0;
    while i < deps.len() && e != S::NIL && store.s.endpoint(e, true) == deps[i] {
        e = store.next(0, e);
        i += 1;
    }
    while e != S::NIL {
        let n = store.s.link(e, 1);
        store.unlink(e);
        e = n;
    }
    for d in &deps[i..] {
        store.relate(q, *d, 0);
    }
}

// WPF-shaped work: membership with copy-on-write versions during delivery.

enum W {
    Program,
    Write(u32),
    Add(u32, u32),
    Remove(u32, u32),
    Begin(u32),
    End(u32),
}

fn parse_wpf(text: &str) -> Vec<W> {
    let mut out = Vec::new();
    for line in text.lines() {
        let mut p = line.split(' ');
        let k = p.next().unwrap_or("");
        let mut n = || p.next().unwrap().parse::<u32>().unwrap();
        out.push(match k {
            "P" => W::Program,
            "W" => W::Write(n()),
            "A" => { let (a, b) = (n(), n()); W::Add(a, b) }
            "D" => { let (a, b) = (n(), n()); W::Remove(a, b) }
            "B" => W::Begin(n()),
            "E" => W::End(n()),
            _ => continue,
        });
    }
    out
}

const WPF_SOURCES: usize = 32;

fn wpf_cow(tape: &[W]) -> (u64, u64, u64) {
    #[derive(Default)]
    struct List { items: Vec<u32>, users: u32 }
    let (mut peak, mut live_peak, mut sum) = (0u64, 0u64, 0u64);
    let mut current: Vec<usize> = Vec::new();
    let mut versions: Vec<List> = Vec::new();
    let mut stacks: Vec<Vec<usize>> = Vec::new();
    let mut live = 0i64;
    let mut pl = 0i64;
    let mut base = mark();
    for op in tape {
        match op {
            W::Program => {
                peak += PEAK.load(Relaxed).saturating_sub(base);
                live_peak += pl as u64;
                versions = Vec::new();
                current = Vec::new();
                stacks = Vec::new();
                base = mark();
                versions = (0..WPF_SOURCES).map(|_| List::default()).collect();
                current = (0..WPF_SOURCES).collect();
                stacks = vec![Vec::new(); WPF_SOURCES];
                live = 0;
                pl = 0;
            }
            W::Write(s) => {
                let c = current[*s as usize];
                if versions[c].users > 0 {
                    let items = versions[c].items.clone();
                    versions.push(List { items, users: 0 });
                    current[*s as usize] = versions.len() - 1;
                }
            }
            W::Add(s, l) => { let c = current[*s as usize]; versions[c].items.push(*l); live += 1; pl = pl.max(live); }
            W::Remove(s, i) => {
                let c = current[*s as usize];
                if (*i as usize) < versions[c].items.len() { versions[c].items.remove(*i as usize); live -= 1; }
            }
            W::Begin(s) => {
                let c = current[*s as usize];
                versions[c].users += 1;
                stacks[*s as usize].push(c);
                for x in &versions[c].items { sum = sum.wrapping_add(*x as u64); }
            }
            W::End(s) => {
                let c = stacks[*s as usize].pop().unwrap();
                versions[c].users -= 1;
                if versions[c].users == 0 && c != current[*s as usize] {
                    versions[c].items = Vec::new();
                }
            }
        }
    }
    peak += PEAK.load(Relaxed).saturating_sub(base);
    black_box(sum);
    (peak, live_peak + pl as u64, 0)
}

fn wpf_store<S: Slots>(tape: &[W]) -> (u64, u64, u64) {
    let (mut peak, mut live_peak, mut sum) = (0u64, 0u64, 0u64);
    let mut store = Linked::<S>::new();
    let mut users = vec![0u32; WPF_SOURCES];
    let mut frozen: Vec<Vec<Vec<u32>>> = vec![Vec::new(); WPF_SOURCES];
    let mut base = mark();
    for op in tape {
        match op {
            W::Program => {
                peak += PEAK.load(Relaxed).saturating_sub(base);
                live_peak += store.peak_live;
                store.clear();
                store = Linked::new();
                users = Vec::new();
                frozen = Vec::new();
                base = mark();
                store.nodes(WPF_SOURCES + 64);
                users = vec![0; WPF_SOURCES];
                frozen = vec![Vec::new(); WPF_SOURCES];
            }
            W::Write(s) => {
                if users[*s as usize] > 0 {
                    let mut items = Vec::new();
                    let mut e = store.first(1, *s);
                    while e != S::NIL {
                        items.push(store.s.endpoint(e, false));
                        e = store.next(1, e);
                    }
                    frozen[*s as usize].push(items);
                }
            }
            W::Add(s, l) => { store.relate(WPF_SOURCES as u32 + (*l % 64), *s, 0); }
            W::Remove(s, i) => {
                let mut e = store.first(1, *s);
                let mut k = 0;
                while e != S::NIL && k < *i { e = store.next(1, e); k += 1; }
                if e != S::NIL { store.unlink(e); }
            }
            W::Begin(s) => {
                users[*s as usize] += 1;
                let mut e = store.first(1, *s);
                while e != S::NIL {
                    sum = sum.wrapping_add(store.s.endpoint(e, false) as u64);
                    e = store.next(1, e);
                }
            }
            W::End(s) => {
                users[*s as usize] -= 1;
                if users[*s as usize] == 0 { frozen[*s as usize].clear(); }
            }
        }
    }
    peak += PEAK.load(Relaxed).saturating_sub(base);
    live_peak += store.peak_live;
    store.clear();
    black_box(sum);
    (peak, live_peak, 0)
}

// ---- synthetic extremes --------------------------------------------------------------------

fn rng(s: &mut u64) -> u64 {
    *s ^= *s << 13;
    *s ^= *s >> 7;
    *s ^= *s << 17;
    *s
}

/// Graph-shaped: fan-in and fan-out walks over a wide bipartite graph, with churn and moves.
fn synthetic_graph(nodes: u32, degree: u32, rounds: u32, churn_pct: u64) -> Vec<G> {
    let mut s = 0x9e3779b97f4a7c15u64;
    let mut ops = vec![G::Program];
    ops.extend((0..nodes * 2).map(|_| G::Node));
    let mut slots: Vec<(u32, u32)> = Vec::new();
    for c in 0..nodes {
        for _ in 0..degree {
            let p = nodes + (rng(&mut s) % nodes as u64) as u32;
            ops.push(G::Relate(c, p));
            slots.push((slots.len() as u32, c));
        }
    }
    let mut next_id = slots.len() as u32;
    for _ in 0..rounds {
        for _ in 0..nodes {
            ops.push(G::First(1, nodes + (rng(&mut s) % nodes as u64) as u32));
            ops.push(G::First(0, (rng(&mut s) % nodes as u64) as u32));
        }
        for i in 0..slots.len() {
            ops.push(G::Next((i % 2) as u8, slots[i].0));
            ops.push(G::End(1, slots[i].0));
        }
        for i in 0..slots.len() {
            if rng(&mut s) % 100 < churn_pct {
                let (id, c) = slots[i];
                ops.push(G::Unlink(id));
                ops.push(G::Relate(c, nodes + (rng(&mut s) % nodes as u64) as u32));
                slots[i] = (next_id, c);
                next_id += 1;
            }
        }
    }
    ops
}

// ---- M5C: rebuild against reuse --------------------------------------------------------------

fn transition(n: usize, survive: f64, order: u8, seed: u64) -> (Vec<u32>, Vec<u32>) {
    let mut s = seed | 1;
    let a: Vec<u32> = (0..n as u32).collect();
    let kept = (n as f64 * survive).round() as usize;
    let mut b: Vec<u32> = (0..kept as u32).collect();
    b.extend((0..(n - kept) as u32).map(|i| n as u32 + i));
    match order {
        1 => for i in (1..kept).step_by(10) { b.swap(i - 1, i); },
        2 => for i in (1..kept).rev() { let j = (rng(&mut s) % (i as u64 + 1)) as usize; b.swap(i, j); },
        _ => {}
    }
    (a, b)
}

/// Reads arrive one at a time, as a tracker receives them, so the copy cannot become a memcpy of a
/// sequence that is already contiguous. Exactly sized allocation per execution.
fn cross_rebuild_packed(a: &[u32], b: &[u32], reps: usize) -> f64 {
    let mut memo: Box<[u32]> = a.to_vec().into_boxed_slice();
    let mut scratch: Vec<u32> = Vec::new();
    let t = Instant::now();
    for i in 0..reps {
        let deps = if i % 2 == 0 { b } else { a };
        scratch.clear();
        for d in deps { scratch.push(black_box(*d)); }
        memo = scratch.as_slice().into();
        black_box(&memo);
    }
    t.elapsed().as_nanos() as f64 / (reps * b.len().max(1)) as f64
}

/// The contiguous form without a fresh allocation: each read compared at its position and written
/// only on a difference. Available to a single-threaded tracker that owns the old trace.
fn cross_packed_inplace(a: &[u32], b: &[u32], reps: usize) -> f64 {
    let mut memo: Vec<u32> = a.to_vec();
    let t = Instant::now();
    for i in 0..reps {
        let deps = if i % 2 == 0 { b } else { a };
        let mut at = 0;
        for d in deps {
            let d = black_box(*d);
            if at < memo.len() {
                if memo[at] != d { memo[at] = d; }
            } else {
                memo.push(d);
            }
            at += 1;
        }
        memo.truncate(at);
        black_box(&memo);
    }
    t.elapsed().as_nanos() as f64 / (reps * b.len().max(1)) as f64
}

fn cross_cursor<S: Slots>(a: &[u32], b: &[u32], reps: usize) -> f64 {
    let mut store = Linked::<S>::new();
    store.nodes(2 * a.len() + 2);
    let q = 2 * a.len() as u32 + 1;
    reconcile_cursor(&mut store, q, a);
    let t = Instant::now();
    for i in 0..reps {
        let deps = if i % 2 == 0 { b } else { a };
        reconcile_cursor(&mut store, q, deps);
    }
    let ns = t.elapsed().as_nanos() as f64 / (reps * b.len().max(1)) as f64;
    store.clear();
    ns
}

fn cross_tail<S: Slots>(a: &[u32], b: &[u32], reps: usize) -> f64 {
    let mut store = Linked::<S>::new();
    store.nodes(2 * a.len() + 2);
    let q = 2 * a.len() as u32 + 1;
    reconcile_tail(&mut store, q, a);
    let t = Instant::now();
    for i in 0..reps {
        let deps = if i % 2 == 0 { b } else { a };
        reconcile_tail(&mut store, q, deps);
    }
    let ns = t.elapsed().as_nanos() as f64 / (reps * b.len().max(1)) as f64;
    store.clear();
    ns
}

fn cross_persistent(a: &[u32], b: &[u32], reps: usize) -> f64 {
    let mut list = a.to_vec();
    let mut map: HashMap<u32, u32> = a.iter().enumerate().map(|(i, d)| (*d, i as u32)).collect();
    let t = Instant::now();
    for i in 0..reps {
        let deps = if i % 2 == 0 { b } else { a };
        let wanted: std::collections::HashSet<u32> = deps.iter().copied().collect();
        map.retain(|k, _| wanted.contains(k));
        for (p, d) in deps.iter().enumerate() {
            map.insert(*d, p as u32);
            if list.get(p) != Some(d) {
                if p < list.len() { list[p] = *d } else { list.push(*d) }
            }
        }
        list.truncate(deps.len());
        black_box(&list);
    }
    t.elapsed().as_nanos() as f64 / (reps * b.len().max(1)) as f64
}

fn cross_linked<S: Slots>(a: &[u32], b: &[u32], reps: usize, reuse: bool) -> f64 {
    let mut store = Linked::<S>::new();
    store.nodes(2 * a.len() + 2);
    let q = 2 * a.len() as u32 + 1;
    let mut map: HashMap<u32, S::Id> = HashMap::new();
    if reuse { reconcile(&mut store, &mut map, q, a) } else { rebuild(&mut store, q, a) }
    let t = Instant::now();
    for i in 0..reps {
        let deps = if i % 2 == 0 { b } else { a };
        if reuse { reconcile(&mut store, &mut map, q, deps) } else { rebuild(&mut store, q, deps) }
    }
    let ns = t.elapsed().as_nanos() as f64 / (reps * b.len().max(1)) as f64;
    store.clear();
    ns
}

// ---- output ----------------------------------------------------------------------------------

fn row(out: &mut String, section: &str, workload: &str, rep: &str, m: &Measured) {
    let live = m.peak_live_sum.max(1) as f64;
    println!("{section:6} {workload:16} {rep:22} bytes/rel {:8.1}  ns/op {:8.2}  allocs/op {:6.3}", m.peak_sum as f64 / live, m.ns / m.ops.max(1) as f64, m.allocs / m.ops.max(1) as f64);
    let _ = write!(out, "{{\"section\":\"{section}\",\"workload\":\"{workload}\",\"rep\":\"{rep}\",\"peak_bytes\":{},\"peak_live\":{},\"ns_per_op\":{:.3},\"allocs_per_op\":{:.4}}},\n", m.peak_sum, m.peak_live_sum, m.ns / m.ops.max(1) as f64, m.allocs / m.ops.max(1) as f64);
}

/// Visits 0..count starting from an offset that changes with the run, so that no representation
/// always runs first in a fresh process or last on a fragmented heap.
fn in_rotated_order(count: usize, mut f: impl FnMut(usize)) {
    let start = std::env::var("M5_ROTATE").ok().and_then(|v| v.parse::<usize>().ok()).unwrap_or(0) % count;
    for i in 0..count {
        f((start + i) % count);
    }
}

fn graph_workload(out: &mut String, name: &str, ops: &[G], repeats: usize) {
    let n = ops.len() as u64;
    in_rotated_order(3, |k| match k {
        0 => row(out, "graph", name, ClientIntrusive::NAME, &timed(n, repeats, || replay_graph::<ClientIntrusive>(ops))),
        1 => row(out, "graph", name, StoreAos::NAME, &timed(n, repeats, || replay_graph::<StoreAos>(ops))),
        _ => row(out, "graph", name, StoreSoa::NAME, &timed(n, repeats, || replay_graph::<StoreSoa>(ops))),
    });
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = &args[1];
    if args.get(2).map(String::as_str) == Some("dump") {
        dump_graph(&synthetic_graph(20000, 16, 8, 1), &format!("{dir}/synthetic-calm.tape"));
        dump_graph(&synthetic_graph(20000, 16, 8, 40), &format!("{dir}/synthetic-churn.tape"));
        return;
    }
    let mut out = String::from("[\n");

    for (name, repeats) in [("alien", 15), ("polyfill", 15), ("quant", 5)] {
        let text = std::fs::read_to_string(format!("{dir}/{name}.tape")).unwrap();
        if text.is_empty() { println!("{name}: empty tape"); continue; }
        let ops = sanitize(parse_graph(&text));
        drop(text);
        graph_workload(&mut out, name, &ops, repeats);
    }
    for (label, churn, rounds) in [("synthetic-calm", 1, 8), ("synthetic-churn", 40, 8)] {
        let ops = synthetic_graph(20000, 16, rounds, churn);
        graph_workload(&mut out, label, &ops, 5);
    }

    let tape = parse_trace(&std::fs::read_to_string(format!("{dir}/salsa.tape")).unwrap());
    let n = tape.len() as u64;
    let w = "salsa";
    in_rotated_order(10, |k| match k {
        0 => row(&mut out, "trace", w, "TracePacked", &timed(n, 15, || trace_packed(&tape))),
        1 => row(&mut out, "trace", w, "TracePersistent", &timed(n, 15, || trace_persistent(&tape))),
        2 => row(&mut out, "trace", w, "ClientIntrusive rebuild", &timed(n, 15, || trace_linked::<ClientIntrusive>(&tape, REBUILD))),
        3 => row(&mut out, "trace", w, "ClientIntrusive reuse", &timed(n, 15, || trace_linked::<ClientIntrusive>(&tape, HASH))),
        4 => row(&mut out, "trace", w, "ClientIntrusive cursor", &timed(n, 15, || trace_linked::<ClientIntrusive>(&tape, CURSOR))),
        5 => row(&mut out, "trace", w, "StoreAoS rebuild", &timed(n, 15, || trace_linked::<StoreAos>(&tape, REBUILD))),
        6 => row(&mut out, "trace", w, "StoreAoS reuse", &timed(n, 15, || trace_linked::<StoreAos>(&tape, HASH))),
        7 => row(&mut out, "trace", w, "StoreAoS cursor", &timed(n, 15, || trace_linked::<StoreAos>(&tape, CURSOR))),
        8 => row(&mut out, "trace", w, "StoreSoA rebuild", &timed(n, 15, || trace_linked::<StoreSoa>(&tape, REBUILD))),
        _ => row(&mut out, "trace", w, "StoreSplit rebuild", &timed(n, 15, || trace_linked::<StoreSplit>(&tape, REBUILD))),
    });

    let tape = parse_wpf(&std::fs::read_to_string(format!("{dir}/wpf.tape")).unwrap());
    let n = tape.len() as u64;
    let w = "wpf";
    in_rotated_order(4, |k| match k {
        0 => row(&mut out, "cow", w, "WpfCow", &timed(n, 15, || wpf_cow(&tape))),
        1 => row(&mut out, "cow", w, "ClientIntrusive freeze", &timed(n, 15, || wpf_store::<ClientIntrusive>(&tape))),
        2 => row(&mut out, "cow", w, "StoreAoS freeze", &timed(n, 15, || wpf_store::<StoreAos>(&tape))),
        _ => row(&mut out, "cow", w, "StoreSoA freeze", &timed(n, 15, || wpf_store::<StoreSoa>(&tape))),
    });

    println!("\nM5C ns per trace entry; reps chosen so each cell does about 2M entries");
    println!("{:>7} {:>6} {:>8} | {:>9} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9}", "N", "surv", "order", "packed", "inplace", "persist", "intr-reb", "intr-reu", "aos-reu", "intr-cur", "aos-cur");
    for n in [8usize, 64, 512, 4096, 65536] {
        for survive in [0.0, 0.5, 0.9, 1.0] {
            for order in [0u8, 1, 2] {
                let (a, b) = transition(n, survive, order, 42 + n as u64);
                let reps = ((2_000_000 / n).max(4) / 2) * 2;
                let mut cells = [0f64; 10];
                in_rotated_order(10, |k| cells[k] = match k {
                    0 => median3(|| cross_rebuild_packed(&a, &b, reps)),
                    1 => median3(|| cross_packed_inplace(&a, &b, reps)),
                    2 => median3(|| cross_persistent(&a, &b, reps)),
                    3 => median3(|| cross_linked::<ClientIntrusive>(&a, &b, reps, false)),
                    4 => median3(|| cross_linked::<ClientIntrusive>(&a, &b, reps, true)),
                    5 => median3(|| cross_linked::<StoreAos>(&a, &b, reps, true)),
                    6 => median3(|| cross_cursor::<ClientIntrusive>(&a, &b, reps)),
                    7 => median3(|| cross_cursor::<StoreAos>(&a, &b, reps)),
                    8 => median3(|| cross_tail::<ClientIntrusive>(&a, &b, reps)),
                    _ => median3(|| cross_tail::<StoreAos>(&a, &b, reps)),
                });
                let name = ["none", "local", "chaotic"][order as usize];
                println!("{n:>7} {survive:>6.2} {name:>8} | {:>9.2} {:>9.2} {:>9.2} {:>9.2} {:>9.2} {:>9.2} {:>9.2} {:>9.2}", cells[0], cells[1], cells[2], cells[3], cells[4], cells[5], cells[6], cells[7]);
                let _ = write!(out, "{{\"section\":\"crossover\",\"n\":{n},\"survive\":{survive},\"order\":\"{name}\",\"packed\":{:.3},\"packed_inplace\":{:.3},\"persistent\":{:.3},\"intrusive_rebuild\":{:.3},\"intrusive_reuse\":{:.3},\"aos_reuse\":{:.3},\"intrusive_cursor\":{:.3},\"aos_cursor\":{:.3},\"intrusive_tail\":{:.3},\"aos_tail\":{:.3}}},\n", cells[0], cells[1], cells[2], cells[3], cells[4], cells[5], cells[6], cells[7], cells[8], cells[9]);
            }
        }
    }
    out.push_str("{}]\n");
    std::fs::write(&args[2], out).unwrap();
}

fn median3<F: FnMut() -> f64>(mut f: F) -> f64 {
    let mut v = [f(), f(), f()];
    v.sort_by(f64::total_cmp);
    v[1]
}

fn dump_graph(ops: &[G], file: &str) {
    use std::io::Write;
    let mut w = std::io::BufWriter::new(std::fs::File::create(file).unwrap());
    for op in ops {
        match *op {
            G::Program => writeln!(w, "P"),
            G::Node => writeln!(w, "N"),
            G::Relate(a, b) => writeln!(w, "R {a} {b}"),
            G::Unlink(e) => writeln!(w, "U {e}"),
            G::Move(a, e, c) => writeln!(w, "M {a} {e} {}", c as i32),
            G::First(a, n) => writeln!(w, "F {a} {n}"),
            G::Next(a, e) => writeln!(w, "X {a} {e}"),
            G::End(a, e) => writeln!(w, "E {a} {e}"),
            G::Enter => writeln!(w, "B"),
            G::Exit => writeln!(w, "C"),
        }.unwrap();
    }
}
