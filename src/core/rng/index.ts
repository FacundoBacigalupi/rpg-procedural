// RNG por contador (ARCHITECTURE §7.4, simulation §8).
//
// Un sorteo es una función pura `draw(seed, key, n)`: no hay estado escondido que guardar ni que
// pasar entre workers, y la misma clave da lo mismo en cualquier hilo y en cualquier orden.
// La clave sale de una tupla (`rng.fork("materialize", populationId, slot, epoch)`): cada sistema
// arma la suya con lo que identifica la tirada, así que ninguna depende del orden de iteración.
//
// Cada primitiva consume una cantidad FIJA de sorteos (sin rechazo): inclinar pesos (el Cielo,
// heaven-karma §6) cambia el resultado, nunca cuántas tiradas hubo después.
//
// La clave y el estado del mezclador son de 64 bits (dos carriles de 32) para que dos claves
// distintas no compartan flujo; cada sorteo da 32 bits.

/** Semilla del mundo: entero seguro no negativo. */
export type Seed = number;

/** Parte de una clave: un id, un nombre de proceso, un tick, un índice. */
export type RngKeyPart = string | number;

/** Clave ya hasheada (64 bits en dos carriles). Es independiente de la semilla: se puede guardar. */
export type RngKey = readonly [number, number];

/** Estado serializable de un `Rng`: dónde está parado. */
export interface RngState {
  readonly seed: Seed;
  readonly key: RngKey;
  readonly n: number;
}

const TWO_32 = 4294967296;
const TWO_53 = 9007199254740992;
const ROOT_KEY: RngKey = [0x243f6a88, 0x85a308d3]; // dígitos de pi: nada en la manga

// --- mezcladores (lowbias32 y triple32 de Chris Wellons) -------------------------------------

function mixA(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function mixB(x: number): number {
  x ^= x >>> 17;
  x = Math.imul(x, 0xed5ad4bb);
  x ^= x >>> 11;
  x = Math.imul(x, 0xac4c1b51);
  x ^= x >>> 15;
  x = Math.imul(x, 0x31848bab);
  x ^= x >>> 14;
  return x >>> 0;
}

/** Absorbe una palabra de 32 bits en el estado de dos carriles. */
function absorb(a: number, b: number, w: number): [number, number] {
  const na = mixA(a ^ w);
  const nb = mixB((b ^ w) + na);
  return [na, nb];
}

function splitSafe(n: number): [number, number] {
  // n entero seguro (puede ser negativo): parte baja y alta en complemento a dos de 64 bits.
  const lo = n >>> 0;
  const hi = Math.floor(n / TWO_32) >>> 0;
  return [lo, hi];
}

const TAG_STRING = 0x5f3759df;
const TAG_NUMBER = 0x1b873593;

function absorbPart(key: RngKey, part: RngKeyPart): RngKey {
  let [a, b] = key;
  if (typeof part === "string") {
    [a, b] = absorb(a, b, TAG_STRING);
    [a, b] = absorb(a, b, part.length);
    for (let i = 0; i < part.length; i++) [a, b] = absorb(a, b, part.charCodeAt(i));
  } else {
    if (!Number.isSafeInteger(part)) {
      throw new RangeError(`parte de clave numérica no entera: ${part}`);
    }
    const [lo, hi] = splitSafe(part);
    [a, b] = absorb(a, b, TAG_NUMBER);
    [a, b] = absorb(a, b, lo);
    [a, b] = absorb(a, b, hi);
  }
  return [a, b];
}

/** La clave de una tupla, desde la raíz o desde otra clave. `deriveKey(k, [x, y])` = derivar x y después y. */
export function deriveKey(parent: RngKey, parts: readonly RngKeyPart[]): RngKey {
  let key = parent;
  for (const part of parts) key = absorbPart(key, part);
  return key;
}

export function rootKey(): RngKey {
  return ROOT_KEY;
}

function checkSeed(seed: Seed): void {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError(`semilla inválida: ${seed}`);
}

function checkKey(key: RngKey): void {
  if (key.length !== 2 || !key.every((w) => Number.isInteger(w) && w >= 0 && w < TWO_32)) {
    throw new RangeError(`clave de rng inválida: ${JSON.stringify(key)}`);
  }
}

/** El sorteo número `n` (desde 0) de la clave `key` bajo la semilla `seed`: 32 bits sin signo. */
export function draw(seed: Seed, key: RngKey, n: number): number {
  const [sLo, sHi] = splitSafe(seed);
  const [nLo, nHi] = splitSafe(n);
  let [a, b] = absorb(key[0], key[1], sLo);
  [a, b] = absorb(a, b, sHi);
  [a, b] = absorb(a, b, nLo);
  [a, b] = absorb(a, b, nHi);
  return mixA(a ^ mixB(b + 0x9e3779b9));
}

// --- primitivas comunes ----------------------------------------------------------------------

/**
 * Lo que se puede sacar de cualquier fuente de 32 bits. Todas consumen una cantidad fija de
 * `u32()`: `float`, `int`, `chance`, `pick` y `weighted` usan 2; `shuffle` usa 2 por elemento menos uno.
 */
export abstract class Random {
  abstract u32(): number;

  /** Uniforme en [0, 1) con 53 bits. */
  float(): number {
    const hi = this.u32() >>> 5; // 27 bits
    const lo = this.u32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / TWO_53;
  }

  /** Entero uniforme en [min, max], ambos incluidos. Sesgo ≤ rango / 2^53. */
  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError(`rango inválido: [${min}, ${max}]`);
    }
    const span = max - min + 1;
    if (!Number.isSafeInteger(span))
      throw new RangeError(`rango demasiado grande: [${min}, ${max}]`);
    return min + Math.floor(this.float() * span);
  }

  /** Verdadero con probabilidad `p`. */
  chance(p: number): boolean {
    if (!(p >= 0 && p <= 1)) throw new RangeError(`probabilidad inválida: ${p}`);
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("pick de una lista vacía");
    return items[this.int(0, items.length - 1)] as T;
  }

  /**
   * Índice elegido con probabilidad proporcional a su peso. Un solo `float()` sea cual sea el
   * peso: cambiar los pesos no corre las tiradas siguientes.
   */
  weighted(weights: readonly number[]): number {
    let total = 0;
    let last = -1;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] as number;
      if (!(w >= 0 && Number.isFinite(w))) throw new RangeError(`peso inválido: ${w}`);
      total += w;
      if (w > 0) last = i;
    }
    if (last < 0) throw new RangeError("todos los pesos son 0");
    const target = this.float() * total;
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i] as number;
      if (target < acc) return i;
    }
    return last; // redondeo en el último tramo
  }

  /** Copia mezclada (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }
}

// --- Rng por contador ------------------------------------------------------------------------

export class Rng extends Random {
  readonly seed: Seed;
  readonly key: RngKey;
  #n: number;

  private constructor(seed: Seed, key: RngKey, n: number) {
    super();
    this.seed = seed;
    this.key = key;
    this.#n = n;
  }

  /** La raíz del mundo. Todo lo demás sale de acá con `fork`. */
  static root(seed: Seed): Rng {
    checkSeed(seed);
    return new Rng(seed, ROOT_KEY, 0);
  }

  /** Rehace un `Rng` guardado (un `Deferred.rngKey`, un proceso a medio camino). */
  static restore(state: RngState): Rng {
    checkSeed(state.seed);
    checkKey(state.key);
    if (!Number.isSafeInteger(state.n) || state.n < 0) {
      throw new RangeError(`contador inválido: ${state.n}`);
    }
    return new Rng(state.seed, [state.key[0], state.key[1]], state.n);
  }

  /**
   * Un flujo nuevo para la tupla dada, empezando en 0. No consume nada del padre: pedir un hijo
   * antes o después de sacar números del padre da el mismo hijo. `fork(a, b)` = `fork(a).fork(b)`.
   */
  fork(...parts: RngKeyPart[]): Rng {
    if (parts.length === 0) throw new RangeError("fork sin clave");
    return new Rng(this.seed, deriveKey(this.key, parts), 0);
  }

  /** Cuántos sorteos se consumieron de esta clave. */
  get position(): number {
    return this.#n;
  }

  u32(): number {
    const n = this.#n;
    if (n >= Number.MAX_SAFE_INTEGER) throw new RangeError("contador de rng agotado");
    this.#n = n + 1;
    return draw(this.seed, this.key, n);
  }

  state(): RngState {
    return { seed: this.seed, key: this.key, n: this.#n };
  }

  /** Un sfc32 sembrado desde esta clave, para flujos largos (worldgen). Consume 4 sorteos. */
  stream(): Sfc32 {
    return new Sfc32(this.u32(), this.u32(), this.u32(), this.u32());
  }
}

// --- sfc32: flujo largo y rápido -------------------------------------------------------------

export type Sfc32State = readonly [number, number, number, number];

/** Small Fast Counting RNG (Chris Doty-Humphrey), 32 bits. Para millones de sorteos en una clave. */
export class Sfc32 extends Random {
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(a: number, b: number, c: number, d = 1) {
    super();
    this.#a = a >>> 0;
    this.#b = b >>> 0;
    this.#c = c >>> 0;
    this.#d = d >>> 0;
    for (let i = 0; i < 12; i++) this.u32();
  }

  static restore(state: Sfc32State): Sfc32 {
    const s = new Sfc32(0, 0, 0, 0);
    s.#a = state[0] >>> 0;
    s.#b = state[1] >>> 0;
    s.#c = state[2] >>> 0;
    s.#d = state[3] >>> 0;
    return s;
  }

  u32(): number {
    const t = (((this.#a + this.#b) >>> 0) + this.#d) >>> 0;
    this.#d = (this.#d + 1) >>> 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) >>> 0;
    this.#c = ((this.#c << 21) | (this.#c >>> 11)) >>> 0;
    this.#c = (this.#c + t) >>> 0;
    return t;
  }

  state(): Sfc32State {
    return [this.#a, this.#b, this.#c, this.#d];
  }
}
