// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: los valores dorados son salidas exactas, no constantes con nombre.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Rng } from "../rng/index.ts";
import * as M from "./index.ts";

/** Distancia en ulps entre lo nuestro y lo del motor. */
function ulps(a: number, b: number): number {
  if (Object.is(a, b) || a === b) return 0;
  const scale = b === 0 ? Number.MIN_VALUE : 2 ** (Math.floor(Math.log2(Math.abs(b))) - 52);
  return Math.abs(a - b) / Math.max(scale, Number.MIN_VALUE);
}

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const cases: [
  string,
  (x: number) => number,
  (x: number) => number,
  fc.Arbitrary<number>,
  number,
][] = [
  ["exp", M.exp, Math.exp, finite(-745, 709.7), 1],
  [
    "log",
    M.log,
    Math.log,
    fc.double({ min: Number.MIN_VALUE, max: Number.MAX_VALUE, noNaN: true }),
    1,
  ],
  [
    "sin",
    M.sin,
    Math.sin,
    fc.double({
      min: -M.TRIG_MAX,
      max: M.TRIG_MAX,
      minExcluded: true,
      maxExcluded: true,
      noNaN: true,
    }),
    1,
  ],
  [
    "cos",
    M.cos,
    Math.cos,
    fc.double({
      min: -M.TRIG_MAX,
      max: M.TRIG_MAX,
      minExcluded: true,
      maxExcluded: true,
      noNaN: true,
    }),
    1,
  ],
  ["tan", M.tan, Math.tan, finite(-1000, 1000), 3],
  ["atan", M.atan, Math.atan, fc.double({ noNaN: true }), 1],
  ["asin", M.asin, Math.asin, finite(-1, 1), 3],
  ["acos", M.acos, Math.acos, finite(-1, 1), 3],
  [
    "log2",
    M.log2,
    Math.log2,
    fc.double({ min: Number.MIN_VALUE, max: Number.MAX_VALUE, noNaN: true }),
    2,
  ],
  [
    "log10",
    M.log10,
    Math.log10,
    fc.double({ min: Number.MIN_VALUE, max: Number.MAX_VALUE, noNaN: true }),
    2,
  ],
];

describe("error contra Math.*", () => {
  for (const [name, ours, engine, input, maxUlps] of cases) {
    it(`${name} a ≤ ${maxUlps} ulp`, () => {
      fc.assert(
        fc.property(input, (x) => {
          const a = ours(x);
          const b = engine(x);
          // Cerca de los ceros de sin/cos/tan el error absoluto manda, no el relativo.
          if (Math.abs(b) < 1e-300) expect(Math.abs(a - b)).toBeLessThan(1e-300);
          else expect(ulps(a, b)).toBeLessThanOrEqual(maxUlps);
        }),
        { numRuns: 5000 },
      );
    });
  }

  it("atan2 a ≤ 1 ulp", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), fc.double({ noNaN: true }), (y, x) => {
        expect(ulps(M.atan2(y, x), Math.atan2(y, x))).toBeLessThanOrEqual(1);
      }),
      { numRuns: 5000 },
    );
  });

  it("pow con error relativo ≲ |y·log x|·2^-50", () => {
    fc.assert(
      fc.property(finite(0, 1000), finite(-100, 100), (x, y) => {
        const a = M.pow(x, y);
        const b = x ** y;
        if (a === b || !Number.isFinite(b) || b < 1e-300) return;
        const t = Math.abs(y * Math.log(x));
        expect(Math.abs(a - b) / b).toBeLessThanOrEqual(Math.max(1, t) * 2 ** -50);
      }),
      { numRuns: 5000 },
    );
  });

  it("pow con exponentes enteros chicos es exacta cuando el motor también lo es", () => {
    for (const [x, y] of [
      [2, 10],
      [10, 3],
      [10, 22],
      [3, 20],
      [-2, 3],
      [-2, 4],
      [0.5, 3],
      [2, -2],
    ] as const) {
      expect(M.pow(x, y)).toBe(x ** y);
    }
  });

  it("hypot y logistic", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), fc.double({ noNaN: true }), (x, y) => {
        expect(ulps(M.hypot(x, y), Math.hypot(x, y))).toBeLessThanOrEqual(2);
      }),
    );
    fc.assert(
      fc.property(finite(-700, 700), (x) => {
        expect(ulps(M.logistic(x), 1 / (1 + Math.exp(-x)))).toBeLessThanOrEqual(4);
      }),
    );
    expect(ulps(M.hypot(1e300, 1e300), Math.hypot(1e300, 1e300))).toBeLessThanOrEqual(1);
  });

  it("normalQuantile invierte la normal", () => {
    // Puntos conocidos de la tabla de la normal.
    expect(M.normalQuantile(0.5)).toBe(0);
    expect(M.normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 8);
    expect(M.normalQuantile(0.025)).toBeCloseTo(-1.959963984540054, 8);
    expect(M.normalQuantile(0.8413447460685429)).toBeCloseTo(1, 8);
    expect(M.normalQuantile(1e-10)).toBeCloseTo(-6.361340902404056, 6);
    expect(M.normalQuantile(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(M.normalQuantile(1)).toBe(Number.POSITIVE_INFINITY);
    expect(M.normalQuantile(2)).toBeNaN();
  });
});

describe("casos borde como Math.*", () => {
  const specials = [
    0,
    -0,
    1,
    -1,
    0.5,
    -0.5,
    2,
    -2,
    3,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NaN,
  ];
  const unary: [string, (x: number) => number, (x: number) => number][] = [
    ["exp", M.exp, Math.exp],
    ["log", M.log, Math.log],
    ["sin", M.sin, Math.sin],
    ["cos", M.cos, Math.cos],
    ["tan", M.tan, Math.tan],
    ["atan", M.atan, Math.atan],
    ["asin", M.asin, Math.asin],
    ["acos", M.acos, Math.acos],
    ["log2", M.log2, Math.log2],
    ["log10", M.log10, Math.log10],
  ];
  for (const [name, ours, engine] of unary) {
    it(name, () => {
      for (const x of specials) {
        const a = ours(x);
        const b = engine(x);
        if (Number.isFinite(b) && b !== 0) expect(ulps(a, b)).toBeLessThanOrEqual(3);
        else expect(a).toBe(b); // NaN, ±infinito y el signo del cero tienen que coincidir
      }
    });
  }

  it("atan2 y pow", () => {
    for (const y of specials) {
      for (const x of specials) {
        const at = Math.atan2(y, x);
        if (Number.isFinite(at) && at !== 0) expect(ulps(M.atan2(y, x), at)).toBeLessThanOrEqual(1);
        else expect(M.atan2(y, x)).toBe(at);
        const pw = x ** y;
        if (Number.isFinite(pw) && pw !== 0) expect(ulps(M.pow(x, y), pw)).toBeLessThanOrEqual(1);
        else expect(M.pow(x, y)).toBe(pw);
      }
    }
  });

  it("exactos: potencias de 2 y de 10", () => {
    for (let k = -1074; k <= 1023; k += 7) expect(M.log2(2 ** k)).toBe(k);
    for (let k = 0; k <= 22; k++) expect(M.log10(10 ** k)).toBe(k);
  });

  it("los argumentos trigonométricos enormes se rechazan en vez de dar cualquier cosa", () => {
    expect(() => M.sin(1e7)).toThrow(RangeError);
    expect(() => M.cos(-1e7)).toThrow(RangeError);
  });
});

describe("valores dorados (cambiar esto rompe el replay de vidas guardadas)", () => {
  it("funciones", () => {
    const xs = [0.1, 1.5, 3, 10, 123.456];
    expect(
      xs.map((x) => [
        M.exp(x),
        M.log(x),
        M.sin(x),
        M.cos(x),
        M.tan(x),
        M.atan(x),
        M.pow(x, 2.7),
        M.atan2(x, -2),
      ]),
    ).toEqual([
      [
        1.1051709180756477, -2.3025850929940455, 0.09983341664682815, 0.9950041652780258,
        0.10033467208545054, 0.09966865249116204, 0.0019952623149688802, 3.0916342578678506,
      ],
      [
        4.4816890703380645, 0.4054651081081644, 0.9974949866040544, 0.0707372016677029,
        14.10141994717172, 0.982793723247329, 2.988452789872502, 2.498091544796509,
      ],
      [
        20.085536923187668, 1.0986122886681096, 0.1411200080598672, -0.9899924966004454,
        -0.1425465430742778, 1.2490457723982544, 19.419023519771336, 2.1587989303424644,
      ],
      [
        22026.465794806718, 2.302585092994046, -0.5440211108893698, -0.8390715290764524,
        0.6483608274590866, 1.4711276743037347, 501.18723362727275, 1.7681918866447774,
      ],
      [
        4.132944352778106e53, 4.815884817283264, -0.8039373685728239, -0.5947139710921574,
        1.3518050821917635, 1.5626964520979927, 443693.3752968951, 1.5869950134954696,
      ],
    ]);
  });

  it("distribuciones del rng", () => {
    const r = Rng.root(77).fork("dist");
    expect([
      r.normal(),
      r.exponential(2),
      r.logNormal(0, 1),
      r.poisson(3),
      r.poisson(100),
      r.binomial(10, 0.3),
      r.binomial(1000, 0.9),
      r.position,
    ]).toEqual([1.1428060208434507, 1.731305688273933, 0.9083544402311918, 4, 107, 6, 907, 14]);
  });
});

describe("distribuciones del rng", () => {
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = (xs: number[]) => {
    const m = mean(xs);
    return xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length;
  };
  const sample = (n: number, f: (r: Rng) => number) => {
    const r = Rng.root(2026).fork("moments");
    return Array.from({ length: n }, () => f(r));
  };

  it("normal, exponencial y lognormal tienen sus momentos", () => {
    const z = sample(100_000, (r) => r.normal(10, 3));
    expect(mean(z)).toBeCloseTo(10, 1);
    expect(variance(z)).toBeCloseTo(9, 0);
    expect(z.filter((x) => Math.abs(x - 10) < 3).length / z.length).toBeCloseTo(0.6827, 2);
    const e = sample(100_000, (r) => r.exponential(4));
    expect(mean(e)).toBeCloseTo(0.25, 2);
    const ln = sample(100_000, (r) => r.logNormal(0, 0.5));
    expect(mean(ln)).toBeCloseTo(Math.exp(0.125), 1);
  });

  it("poisson y binomial tienen media y varianza, en los dos regímenes", () => {
    for (const lambda of [0.5, 4, 25, 200]) {
      const k = sample(50_000, (r) => r.poisson(lambda));
      expect(Math.abs(mean(k) - lambda)).toBeLessThan(0.05 * lambda + 0.02);
      expect(Math.abs(variance(k) - lambda)).toBeLessThan(0.08 * lambda + 0.05);
      expect(k.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    }
    for (const [n, p] of [
      [10, 0.3],
      [40, 0.9],
      [1000, 0.2],
      [5000, 0.995],
    ] as const) {
      const k = sample(50_000, (r) => r.binomial(n, p));
      expect(Math.abs(mean(k) - n * p)).toBeLessThan(0.02 * n * p + 0.05);
      expect(Math.abs(variance(k) - n * p * (1 - p))).toBeLessThan(0.1 * n * p * (1 - p) + 0.05);
      expect(k.every((x) => Number.isInteger(x) && x >= 0 && x <= n)).toBe(true);
    }
  });

  it("cada distribución consume 2 sorteos sea cual sea el parámetro", () => {
    fc.assert(
      fc.property(
        finite(0, 1000),
        fc.nat(10_000),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (lambda, n, p) => {
          const r = Rng.root(1).fork("fixed");
          r.normal(lambda, lambda);
          r.exponential(lambda + 1);
          r.poisson(lambda);
          r.binomial(n, p);
          expect(r.position).toBe(8);
        },
      ),
    );
  });
});
