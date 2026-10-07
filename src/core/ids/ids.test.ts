import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  compareIds,
  ENTITY_KINDS,
  type EntityKind,
  IdAllocator,
  isId,
  kindOf,
  makeId,
  parseId,
} from "./index.ts";

const kind = fc.constantFrom(...ENTITY_KINDS);
const n = fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER });

describe("ids", () => {
  it("makeId y parseId son inversos", () => {
    fc.assert(
      fc.property(kind, n, (k, num) => {
        const id = makeId(k, num);
        expect(parseId(id)).toEqual({ kind: k, n: num });
        expect(kindOf(id)).toBe(k);
        expect(isId(k, id)).toBe(true);
      }),
    );
  });

  it("rechaza formas no canónicas", () => {
    for (const bad of [
      "agent:0",
      "agent:01",
      "agent:-1",
      "agent:1.5",
      "agent:",
      ":1",
      "foo:1",
      "agent:1e3",
      "agent: 1",
      "agent:99999999999999999",
    ]) {
      expect(parseId(bad)).toBeUndefined();
    }
    expect(() => makeId("agent", 0)).toThrow(RangeError);
    expect(() => makeId("agent", 1.5)).toThrow(RangeError);
    expect(isId("org", "agent:1")).toBe(false);
  });

  it("compareIds es un orden total: por tipo y después por número", () => {
    const id = fc.tuple(kind, fc.integer({ min: 1, max: 1000 })).map(([k, num]) => makeId(k, num));
    fc.assert(
      fc.property(fc.array(id), (ids) => {
        const sorted = [...ids].sort(compareIds);
        for (let i = 1; i < sorted.length; i++) {
          const a = parseId(sorted[i - 1] as string);
          const b = parseId(sorted[i] as string);
          if (!a || !b) throw new Error("id inválido");
          expect(a.kind < b.kind || (a.kind === b.kind && a.n <= b.n)).toBe(true);
        }
      }),
    );
    expect(compareIds(makeId("agent", 2), makeId("agent", 10))).toBeLessThan(0);
  });
});

describe("IdAllocator", () => {
  it("cuenta por tipo desde 1, sin que un tipo corra a otro", () => {
    const alloc = new IdAllocator();
    expect(alloc.next("agent")).toBe("agent:1");
    expect(alloc.next("item")).toBe("item:1");
    expect(alloc.next("agent")).toBe("agent:2");
    expect(alloc.state()).toEqual({ agent: 3, item: 2 });
  });

  it("restaurar el estado sigue la misma secuencia", () => {
    fc.assert(
      fc.property(
        fc.array(kind, { maxLength: 50 }),
        fc.array(kind, { maxLength: 50 }),
        (before, after) => {
          const a = new IdAllocator();
          for (const k of before) a.next(k);
          const b = new IdAllocator(JSON.parse(JSON.stringify(a.state())));
          for (const k of after) expect(b.next(k)).toBe(a.next(k));
          expect(b.state()).toEqual(a.state());
        },
      ),
    );
  });

  it("assignInOrder no depende del orden en que llegan las claves", () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.string(), { maxLength: 30 })
          .chain((keys) =>
            fc.tuple(fc.constant(keys), fc.shuffledSubarray(keys, { minLength: keys.length })),
          ),
        ([keys, shuffled]) => {
          const a = new IdAllocator({ lot: 7 }).assignInOrder("lot", keys);
          const b = new IdAllocator({ lot: 7 }).assignInOrder("lot", shuffled);
          expect([...b].sort()).toEqual([...a].sort());
          expect(new Set(a.values()).size).toBe(keys.length);
        },
      ),
    );
  });

  it("assignInOrder rechaza claves repetidas", () => {
    expect(() => new IdAllocator().assignInOrder("event", ["x", "x"])).toThrow();
  });

  it("valida el estado al restaurar", () => {
    expect(() => new IdAllocator({ agent: 0 })).toThrow(RangeError);
    expect(() => new IdAllocator({ nope: 1 } as Partial<Record<EntityKind, number>>)).toThrow(
      TypeError,
    );
  });
});
