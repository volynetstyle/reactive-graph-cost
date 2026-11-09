// M4B.2 executable oracle. Interprets programs over Salsa inputs and one tracked function,
// and logs what Salsa reports. Programs carry no expected results.
// Usage: salsa-oracle programs.json output.json
use salsa::plumbing::AsId;
use salsa::{Database, Setter, Storage};
use serde::Deserialize;
use std::cell::RefCell;
use std::collections::HashMap;

#[derive(Deserialize, Clone)]
struct When {
    cell: usize,
    eq: i32,
}

#[derive(Deserialize, Clone)]
struct Step {
    when: Option<When>,
    cell: Option<usize>,
    query: Option<usize>,
}

#[derive(Deserialize, Clone)]
struct Query {
    steps: Vec<Step>,
    modulo: Option<i32>,
}

#[derive(Deserialize)]
struct Op {
    kind: String,
    i: usize,
    v: Option<i32>,
}

#[derive(Deserialize)]
struct Program {
    name: String,
    cells: usize,
    queries: Vec<Query>,
    ops: Vec<Op>,
}

#[salsa::input]
struct Cell {
    value: i32,
}

// Never read, so a key adds no edge to any trace. Its identity is the query's key.
#[salsa::input]
struct Key {
    unused: u32,
}

#[salsa::db]
#[derive(Clone)]
struct Db {
    storage: Storage<Self>,
}

#[salsa::db]
impl Database for Db {}

#[derive(Default)]
struct World {
    log: Vec<String>,
    cells: Vec<Cell>,
    keys: Vec<Key>,
    index: HashMap<salsa::Id, usize>,
    queries: Vec<Query>,
}

thread_local! {
    static WORLD: RefCell<World> = RefCell::new(World::default());
}

fn new_db() -> Db {
    let callback = |event: salsa::Event| {
        let (verb, key) = match event.kind {
            salsa::EventKind::DidValidateMemoizedValue { database_key } => ("validate", database_key),
            salsa::EventKind::WillExecute { database_key } => ("execute", database_key),
            _ => return,
        };
        WORLD.with(|w| {
            let mut w = w.borrow_mut();
            let i = w.index[&key.key_index()];
            w.log.push(format!("{verb}:q{i}"));
        });
    };
    Db { storage: Storage::new(Some(Box::new(callback))) }
}

#[salsa::tracked]
fn query(db: &dyn Database, key: Key) -> i32 {
    let (query, cells, keys) = WORLD.with(|w| {
        let w = w.borrow();
        (w.queries[w.index[&key.as_id()]].clone(), w.cells.clone(), w.keys.clone())
    });
    let mut sum = 0;
    for step in &query.steps {
        if let Some(when) = &step.when {
            if *cells[when.cell].value(db) != when.eq {
                continue;
            }
        }
        if let Some(c) = step.cell {
            sum += cells[c].value(db);
        }
        if let Some(q) = step.query {
            sum += crate::query(db, keys[q]);
        }
    }
    match query.modulo {
        Some(m) => sum.rem_euclid(m),
        None => sum,
    }
}

fn run(program: &Program) -> Vec<String> {
    let mut db = new_db();
    let cells: Vec<Cell> = (0..program.cells).map(|_| Cell::new(&db, 0)).collect();
    let keys: Vec<Key> = program.queries.iter().map(|_| Key::new(&db, 0)).collect();
    WORLD.with(|w| {
        let mut w = w.borrow_mut();
        *w = World::default();
        w.cells = cells.clone();
        w.keys = keys.clone();
        w.queries = program.queries.clone();
        for (i, k) in keys.iter().enumerate() {
            w.index.insert(k.as_id(), i);
        }
    });
    let push = |line: String| WORLD.with(|w| w.borrow_mut().log.push(line));
    for op in &program.ops {
        match op.kind.as_str() {
            "set" => {
                let v = op.v.unwrap();
                cells[op.i].set_value(&mut db).to(v);
                push(format!("set:c{}={v}", op.i));
            }
            "get" => {
                let v = query(&db, keys[op.i]);
                push(format!("get:q{}={v}", op.i));
            }
            other => panic!("unknown op {other}"),
        }
    }
    WORLD.with(|w| std::mem::take(&mut w.borrow_mut().log))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let programs: Vec<Program> = serde_json::from_str(&std::fs::read_to_string(&args[1]).unwrap()).unwrap();
    let results: Vec<serde_json::Value> = programs
        .iter()
        .map(|p| serde_json::json!({ "name": p.name, "log": run(p) }))
        .collect();
    std::fs::write(&args[2], serde_json::to_string(&serde_json::json!({ "results": results })).unwrap()).unwrap();
    println!("{} programs", results.len());
}
