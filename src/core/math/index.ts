// biome-ignore-all lint/correctness/noPrecisionLoss: constantes de fdlibm copiadas textuales para poder compararlas con la fuente; el redondeo al double más cercano es el valor correcto.
// Matemática determinista (ARCHITECTURE §7.4).
//
// `Math.exp`, `Math.sin` y compañía no están especificadas al bit: una actualización de V8 puede
// cambiar el último dígito y romper el replay de una vida vieja. Acá van ports de fdlibm (FreeBSD
// msun) que usan solo suma, resta, multiplicación, división, `Math.sqrt` y lectura de bits, que
// IEEE 754 redondea igual en todas las máquinas. Error típico ≤ 1 ulp contra la función real.
//
// La semántica de casos borde (NaN, infinitos, ceros con signo) sigue la de `Math.*` de JS.

const view = new DataView(new ArrayBuffer(8));

/** Palabra alta (signo, exponente y 20 bits de mantisa) como entero con signo. */
function hiWord(x: number): number {
  view.setFloat64(0, x);
  return view.getInt32(0);
}

function loWord(x: number): number {
  view.setFloat64(0, x);
  return view.getUint32(4);
}

function withHiWord(x: number, hi: number): number {
  view.setFloat64(0, x);
  view.setInt32(0, hi);
  return view.getFloat64(0);
}

export const PI = Math.PI;
export const TAU = 6.283185307179586;
export const E = Math.E;
export const LN2 = Math.LN2;
export const LN10 = Math.LN10;

export const sqrt = Math.sqrt; // IEEE la exige correctamente redondeada: es segura

// --- exp (e_exp.c) ---------------------------------------------------------------------------

const EXP_O_THRESHOLD = 7.09782712893383973096e2;
const EXP_U_THRESHOLD = -7.4513321910194110842e2;
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = Math.LOG2E;
const TWO_M1000 = 9.3326361850321887899e-302;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

export function exp(x: number): number {
  let hx = hiWord(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;

  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | loWord(x)) !== 0) return Number.NaN;
      return xsb === 0 ? x : 0;
    }
    if (x > EXP_O_THRESHOLD) return Number.POSITIVE_INFINITY;
    if (x < EXP_U_THRESHOLD) return 0;
  }

  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      hi = xsb === 0 ? x - LN2_HI : x + LN2_HI;
      lo = xsb === 0 ? LN2_LO : -LN2_LO;
      k = 1 - xsb - xsb;
    } else {
      k = Math.trunc(INV_LN2 * x + (xsb === 0 ? 0.5 : -0.5));
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    return 1 + x;
  }

  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  if (k >= -1021) {
    if (k === 1024) return withHiWord(y, hiWord(y) + (1023 << 20)) * 2;
    return withHiWord(y, hiWord(y) + (k << 20));
  }
  return withHiWord(y, hiWord(y) + ((k + 1000) << 20)) * TWO_M1000;
}

// --- log (e_log.c) ---------------------------------------------------------------------------

const TWO54 = 1.8014398509481984e16;
const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

export function log(x: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return Number.NEGATIVE_INFINITY;
    if (hx < 0) return Number.NaN;
    k -= 54;
    x *= TWO54;
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHiWord(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const r = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - r : dk * LN2_HI - (r - dk * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const r = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + r));
    return dk * LN2_HI - (hfsq - (s * (hfsq + r) + dk * LN2_LO) - f);
  }
  if (k === 0) return f - s * (f - r);
  return dk * LN2_HI - (s * (f - r) - dk * LN2_LO - f);
}

/** Exponente binario exacto si `x` es potencia de 2 normal; si no, undefined. */
function exactLog2(x: number): number | undefined {
  const hx = hiWord(x);
  if (hx <= 0 || hx >= 0x7ff00000 || (hx & 0x000fffff) !== 0 || loWord(x) !== 0) return undefined;
  if (hx < 0x00100000) return undefined;
  return (hx >> 20) - 1023;
}

export function log2(x: number): number {
  return exactLog2(x) ?? log(x) / LN2;
}

export function log10(x: number): number {
  const r = log(x) / LN10;
  // Potencias de 10 exactas dan un entero exacto (como Math.log10).
  const k = Math.round(r);
  if (Math.abs(r - k) < 1e-12 && k >= 0 && k <= 22 && powInt(10, k) === x) return k;
  return r;
}

// --- pow -------------------------------------------------------------------------------------

/** x^n por cuadrados, n entero ≥ 0. */
function powInt(x: number, n: number): number {
  let result = 1;
  let base = x;
  while (n > 0) {
    if (n % 2 === 1) result *= base;
    base *= base;
    n = Math.floor(n / 2);
  }
  return result;
}

/** Error exacto de a*b (Dekker), para corregir el redondeo del producto en `pow`. */
function productError(a: number, b: number, p: number): number {
  const split = 134217729; // 2^27 + 1
  const ca = split * a;
  const ah = ca - (ca - a);
  const al = a - ah;
  const cb = split * b;
  const bh = cb - (cb - b);
  const bl = b - bh;
  return ah * bh - p + ah * bl + al * bh + al * bl;
}

function isOddInteger(y: number): boolean {
  return Number.isInteger(y) && Math.abs(y) < 9007199254740992 && y % 2 !== 0;
}

/**
 * x^y. Exponentes enteros chicos son exactos cuando el resultado es representable; el caso
 * general es exp(y·log x) con el redondeo del producto corregido (error relativo ≲ |y·log x|·2^-52).
 */
export function pow(x: number, y: number): number {
  if (Number.isNaN(y)) return Number.NaN;
  if (y === 0) return 1;
  if (Number.isNaN(x)) return Number.NaN;
  const ax = Math.abs(x);
  if (!Number.isFinite(y)) {
    if (ax === 1) return Number.NaN;
    return ax > 1 === y > 0 ? Number.POSITIVE_INFINITY : 0;
  }
  const odd = isOddInteger(y);
  if (ax === 0 || ax === Number.POSITIVE_INFINITY) {
    const big = (ax === 0) === y < 0; // 0^neg o inf^pos
    const negative = odd && (x < 0 || Object.is(x, -0));
    if (big) return negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return negative ? -0 : 0;
  }
  if (x < 0 && !Number.isInteger(y)) return Number.NaN;
  let r: number;
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    r = y > 0 ? powInt(ax, y) : 1 / powInt(ax, -y);
  } else {
    const l = log(ax);
    const t = y * l;
    if (t > EXP_O_THRESHOLD) r = Number.POSITIVE_INFINITY;
    else if (t < EXP_U_THRESHOLD) r = 0;
    else {
      const e = productError(y, l, t);
      const base = exp(t);
      r = Number.isFinite(e) ? base + base * e : base;
    }
  }
  return x < 0 && odd ? -r : r;
}

// --- sin, cos, tan (k_sin.c, k_cos.c, e_rem_pio2.c) ------------------------------------------

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

function kernelSin(x: number, y: number, iy: boolean): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (!iy) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

function kernelCos(x: number, y: number): number {
  const z = x * x;
  let w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  w = 1 - hz;
  return w + (1 - w - hz + (z * r - x * y));
}

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.0222662487111664558e-21;
const PIO2_3T = 8.47842766036889956997e-32;
const TO_INT = 6755399441055744; // 1.5·2^52: sumar y restar redondea al entero más cercano
/** Más allá de esto la reducción de Cody-Waite pierde precisión; la sim reduce antes (fase = t mod período). */
export const TRIG_MAX = 1647099; // palabra alta 0x413921fb, apenas debajo de 2^20·π/2

/** x = n·π/2 + (y0 + y1), con |y0 + y1| ≤ π/4. */
function remPio2(x: number, ix: number): [number, number, number] {
  if (ix >= 0x413921fb) {
    throw new RangeError(
      `argumento trigonométrico demasiado grande: ${x} (reducir antes, |x| < ${TRIG_MAX})`,
    );
  }
  const fn = x * INV_PIO2 + TO_INT - TO_INT;
  const n = fn | 0;
  let r = x - fn * PIO2_1;
  let w = fn * PIO2_1T;
  let y0 = r - w;
  const j = ix >> 20;
  let i = j - ((hiWord(y0) >> 20) & 0x7ff);
  if (i > 16) {
    let t = r;
    w = fn * PIO2_2;
    r = t - w;
    w = fn * PIO2_2T - (t - r - w);
    y0 = r - w;
    i = j - ((hiWord(y0) >> 20) & 0x7ff);
    if (i > 49) {
      t = r;
      w = fn * PIO2_3;
      r = t - w;
      w = fn * PIO2_3T - (t - r - w);
      y0 = r - w;
    }
  }
  const y1 = r - y0 - w;
  return [n, y0, y1];
}

export function sin(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e500000) return x;
    return kernelSin(x, 0, false);
  }
  if (ix >= 0x7ff00000) return Number.NaN;
  const [n, y0, y1] = remPio2(x, ix);
  switch (n & 3) {
    case 0:
      return kernelSin(y0, y1, true);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1, true);
    default:
      return -kernelCos(y0, y1);
  }
}

export function cos(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e46a09e) return 1;
    return kernelCos(x, 0);
  }
  if (ix >= 0x7ff00000) return Number.NaN;
  const [n, y0, y1] = remPio2(x, ix);
  switch (n & 3) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1, true);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1, true);
  }
}

export function tan(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return x;
  if (ix >= 0x7ff00000) return Number.NaN;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, false) / kernelCos(x, 0);
  const [n, y0, y1] = remPio2(x, ix);
  const s = kernelSin(y0, y1, true);
  const c = kernelCos(y0, y1);
  return (n & 1) === 0 ? s / c : -c / s;
}

// --- atan, atan2, asin, acos (s_atan.c, e_atan2.c) -------------------------------------------

const ATAN_HI = [
  4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1,
  1.570796326794896558,
];
const ATAN_LO = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17,
  6.12323399573676603587e-17,
];
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.1111110405462355788e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.6531572744216915527e-2;
const AT10 = 1.62858201153657823623e-2;

export function atan(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && loWord(x) !== 0)) return Number.NaN;
    const z = (ATAN_HI[3] as number) + (ATAN_LO[3] as number);
    return hx > 0 ? z : -z;
  }
  let id: number;
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return x - x * (s1 + s2);
  const r = (ATAN_HI[id] as number) - (x * (s1 + s2) - (ATAN_LO[id] as number) - x);
  return hx < 0 ? -r : r;
}

const PI_O_4 = 7.85398163397448279e-1;
const PI_O_2 = 1.570796326794896558;
const PI_LO = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (x === 1) return atan(y);
  const hx = hiWord(x);
  const hy = hiWord(y);
  const ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  let m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2); // 2·signo(x) + signo(y)

  if (y === 0) {
    if (m < 2) return y; // atan(±0, +algo) = ±0
    return m === 2 ? PI : -PI;
  }
  if (x === 0) return hy < 0 ? -PI_O_2 : PI_O_2;
  if (!Number.isFinite(x)) {
    if (!Number.isFinite(y)) {
      return [PI_O_4, -PI_O_4, 3 * PI_O_4, -3 * PI_O_4][m] as number;
    }
    return [0, -0, PI, -PI][m] as number;
  }
  if (!Number.isFinite(y)) return hy < 0 ? -PI_O_2 : PI_O_2;

  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    z = PI_O_2 + 0.5 * PI_LO;
    m &= 1;
  } else if (hx < 0 && k < -60) {
    z = 0;
  } else {
    z = atan(Math.abs(y / x));
  }
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

export function asin(x: number): number {
  if (!(Math.abs(x) <= 1)) return Number.NaN;
  return atan2(x, sqrt((1 - x) * (1 + x)));
}

export function acos(x: number): number {
  if (!(Math.abs(x) <= 1)) return Number.NaN;
  return atan2(sqrt((1 - x) * (1 + x)), x);
}

// --- otras -----------------------------------------------------------------------------------

/** √(x² + y²) sin desbordar en el medio. */
export function hypot(x: number, y: number): number {
  const a = Math.abs(x);
  const b = Math.abs(y);
  if (a === Number.POSITIVE_INFINITY || b === Number.POSITIVE_INFINITY)
    return Number.POSITIVE_INFINITY;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  const m = a > b ? a : b;
  if (m === 0) return 0;
  const p = a / m;
  const q = b / m;
  return m * sqrt(p * p + q * q);
}

/** 1 / (1 + e^-x): la curva en S de las utilidades y los umbrales blandos. */
export function logistic(x: number): number {
  if (x >= 0) return 1 / (1 + exp(-x));
  const e = exp(x);
  return e / (1 + e);
}

// Coeficientes de Acklam para la inversa de la normal (error relativo < 1.15e-9).
const QA = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
  -3.066479806614716e1, 2.506628277459239,
];
const QB = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
  -1.328068155288572e1,
];
const QC = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
];
const QD = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

function tail(q: number): number {
  const [c0, c1, c2, c3, c4, c5] = QC as [number, number, number, number, number, number];
  const [d0, d1, d2, d3] = QD as [number, number, number, number];
  return (
    (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
    ((((d0 * q + d1) * q + d2) * q + d3) * q + 1)
  );
}

/** Cuantil de la normal estándar: el z con P(Z ≤ z) = p, para p en (0, 1). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return Number.NEGATIVE_INFINITY;
    if (p === 1) return Number.POSITIVE_INFINITY;
    return Number.NaN;
  }
  const low = 0.02425;
  if (p < low) return tail(sqrt(-2 * log(p)));
  if (p > 1 - low) return -tail(sqrt(-2 * log(1 - p)));
  const [a0, a1, a2, a3, a4, a5] = QA as [number, number, number, number, number, number];
  const [b0, b1, b2, b3, b4] = QB as [number, number, number, number, number];
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) /
    (((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1)
  );
}
