// Literal behaviour of quant-main@241a3b7 when a walk holds an edge across user
// code. Copied next to the corpus by sync-corpus.mjs and run unchanged on the
// original and on the port. These record what the representation does, not what
// Quant's contract requires.
import { expect, it } from "vitest";
import { computed, dispose, get, set, signal } from "../src/index";

it("W1: a source disposes the validating reader; the walk continues through cut edges", () => {
  const a = signal(0);
  let doomed: Parameters<typeof get>[0] | null = null;
  let xRuns = 0;
  const s = computed(() => {
    if (get(a) === 1) dispose(doomed as never);
    return 7;
  });
  const x = computed(() => {
    xRuns++;
    return get(a) * 0;
  });
  const n = computed(() => get(s) + get(x));
  doomed = n;
  expect(get(n)).toBe(7);
  xRuns = 0;

  set(a, 1);

  expect(get(n)).toBe(7);
  expect(xRuns).toBe(1);
});

it("W2: a source disposes the validating reader and changes value", () => {
  const a = signal(0);
  let doomed: Parameters<typeof get>[0] | null = null;
  const s = computed(() => {
    const v = get(a);
    if (v === 1) dispose(doomed as never);
    return v;
  });
  const n = computed(() => get(s));
  doomed = n;
  get(n);

  set(a, 1);

  expect(() => get(n)).toThrow(TypeError);
});

it("W3: a source re-runs the validating reader, whose new run drops the walked suffix", () => {
  const a = signal(0);
  const b = signal(0);
  const y = signal(5);
  let reader: Parameters<typeof get>[0] | null = null;
  let xRuns = 0;
  const s = computed(() => {
    if (get(a) === 1) {
      set(b, 1);
      get(reader as never);
    }
    return 7;
  });
  const x = computed(() => {
    xRuns++;
    return get(a) * 0;
  });
  const n = computed(() => (get(b) === 1 ? get(y) : get(s) + get(x)));
  reader = n;
  expect(get(n)).toBe(7);
  xRuns = 0;

  set(a, 1);

  expect(get(n)).toBe(5);
  expect(xRuns).toBe(1);
});
