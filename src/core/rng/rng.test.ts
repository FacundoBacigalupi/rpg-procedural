import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deriveKey, draw, Random, Rng, type RngKeyPart, rootKey, Sfc32 } from "./index.ts";

const seed = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
const part: fc.Arbitrary<RngKeyPart> = fc.oneof(
  fc.string(),
  fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
);
const parts = fc.array(part, { minLength: 1, maxLength: 5 });

/** Chi cuadrado de `samples` en `buckets` cajas uniformes. */
function chiSquare(samples: number, buckets: number, next: () => number): number {
  const counts = new Array<number>(buckets).fill(0);
  for (let i = 0; i < samples; i++) {
    const b = next();
    counts[b] = (counts[b] as number) + 1;
  }
  const expected = samples / buckets;
  return counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
}

// Para 255 grados de libertad, p = 0.0001 queda cerca de 340: si falla, no es mala suerte.
const CHI_255_LIMIT = 340;

describe("valores dorados (cambiar esto rompe el replay de vidas guardadas)", () => {
  it("draw y fork", () => {
    expect([
      draw(0, rootKey(), 0),
      draw(1, rootKey(), 0),
      draw(Number.MAX_SAFE_INTEGER, rootKey(), 1),
    ]).toEqual([243287277, 1373275688, 566668984]);
    const r = Rng.root(123).fork("materialize", "population:7", 3, 2);
    expect(r.key).toEqual([2005880243, 2177776434]);
    expect([r.u32(), r.u32(), r.u32()]).toEqual([2038041199, 753093367, 1561546112]);
  });

  it("sfc32 y primitivas", () => {
    const s = Rng.root(42).fork("planet").stream();
    expect([s.u32(), s.u32(), s.u32()]).toEqual([159400977, 1784853066, 727466599]);
    const t = Rng.root(5).fork("x");
    expect([t.float(), t.int(1, 6), t.weighted([1, 2, 3])]).toEqual([0.10822455685082588, 2, 1]);
  });
});

describe("determinismo", () => {
  it("misma semilla, misma clave, mismo contador: mismo número", () => {
    fc.assert(
      fc.property(seed, parts, fc.nat(1000), (s, ps, n) => {
        const a = Rng.root(s).fork(...ps);
        const b = Rng.root(s).fork(...ps);
        for (let i = 0; i < n % 20; i++) a.u32();
        for (let i = 0; i < n % 20; i++) b.u32();
        expect(a.u32()).toBe(b.u32());
        expect(draw(s, a.key, n)).toBe(draw(s, b.key, n));
      }),
    );
  });

  it("fork(a, b) es fork(a).fork(b) y no consume al padre", () => {
    fc.assert(
      fc.property(seed, parts, parts, (s, p1, p2) => {
        const root = Rng.root(s);
        const before = root.fork(...p1);
        root.u32();
        root.float();
        expect(root.fork(...p1).key).toEqual(before.key);
        expect(root.fork(...p1, ...p2).key).toEqual(root.fork(...p1).fork(...p2).key);
        expect(root.position).toBe(3);
      }),
    );
  });

  it("guardar y restaurar sigue exactamente igual", () => {
    fc.assert(
      fc.property(seed, parts, fc.nat(50), (s, ps, n) => {
        const a = Rng.root(s).fork(...ps);
        for (let i = 0; i < n; i++) a.u32();
        const b = Rng.restore(JSON.parse(JSON.stringify(a.state())));
        for (let i = 0; i < 10; i++) expect(b.u32()).toBe(a.u32());
        const sa = a.stream();
        const sb = Sfc32.restore(JSON.parse(JSON.stringify(sa.state())));
        for (let i = 0; i < 10; i++) expect(sb.u32()).toBe(sa.u32());
      }),
    );
  });

  it("las claves no confunden la frontera entre partes ni el tipo", () => {
    const k = (...ps: RngKeyPart[]) => JSON.stringify(deriveKey(rootKey(), ps));
    const keys = [
      k("ab", "c"),
      k("a", "bc"),
      k("abc"),
      k(1),
      k("1"),
      k(1, 2),
      k(12),
      k(-1),
      k(0),
      k(""),
      k("", ""),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("cada primitiva consume una cantidad fija de sorteos, sin importar los pesos", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(100), { minLength: 1, maxLength: 10 }), (ws) => {
        fc.pre(ws.some((w) => w > 0));
        const r = Rng.root(9).fork("heaven", 1);
        r.weighted(ws);
        expect(r.position).toBe(2);
        r.int(0, 1_000_000);
        r.chance(0.3);
        r.pick([1, 2, 3]);
        expect(r.position).toBe(8);
      }),
    );
  });

  it("rechaza entradas inválidas", () => {
    expect(() => Rng.root(-1)).toThrow(RangeError);
    expect(() => Rng.root(1.5)).toThrow(RangeError);
    expect(() => Rng.root(1).fork()).toThrow(RangeError);
    expect(() => Rng.root(1).fork(0.5)).toThrow(RangeError);
    expect(() => Rng.restore({ seed: 1, key: [1, -1], n: 0 })).toThrow(RangeError);
    const r = Rng.root(1).fork("x");
    expect(() => r.int(3, 2)).toThrow(RangeError);
    expect(() => r.chance(1.1)).toThrow(RangeError);
    expect(() => r.pick([])).toThrow(RangeError);
    expect(() => r.weighted([0, 0])).toThrow(RangeError);
    expect(() => r.weighted([1, -1])).toThrow(RangeError);
  });
});

describe("distribución", () => {
  it("los bytes de un flujo son uniformes", () => {
    const r = Rng.root(2024).fork("dist");
    expect(chiSquare(200_000, 256, () => r.u32() & 0xff)).toBeLessThan(CHI_255_LIMIT);
    expect(chiSquare(200_000, 256, () => r.u32() >>> 24)).toBeLessThan(CHI_255_LIMIT);
  });

  it("claves vecinas y contadores vecinos no se parecen", () => {
    // El primer sorteo de 50k claves consecutivas (lo que hace la sim: una clave por agente o por tick).
    let i = 0;
    const root = Rng.root(7);
    expect(chiSquare(100_000, 256, () => root.fork("agent", i++).u32() & 0xff)).toBeLessThan(
      CHI_255_LIMIT,
    );
    // Xor de sorteos de claves vecinas: si estuvieran correlacionadas, no sería uniforme.
    let j = 0;
    expect(
      chiSquare(100_000, 256, () => {
        const a = root.fork("tick", j).u32();
        const b = root.fork("tick", j + 1).u32();
        j++;
        return ((a ^ b) >>> 12) & 0xff;
      }),
    ).toBeLessThan(CHI_255_LIMIT);
    // Semillas vecinas con la misma clave.
    let s = 0;
    expect(chiSquare(100_000, 256, () => draw(s++, rootKey(), 0) >>> 24)).toBeLessThan(
      CHI_255_LIMIT,
    );
  });

  it("cada bit sale 1 la mitad de las veces", () => {
    const r = Rng.root(31337).fork("bits");
    const ones = new Array<number>(32).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const x = r.u32();
      for (let b = 0; b < 32; b++) if ((x >>> b) & 1) ones[b] = (ones[b] as number) + 1;
    }
    // 5 desvíos estándar: sqrt(n)/2 ≈ 158
    for (const c of ones) expect(Math.abs(c - n / 2)).toBeLessThan(800);
  });

  it("float, int, weighted y shuffle tienen la forma esperada", () => {
    const r = Rng.root(99).fork("shape");
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const f = r.float();
      expect(f >= 0 && f < 1).toBe(true);
      sum += f;
    }
    expect(Math.abs(sum / 100_000 - 0.5)).toBeLessThan(0.005);
    expect(chiSquare(100_000, 256, () => r.int(0, 255))).toBeLessThan(CHI_255_LIMIT);

    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 60_000; i++) {
      const k = r.weighted([1, 0, 2, 3]);
      counts[k] = (counts[k] as number) + 1;
    }
    expect(counts[1]).toBe(0);
    expect(Math.abs((counts[0] as number) / 60_000 - 1 / 6)).toBeLessThan(0.01);
    expect(Math.abs((counts[3] as number) / 60_000 - 1 / 2)).toBeLessThan(0.01);

    // Cada una de las 24 permutaciones de 4 elementos, igual de probable.
    const perms = new Map<string, number>();
    for (let i = 0; i < 48_000; i++) {
      const p = r.shuffle([0, 1, 2, 3]).join("");
      perms.set(p, (perms.get(p) ?? 0) + 1);
    }
    expect(perms.size).toBe(24);
    for (const c of perms.values()) expect(Math.abs(c - 2000)).toBeLessThan(250);
  });

  it("sfc32 también es uniforme", () => {
    const s = Rng.root(1).fork("worldgen").stream();
    expect(chiSquare(200_000, 256, () => s.u32() >>> 24)).toBeLessThan(CHI_255_LIMIT);
    expect(s).toBeInstanceOf(Random);
  });
});
