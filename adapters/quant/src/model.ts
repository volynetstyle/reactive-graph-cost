// Compile-time vocabulary of the port. An edge is now a store handle; a node
// keeps only client-local state. Relation state lives behind ./backend.
import type { NodeId, RelationId } from "../../../reference/machine.ts";

export type Flags = number;
export type Version = number;
export type Generation = number;

export type Fn = (prev: unknown) => unknown;
export type Cleanup = () => unknown;

export type Edge = RelationId;

export class QuantNode {
  flags: Flags;
  value: unknown;
  /** Bumps on every Object.is-visible change of value. */
  ver: Version;
  /** null for a signal and for a disposed node. */
  fn: Fn | null;
  /** The running pass's last accepted source edge. */
  last: Edge | null;
  /** While a reader indexes: this node's edge into that reader. */
  slot: Edge | null;
  /** Successful runs; edges born since the last one are tentative. */
  gen: Generation;
  /** Host binding: Node to NodeId. */
  id: NodeId;

  constructor(fn: Fn | null, value: unknown, flags: Flags, id: NodeId) {
    this.flags = flags;
    this.value = value;
    this.ver = 0;
    this.fn = fn;
    this.last = null;
    this.slot = null;
    this.gen = 0;
    this.id = id;
  }
}

export type Node = QuantNode;

/** Shared LIFO of the kernel's walks: edges, and (source, cell) pairs. */
export type WorkStack = (Node | Edge | null)[];
