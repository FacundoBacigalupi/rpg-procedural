// La única operación elemental (elements §3): un contacto entre un vector activo y uno pasivo.
// Vencer disuelve en esencia desordenada (`released`), generar convierte con pérdida, y la suma
// de lo que había antes es la suma de lo que queda más lo liberado: nada se crea ni se destruye
// (causality §3). Pura: el único azar es el ruido de control, y sale del `Rng` que pasa el que llama.

import type { Rng } from "../../core/index.ts";
import type { ElementSystemDef, PhysicalSignature } from "./system.ts";

/** Cantidades de esencia por elemento, en el orden de `ElementSystemDef.elements`. */
export type ElementVector = readonly number[];

export type InteractionKind = "clash" | "infusion" | "mixing" | "absorption" | "field" | "refining";

export interface ContainerState {
  /** La tensión que aguanta (elements §4). Si la mezcla la supera, se rompe y suelta lo que tenía. */
  readonly capacity: number;
  /** Cuánta esencia desordenada puede dejar escapar por tick sin que sea una explosión. */
  readonly vent?: number;
  /** Cuánto cabe en total: limita lo que se puede generar hacia el pasivo. */
  readonly volume?: number;
}

export interface ControlState {
  /** 0-1: con 1 la interacción sale exacta; con menos, el acoplamiento tiembla. */
  readonly precision: number;
  readonly rng: Rng;
}

export interface InteractionContext {
  readonly kind: InteractionKind;
  /** 0-1 por tick: qué tan íntimo es el contacto. */
  readonly coupling: number;
  /** En ticks del contexto. */
  readonly duration: number;
  readonly control?: ControlState;
  readonly container?: ContainerState;
}

export interface PhysicalEffects extends PhysicalSignature {
  /** Carga que suma tener lo mismo de los dos lados; el contenedor tiene que aguantarla. */
  readonly resonance: number;
}

export interface InteractionResult {
  readonly activeAfter: ElementVector;
  readonly passiveAfter: ElementVector;
  /** Esencia desordenada que sale al contenedor o al ambiente. */
  readonly released: number;
  /** Lo que sintió la materia: la firma física de cada elemento por lo que se disolvió o convirtió. */
  readonly physical: PhysicalEffects;
  /** Onda de choque: lo liberado por tick por encima de lo que el contenedor deja escapar. */
  readonly burst: number;
  /** Cuánto cambió la tensión del conjunto (activo + pasivo). */
  readonly tensionDelta: number;
  /** El contenedor se rompió y el pasivo soltó todo lo que tenía. */
  readonly ruptured: boolean;
}

const MAX_STEPS = 64;
/** Cuánto tiembla el acoplamiento con un control del todo impreciso. */
const CONTROL_NOISE = 0.5;

/** Tensión interna de un vector (elements §4): lo que se vence menos lo que se alimenta. */
export function tension(v: ElementVector, law: ElementSystemDef): number {
  const total = sum(v);
  if (!(total > 0)) return 0;
  let t = 0;
  for (let a = 0; a < v.length; a++) {
    const va = v[a] as number;
    if (!(va > 0)) continue;
    for (let b = 0; b < v.length; b++) {
      const vb = v[b] as number;
      if (!(vb > 0)) continue;
      t += (k(law, a, b) - g(law, a, b)) * va * vb;
    }
  }
  return t / total;
}

export function sum(v: ElementVector): number {
  let s = 0;
  for (const x of v) s += x;
  return s;
}

/** Suma `x` a la posición `i` (sin dejarla bajo cero si `floor`). */
function bump(v: number[], i: number, x: number, floor = false): void {
  const next = (v[i] as number) + x;
  v[i] = floor ? Math.max(0, next) : next;
}

const k = (law: ElementSystemDef, a: number, b: number) => (law.K[a] as number[])[b] as number;
const g = (law: ElementSystemDef, a: number, b: number) => (law.G[a] as number[])[b] as number;

type Side = 0 | 1;

interface Flow {
  /** Lo que sale de cada fuente: `[lado, elemento, cantidad]`. */
  readonly draws: readonly (readonly [Side, number, number])[];
  /** Lo que llega: `[lado, elemento, cantidad]`. El resto de lo sacado queda liberado. */
  readonly gives: readonly (readonly [Side, number, number])[];
}

export function interact(
  active: ElementVector,
  passive: ElementVector,
  ctx: InteractionContext,
  law: ElementSystemDef,
): InteractionResult {
  const n = law.elements.length;
  if (active.length !== n || passive.length !== n) {
    throw new RangeError(`los vectores tienen que ser de ${n} elementos`);
  }
  if (!(ctx.duration >= 0) || !(ctx.coupling >= 0) || ctx.coupling > 1) {
    throw new RangeError("acoplamiento fuera de 0-1 o duración negativa");
  }
  for (const x of [...active, ...passive]) {
    if (!(x >= 0) || !Number.isFinite(x)) throw new RangeError("cantidad de esencia inválida");
  }

  let coupling = ctx.coupling;
  if (ctx.control) {
    const wobble = (ctx.control.rng.float() * 2 - 1) * CONTROL_NOISE * (1 - ctx.control.precision);
    coupling = Math.min(1, Math.max(0, coupling * (1 + wobble)));
  }

  const sides: [number[], number[]] = [[...active], [...passive]];
  const touched = new Array<number>(n).fill(0);
  const volume = ctx.container?.volume;
  let released = 0;
  let resonance = 0;

  const steps = Math.max(1, Math.min(MAX_STEPS, Math.ceil(ctx.duration)));
  const dt = ctx.duration / steps;
  const rate = Math.min(1, coupling * dt);

  for (let s = 0; s < steps && rate > 0; s++) {
    const A = sides[0];
    const B = sides[1];
    const flows: Flow[] = [];
    // Un duelo entre `atk` (lado `as`) y `def` (el otro): vence quien tiene más, salvo que el
    // vencido supere a quien lo ataca por λ, y entonces es él quien disuelve (相侮).
    const duel = (as: Side, ai: number, di: number) => {
      const ds: Side = as === 0 ? 1 : 0;
      const atk = (sides[as] as number[])[ai] as number;
      const def = (sides[ds] as number[])[di] as number;
      const kk = k(law, ai, di);
      if (!(atk > 0) || !(def > 0) || !(kk > 0)) return;
      const m = Math.min(atk, def);
      if (atk * law.insultRatio >= def) {
        const d = rate * kk * m;
        flows.push({
          draws: [
            [ds, di, d],
            [as, ai, law.overcomeCost * d],
          ],
          gives: [],
        });
      } else {
        const d = rate * kk * law.inversionStrength * m;
        flows.push({
          draws: [
            [as, ai, d],
            [ds, di, law.overcomeCost * d],
          ],
          gives: [],
        });
      }
    };
    let roomLeft = volume === undefined ? Number.POSITIVE_INFINITY : volume - sum(B);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        duel(0, i, j);
        duel(1, j, i);
        const gg = g(law, i, j);
        const ai = A[i] as number;
        if (ctx.kind !== "clash" && gg > 0 && ai > 0 && i !== j) {
          const t = Math.min(rate * gg * ai, Math.max(0, roomLeft));
          if (t > 0) {
            roomLeft -= t * (1 - law.generationLoss);
            flows.push({
              draws: [[0, i, t]],
              gives: [[1, j, t * (1 - law.generationLoss)]],
            });
          }
        }
      }
      const same = Math.min(A[i] as number, B[i] as number);
      resonance += rate * law.resonance * same;
    }

    // Ninguna fuente puede dar más de lo que tiene: cada flujo se achica por la fuente más corta.
    const demand: [number[], number[]] = [new Array(n).fill(0), new Array(n).fill(0)];
    for (const f of flows) {
      for (const [side, e, amt] of f.draws) bump(demand[side], e, amt);
    }
    for (const f of flows) {
      let scale = 1;
      for (const [side, e] of f.draws) {
        const want = (demand[side] as number[])[e] as number;
        const have = (sides[side] as number[])[e] as number;
        if (want > have) scale = Math.min(scale, have / want);
      }
      let out = 0;
      for (const [side, e, amt] of f.draws) {
        const x = amt * scale;
        bump(sides[side], e, -x, true);
        bump(touched, e, x);
        out += x;
      }
      let into = 0;
      for (const [side, e, amt] of f.gives) {
        const x = amt * scale;
        bump(sides[side], e, x);
        into += x;
      }
      released += out - into;
    }
  }

  const tensionBefore = tension(
    active.map((x, i) => x + (passive[i] as number)),
    law,
  );

  let ruptured = false;
  const combinedAfter = (sides[0] as number[]).map(
    (x, i) => x + ((sides[1] as number[])[i] as number),
  );
  const tensionAfter = tension(combinedAfter, law);
  if (ctx.container && tensionAfter + resonance > ctx.container.capacity) {
    ruptured = true;
    const passiveSide = sides[1] as number[];
    for (let i = 0; i < n; i++) {
      released += passiveSide[i] as number;
      passiveSide[i] = 0;
    }
  }

  const physical = { heat: 0, moisture: 0, rigidity: 0, motion: 0, vitality: 0 };
  for (let e = 0; e < n; e++) {
    const sig = (law.elements[e] as ElementSystemDef["elements"][number]).physical;
    const amt = touched[e] as number;
    physical.heat += amt * sig.heat;
    physical.moisture += amt * sig.moisture;
    physical.rigidity += amt * sig.rigidity;
    physical.motion += amt * sig.motion;
    physical.vitality += amt * sig.vitality;
  }

  const perTick = ctx.duration > 0 ? released / Math.max(1, ctx.duration) : released;
  const burst = Math.max(0, perTick - (ctx.container?.vent ?? 0));
  const tensionNow = ruptured ? tension(sides[0] as number[], law) : tensionAfter;

  return {
    activeAfter: sides[0],
    passiveAfter: sides[1],
    released,
    physical: { ...physical, resonance },
    burst,
    tensionDelta: tensionNow - tensionBefore,
    ruptured,
  };
}
