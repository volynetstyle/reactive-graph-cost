// Derives the port from the frozen polyfill sources, so that the whole difference
// is the list of rules below.
//
//   node adapters/polyfill/derive.mjs           writes adapters/polyfill/src
//   node adapters/polyfill/derive.mjs --check   fails if they differ
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const frozen = path.resolve(here, "../../.cache/signal-polyfill-fba09f8/src");
const VERBATIM = ["computed.ts", "equality.ts", "errors.ts", "index.ts", "public-api-types.ts", "signal.ts"];

const SITES = {
  "graph.ts": [
    ["// Required as the signals library is in a separate package,", `import {
  beginActivation,
  beginDeactivation,
  clearLiveConsumers,
  endActivation,
  endDeactivation,
  liveConsumerAt,
  liveConsumerCount,
  noteConsumer,
  relateLive,
  removeLiveConsumer,
  traceOnly,
  type Relation,
} from './backend.js';

// Required as the signals library is in a separate package,`],
    ["  liveConsumerNode: undefined,\n  liveConsumerIndexOfThis: undefined,\n", ""],
    ["  producerIndexOfThis: number[] | undefined;\n", "  producerIndexOfThis: (Relation | undefined)[] | undefined;\n"],
    [`  /**
   * Array of consumers of this producer that are "live" (they require push notifications).
   *
   * \`liveConsumerNode.length\` is effectively our reference count for this node.
   */
  liveConsumerNode: ReactiveNode[] | undefined;

  /**
   * Index of \`this\` (producer) in each consumer's \`producerNode\` array.
   *
   * Uses the same indices as the \`liveConsumerNode\` array.
   */
  liveConsumerIndexOfThis: number[] | undefined;

`, ""],
    ["interface ProducerNode extends ReactiveNode {\n  liveConsumerNode: NonNullable<ReactiveNode['liveConsumerNode']>;\n  liveConsumerIndexOfThis: NonNullable<ReactiveNode['liveConsumerIndexOfThis']>;\n}", "interface ProducerNode extends ReactiveNode {}"],
    ["  activeConsumer.consumerOnSignalRead(node);\n", "  noteConsumer(activeConsumer);\n  activeConsumer.consumerOnSignalRead(node);\n"],
    ["      ? producerAddLiveConsumer(node, activeConsumer, idx)\n      : 0;", "      ? producerAddLiveConsumer(node, activeConsumer)\n      : traceOnly();"],
    ["  if (node.liveConsumerNode === undefined) {\n    return;\n  }\n\n  // Prevent signal reads", "  // Prevent signal reads"],
    ["    for (const consumer of node.liveConsumerNode) {\n      if (!consumer.dirty) {", "    for (let i = 0; ; i++) {\n      const consumer = liveConsumerAt(node, i);\n      if (consumer === undefined) break;\n      if (!consumer.dirty) {"],
    ["  if (node.liveConsumerNode) {\n    node.liveConsumerNode.length = node.liveConsumerIndexOfThis!.length = 0;\n  }\n", "  clearLiveConsumers(node);\n"],
    [/function producerAddLiveConsumer\([\s\S]*?\n}\n/, `function producerAddLiveConsumer(node: ReactiveNode, consumer: ReactiveNode): Relation {
  assertProducerNode(node);
  assertConsumerNode(node);
  if (liveConsumerCount(node) === 0) {
    node.watched?.call(node.wrapper);
    // When going from 0 to 1 live consumers, we become a live consumer to our producers.
    beginActivation();
    for (let i = 0; i < node.producerNode.length; i++) {
      node.producerIndexOfThis[i] = producerAddLiveConsumer(node.producerNode[i], node);
    }
    endActivation();
  }
  return relateLive(consumer, node);
}
`],
    [/export function producerRemoveLiveConsumerAtIndex\([\s\S]*?\n}\n/, `export function producerRemoveLiveConsumerAtIndex(node: ReactiveNode, relation: Relation): void {
  assertProducerNode(node);
  assertConsumerNode(node);

  if (liveConsumerCount(node) === 1) {
    // When removing the last live consumer, we will no longer be live. We need to remove
    // ourselves from our producers' tracking (which may cause consumer-producers to lose
    // liveness as well).
    node.unwatched?.call(node.wrapper);
    beginDeactivation();
    for (let i = 0; i < node.producerNode.length; i++) {
      producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]!);
    }
    endDeactivation();
  }

  removeLiveConsumer(node, relation);
}
`],
    ["  return node.consumerIsAlwaysLive || (node?.liveConsumerNode?.length ?? 0) > 0;", "  return node.consumerIsAlwaysLive || liveConsumerCount(node) > 0;"],
    ["  node.liveConsumerNode ??= [];\n  node.liveConsumerIndexOfThis ??= [];\n", "  void node;\n"],
    ["      producerRemoveLiveConsumerAtIndex(staleProducer, activeConsumer.producerIndexOfThis[idx]);", "      producerRemoveLiveConsumerAtIndex(staleProducer, activeConsumer.producerIndexOfThis[idx]!);"],
    ["      producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);\n    }\n  }\n\n  // Truncate the producer tracking arrays.", "      producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]!);\n    }\n  }\n\n  // Truncate the producer tracking arrays."],
    ["      producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);\n    }\n  }\n\n  // Truncate all the arrays", "      producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]!);\n    }\n  }\n\n  // Truncate all the arrays"],
  ],
  "wrapper.ts": [
    ["import {createSignal, signalGetFn, signalSetFn, type SignalNode} from './signal.js';\n", "import {createSignal, signalGetFn, signalSetFn, type SignalNode} from './signal.js';\nimport {liveConsumerCount, liveConsumers} from './backend.js';\n"],
    ["      return signal[NODE].liveConsumerNode?.map((n) => n.wrapper) ?? [];", "      return liveConsumers(signal[NODE]).map((n) => n.wrapper);"],
    ["      const liveConsumerNode = signal[NODE].liveConsumerNode;\n      if (!liveConsumerNode) return false;\n      return liveConsumerNode.length > 0;", "      return liveConsumerCount(signal[NODE]) > 0;"],
    ["            producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);", "            producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]!);"],
    ["\n            if (i < node.producerNode.length) {\n              const idxConsumer = node.producerIndexOfThis[i];\n              const producer = node.producerNode[i];\n              assertProducerNode(producer);\n              producer.liveConsumerIndexOfThis[idxConsumer] = i;\n            }\n", "\n"],
    ["  type ReactiveNode,\n  assertProducerNode,\n", "  type ReactiveNode,\n"],
  ],
};

function derive(file) {
  let text = readFileSync(path.join(frozen, file), "utf8").replaceAll("\r\n", "\n");
  for (const [find, replace] of SITES[file]) {
    const count = typeof find === "string" ? text.split(find).length - 1 : (text.match(find) ?? []).length;
    if (count < 1 || (typeof find === "string" && count !== 1)) throw new Error(`${file}: ${count} matches: ${find}`);
    text = text.replace(find, () => replace);
  }
  return `// Derived from signal-polyfill@fba09f8 by adapters/polyfill/derive.mjs. Do not edit.\n${text}`;
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
for (const file of VERBATIM) {
  const source = readFileSync(path.join(frozen, file), "utf8").replaceAll("\r\n", "\n");
  const target = path.join(here, "src", file);
  if (check) {
    if (readFileSync(target, "utf8") !== source) throw new Error(`${file} is meant to be verbatim`);
  } else {
    writeFileSync(target, source);
  }
}
console.log(check ? "port matches its derivation" : "port derived");
