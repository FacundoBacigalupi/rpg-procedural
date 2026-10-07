// La grilla del planeta (planet-gen §1): Goldberg geodésica propia, no H3 (ARCHITECTURE §7.9). Un
// icosaedro subdividido a frecuencia `n` da 10n²+2 vértices; cada vértice es una celda (12
// pentágonos en las esquinas, el resto hexágonos). Todo sale de sumas, productos y `sqrt`, que
// IEEE redondea exacto, así que las posiciones son iguales bit a bit en cualquier motor.
//
// Ids canónicos de vértice a frecuencia `n`:
//   - esquinas: 0..11;
//   - aristas: 12 + e·(n-1) + (t-1), con `t` contado desde la esquina menor de la arista `e`;
//   - interiores: 12 + 30(n-1) + f·(n-1)(n-2)/2 + índice dentro de la cara `f`.
// Un punto de arista se calcula siempre desde la arista, nunca desde la cara: las dos caras que la
// comparten dan exactamente el mismo número.
//
// El nivel 1 (local, planet-gen §1) es la misma red a frecuencia `n·k`: sus vértices se reparten
// entre las celdas del nivel 0 por el centro más cercano (empate: índice menor). Es una partición
// exacta, y `refine` la arma para una celda sola sin generar el resto.

import { asin, atan2, type CellId, makeId, sqrt } from "../../core/index.ts";

export type Vec3 = readonly [number, number, number];

const PHI = (1 + sqrt(5)) / 2;

/** Las 12 esquinas sin normalizar: permutaciones cíclicas de (0, ±1, ±φ). */
const RAW_CORNERS: readonly Vec3[] = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
];

/** Las 20 caras, con sus esquinas en orden antihorario visto desde afuera. */
const FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

export function normalize(x: number, y: number, z: number): Vec3 {
  const l = sqrt(x * x + y * y + z * z);
  return [x / l, y / l, z / l];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

const CORNERS: readonly Vec3[] = RAW_CORNERS.map(([x, y, z]) => normalize(x, y, z));

/** Las 30 aristas como pares (menor, mayor), en orden; y su índice por par. */
const EDGES: readonly (readonly [number, number])[] = (() => {
  const set = new Set<number>();
  for (const [a, b, c] of FACES) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      set.add(Math.min(u, v) * 12 + Math.max(u, v));
    }
  }
  return [...set].sort((p, q) => p - q).map((k) => [Math.floor(k / 12), k % 12] as const);
})();
const EDGE_INDEX = new Map<number, number>(EDGES.map(([a, b], e) => [a * 12 + b, e]));

function edgeOf(u: number, v: number): number {
  const e = EDGE_INDEX.get(Math.min(u, v) * 12 + Math.max(u, v));
  if (e === undefined) throw new Error(`no hay arista ${u}-${v}`);
  return e;
}

/**
 * La red de vértices del icosaedro subdividido a frecuencia `n`, sin guardar nada: ids y
 * posiciones canónicas de cada punto (cara, i, j), donde el punto es (n-i-j)·A + i·B + j·C.
 */
export class Lattice {
  readonly n: number;

  constructor(n: number) {
    if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`frecuencia inválida: ${n}`);
    if (10 * n * n + 2 > Number.MAX_SAFE_INTEGER / 4)
      throw new RangeError(`frecuencia enorme: ${n}`);
    this.n = n;
  }

  get size(): number {
    return 10 * this.n * this.n + 2;
  }

  /** El vértice de la cara `f` en (i, j), con i, j ≥ 0 e i + j ≤ n, como esquina, arista o interior. */
  #where(
    f: number,
    i: number,
    j: number,
  ):
    | { kind: "corner"; c: number }
    | { kind: "edge"; e: number; t: number }
    | { kind: "inner"; f: number; i: number; j: number } {
    const n = this.n;
    const face = FACES[f];
    if (!face || i < 0 || j < 0 || i + j > n)
      throw new RangeError(`punto fuera de la cara: ${f} ${i} ${j}`);
    const [A, B, C] = face;
    if (i === 0 && j === 0) return { kind: "corner", c: A };
    if (i === n) return { kind: "corner", c: B };
    if (j === n) return { kind: "corner", c: C };
    // En una arista: (u → v) con parámetro s desde u.
    let u = -1;
    let v = -1;
    let s = 0;
    if (j === 0) [u, v, s] = [A, B, i];
    else if (i === 0) [u, v, s] = [A, C, j];
    else if (i + j === n) [u, v, s] = [B, C, j];
    if (u < 0) return { kind: "inner", f, i, j };
    const e = edgeOf(u, v);
    return { kind: "edge", e, t: u < v ? s : n - s };
  }

  id(f: number, i: number, j: number): number {
    const n = this.n;
    const w = this.#where(f, i, j);
    if (w.kind === "corner") return w.c;
    if (w.kind === "edge") return 12 + w.e * (n - 1) + (w.t - 1);
    // Interiores por filas: i de 1 a n-2, j de 1 a n-1-i.
    const before = ((i - 1) * (2 * n - 2 - i)) / 2; // Σ_{r=1}^{i-1} (n-1-r)
    return 12 + 30 * (n - 1) + (f * (n - 1) * (n - 2)) / 2 + before + (j - 1);
  }

  position(f: number, i: number, j: number): Vec3 {
    const n = this.n;
    const w = this.#where(f, i, j);
    if (w.kind === "corner") return CORNERS[w.c] as Vec3;
    if (w.kind === "edge") {
      const [a, b] = EDGES[w.e] as readonly [number, number];
      const A = CORNERS[a] as Vec3;
      const B = CORNERS[b] as Vec3;
      const p = n - w.t;
      const q = w.t;
      return normalize(p * A[0] + q * B[0], p * A[1] + q * B[1], p * A[2] + q * B[2]);
    }
    const [a, b, c] = FACES[f] as readonly [number, number, number];
    const A = CORNERS[a] as Vec3;
    const B = CORNERS[b] as Vec3;
    const C = CORNERS[c] as Vec3;
    const p = n - i - j;
    return normalize(
      p * A[0] + i * B[0] + j * C[0],
      p * A[1] + i * B[1] + j * C[1],
      p * A[2] + i * B[2] + j * C[2],
    );
  }
}

/** Área de un triángulo esférico unitario (Van Oosterom–Strackee). */
export function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const num = Math.abs(dot(a, cross(b, c)));
  const den = 1 + dot(a, b) + dot(b, c) + dot(c, a);
  return 2 * atan2(num, den);
}

/** Latitud y longitud en radianes de un punto unitario (el eje z es el de rotación). */
export function latLon(p: Vec3): { lat: number; lon: number } {
  return { lat: asin(Math.max(-1, Math.min(1, p[2]))), lon: atan2(p[1], p[0]) };
}

/**
 * Las celdas del nivel 0: posiciones, vecinos ordenados por ángulo y áreas como fracción de la
 * esfera (suman 1). Arreglos tipados indexados por el id canónico del vértice.
 */
export class Grid {
  readonly lattice: Lattice;
  readonly size: number;
  /** x, y, z de cada centro. */
  readonly centers: Float64Array;
  /** Vecinos de la celda `c`: `neighbors[offsets[c] .. offsets[c+1])`, en orden antihorario. */
  readonly offsets: Uint32Array;
  readonly neighbors: Uint32Array;
  /** Fracción de la superficie del planeta. */
  readonly areas: Float64Array;
  readonly lat: Float64Array;
  readonly lon: Float64Array;

  constructor(n: number) {
    const lattice = new Lattice(n);
    this.lattice = lattice;
    const size = lattice.size;
    this.size = size;
    const centers = new Float64Array(size * 3);
    const adj: Set<number>[] = Array.from({ length: size }, () => new Set<number>());
    const areas = new Float64Array(size);
    const seen = new Uint8Array(size);

    const put = (f: number, i: number, j: number): number => {
      const id = lattice.id(f, i, j);
      if (!seen[id]) {
        const p = lattice.position(f, i, j);
        centers[id * 3] = p[0];
        centers[id * 3 + 1] = p[1];
        centers[id * 3 + 2] = p[2];
        seen[id] = 1;
      }
      return id;
    };
    const tri = (a: number, b: number, c: number): void => {
      (adj[a] as Set<number>).add(b).add(c);
      (adj[b] as Set<number>).add(a).add(c);
      (adj[c] as Set<number>).add(a).add(b);
      const third = triangleArea(this.at(a), this.at(b), this.at(c)) / 3;
      areas[a] = (areas[a] as number) + third;
      areas[b] = (areas[b] as number) + third;
      areas[c] = (areas[c] as number) + third;
    };
    this.centers = centers;

    for (let f = 0; f < 20; f++) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; i + j < n; j++) {
          const p = put(f, i, j);
          const q = put(f, i + 1, j);
          const r = put(f, i, j + 1);
          tri(p, q, r);
          if (i + j <= n - 2) tri(q, put(f, i + 1, j + 1), r);
        }
      }
    }

    // Áreas como fracción: se divide por la suma (≈ 4π), no por 4π, así suman 1 sin deriva.
    let total = 0;
    for (let c = 0; c < size; c++) total += areas[c] as number;
    for (let c = 0; c < size; c++) areas[c] = (areas[c] as number) / total;
    this.areas = areas;

    const offsets = new Uint32Array(size + 1);
    const flat: number[] = [];
    const lat = new Float64Array(size);
    const lon = new Float64Array(size);
    for (let c = 0; c < size; c++) {
      offsets[c] = flat.length;
      const p = this.at(c);
      const ll = latLon(p);
      lat[c] = ll.lat;
      lon[c] = ll.lon;
      // Base tangente local para ordenar por ángulo.
      const up: Vec3 = Math.abs(p[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const e1 = unit(cross(up, p));
      const e2 = cross(p, e1);
      const list = [...(adj[c] as Set<number>)].map((m) => {
        const q = this.at(m);
        return { m, a: atan2(dot(q, e2), dot(q, e1)) };
      });
      list.sort((x, y) => x.a - y.a || x.m - y.m);
      for (const { m } of list) flat.push(m);
    }
    offsets[size] = flat.length;
    this.offsets = offsets;
    this.neighbors = Uint32Array.from(flat);
    this.lat = lat;
    this.lon = lon;
  }

  at(c: number): Vec3 {
    const k = c * 3;
    return [
      this.centers[k] as number,
      this.centers[k + 1] as number,
      this.centers[k + 2] as number,
    ];
  }

  neighborsOf(c: number): Uint32Array {
    return this.neighbors.subarray(this.offsets[c] as number, this.offsets[c + 1] as number);
  }

  cellId(c: number): CellId {
    return makeId("cell", c + 1);
  }

  /** Índice de una celda desde su id. */
  indexOf(id: CellId): number {
    const n = Number(id.slice(5)) - 1;
    if (!Number.isSafeInteger(n) || n < 0 || n >= this.size)
      throw new RangeError(`celda desconocida: ${id}`);
    return n;
  }

  /** ¿`a` es mejor centro que `b` para `p`? Más cerca (mayor producto); empate, índice menor. */
  #better(a: number, da: number, b: number, db: number): boolean {
    return da > db || (da === db && a < b);
  }

  /**
   * La celda cuyo centro está más cerca de `p` (unitario), caminando desde `start` hacia el vecino
   * más cercano. Para escapar de un óptimo local se mira también el segundo anillo antes de parar.
   */
  locate(p: Vec3, start = 0): number {
    let c = start;
    let dc = dot(p, this.at(c));
    for (;;) {
      let best = c;
      let bd = dc;
      for (const m of this.neighborsOf(c)) {
        const dm = dot(p, this.at(m));
        if (this.#better(m, dm, best, bd)) {
          best = m;
          bd = dm;
        }
      }
      if (best === c) {
        for (const m of this.neighborsOf(c)) {
          for (const r of this.neighborsOf(m)) {
            const dr = dot(p, this.at(r));
            if (this.#better(r, dr, best, bd)) {
              best = r;
              bd = dr;
            }
          }
        }
        if (best === c) return c;
      }
      c = best;
      dc = bd;
    }
  }

  /** Lo mismo por fuerza bruta, para los tests. */
  locateBrute(p: Vec3): number {
    let best = 0;
    let bd = dot(p, this.at(0));
    for (let c = 1; c < this.size; c++) {
      const d = dot(p, this.at(c));
      if (this.#better(c, d, best, bd)) {
        best = c;
        bd = d;
      }
    }
    return best;
  }

  /**
   * Las celdas del nivel 1 de la celda `c`: los vértices de la red a frecuencia `n·k` cuyo centro
   * más cercano del nivel 0 es `c`. Se buscan en los triángulos del nivel 0 que tocan a `c`.
   * Ids canónicos de la red fina; en orden de id.
   */
  refine(c: number, k: number): FineCell[] {
    if (!Number.isSafeInteger(k) || k < 1) throw new RangeError(`factor inválido: ${k}`);
    const n = this.lattice.n;
    const fine = new Lattice(n * k);
    const out = new Map<number, Vec3>();
    for (let f = 0; f < 20; f++) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; i + j < n; j++) {
          const p = this.lattice.id(f, i, j);
          const q = this.lattice.id(f, i + 1, j);
          const r = this.lattice.id(f, i, j + 1);
          if (p === c || q === c || r === c) this.#collect(fine, f, i * k, j * k, k, 1, c, out);
          if (i + j <= n - 2) {
            const s = this.lattice.id(f, i + 1, j + 1);
            if (q === c || s === c || r === c)
              this.#collect(fine, f, (i + 1) * k, (j + 1) * k, k, -1, c, out);
          }
        }
      }
    }
    return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([id, center]) => ({ id, center }));
  }

  /**
   * Los puntos finos de un triángulo grueso: con `dir = 1` es el triángulo "de punta arriba" con
   * vértice (i0, j0); con `dir = -1`, el "de punta abajo" con vértice (i0, j0) opuesto.
   */
  #collect(
    fine: Lattice,
    f: number,
    i0: number,
    j0: number,
    k: number,
    dir: 1 | -1,
    c: number,
    out: Map<number, Vec3>,
  ): void {
    for (let a = 0; a <= k; a++) {
      for (let b = 0; a + b <= k; b++) {
        const I = i0 + dir * a;
        const J = j0 + dir * b;
        const id = fine.id(f, I, J);
        if (out.has(id)) continue;
        const p = fine.position(f, I, J);
        if (this.locate(p, c) === c) out.set(id, p);
      }
    }
  }
}

export interface FineCell {
  /** Id canónico del vértice en la red a frecuencia `n·k`. */
  readonly id: number;
  readonly center: Vec3;
}

function unit(v: Vec3): Vec3 {
  return normalize(v[0], v[1], v[2]);
}

/** Distancia angular entre dos puntos unitarios, en radianes (por el radio da kilómetros). */
export function arc(a: Vec3, b: Vec3): number {
  return atan2(sqrt(dotSelf(cross(a, b))), dot(a, b));
}

function dotSelf(v: Vec3): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

/** La frecuencia que da celdas de unos `spacingKm` en un planeta de `radiusKm`. */
export function frequencyFor(radiusKm: number, spacingKm: number): number {
  // La arista del icosaedro subtiende ~1.1071 rad; dividida en n tramos.
  return Math.max(1, Math.round((1.1071487177940904 * radiusKm) / spacingKm));
}
