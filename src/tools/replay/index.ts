// Replay básico (tooling §3): rehace una vida desde el seed y los planes validados del jugador,
// sin LLM, y compara el hash del estado (tooling §2) en cada checkpoint guardado. La primera
// divergencia dice en qué tick y en qué partes (`c:<componente>`, `events`, `ledger`…) se
// separaron las dos corridas, que es por donde se empieza a buscar.
//
// El juego concreto entra por `ReplayGame`: el replay no sabe armar un mundo ni aplicar un plan,
// solo el orden. En cada tick con algo que hacer: avanzar hasta ahí, comparar el checkpoint (el
// estado después de `advanceTo(t)` y antes de los planes de t) y recién después aplicar los planes
// de ese tick en el orden en que se guardaron.

import { canonicalJson, compareStrings, type Seed, type Tick } from "../../core/index.ts";
import type { LifeStore } from "../../persistence/index.ts";
import { diffStateHashes, type StateHash } from "../../sim/index.ts";

/** Las versiones que tienen que coincidir para que el replay valga (tooling §4). */
export interface ReplayVersions {
  readonly engine: string;
  readonly content: string;
  readonly format: number;
}

export interface ReplayPlan<P = unknown> {
  readonly seq: number;
  readonly tick: Tick;
  readonly plan: P;
}

export interface ReplayInput<S = unknown, P = unknown> {
  readonly seed: Seed;
  readonly versions: ReplayVersions;
  /** Lo que se eligió antes de empezar (modo, personaje…): parte de la entrada, como el seed. */
  readonly setup: S;
  readonly plans: readonly ReplayPlan<P>[];
}

export interface Checkpoint {
  readonly tick: Tick;
  readonly hash: StateHash;
}

/** Una corrida en marcha del juego que se rehace. */
export interface ReplayRun<P> {
  advanceTo(tick: Tick): void;
  submit(plan: P, seq: number, tick: Tick): void;
  hash(): StateHash;
}

export interface ReplayGame<S, P> {
  readonly versions: ReplayVersions;
  start(seed: Seed, setup: S): ReplayRun<P>;
}

export interface ReplayDivergence {
  readonly tick: Tick;
  readonly expected: string;
  readonly actual: string;
  /** Las partes del hash que no coinciden, ordenadas. */
  readonly parts: readonly string[];
}

export interface ReplayReport {
  readonly tick: Tick;
  readonly hash: StateHash;
  readonly checked: number;
  readonly divergence?: ReplayDivergence;
}

export interface ReplayOptions {
  /** Hasta dónde correr; por defecto, el último plan o checkpoint. */
  readonly until?: Tick;
  readonly checkpoints?: readonly Checkpoint[];
}

export class ReplayError extends Error {
  override name = "ReplayError";
}

/** Rehace la vida y para en la primera divergencia. */
export function replay<S, P>(
  input: ReplayInput<S, P>,
  game: ReplayGame<S, P>,
  options: ReplayOptions = {},
): ReplayReport {
  if (canonicalJson(input.versions) !== canonicalJson(game.versions)) {
    throw new ReplayError(
      `versiones distintas: guardado ${canonicalJson(input.versions)}, juego ${canonicalJson(game.versions)}`,
    );
  }
  for (let i = 1; i < input.plans.length; i++) {
    const a = input.plans[i - 1] as ReplayPlan<P>;
    const b = input.plans[i] as ReplayPlan<P>;
    if (b.seq <= a.seq || b.tick < a.tick) {
      throw new ReplayError(
        `planes fuera de orden: #${a.seq}@${a.tick} antes de #${b.seq}@${b.tick}`,
      );
    }
  }
  const checkpoints = [...(options.checkpoints ?? [])].sort((a, b) => a.tick - b.tick);
  const last = Math.max(0, input.plans.at(-1)?.tick ?? 0, checkpoints.at(-1)?.tick ?? 0);
  const until = options.until ?? last;

  const ticks = [...new Set([...input.plans.map((p) => p.tick), ...checkpoints.map((c) => c.tick)])]
    .filter((t) => t <= until)
    .sort((a, b) => a - b);

  const run = game.start(input.seed, input.setup);
  let checked = 0;
  let p = 0;
  let c = 0;
  for (const t of ticks) {
    run.advanceTo(t);
    while (c < checkpoints.length && (checkpoints[c] as Checkpoint).tick === t) {
      const expected = (checkpoints[c] as Checkpoint).hash;
      c++;
      const actual = run.hash();
      checked++;
      if (actual.total !== expected.total) {
        return {
          tick: t,
          hash: actual,
          checked,
          divergence: {
            tick: t,
            expected: expected.total,
            actual: actual.total,
            parts: diffStateHashes(expected, actual),
          },
        };
      }
    }
    while (p < input.plans.length && (input.plans[p] as ReplayPlan<P>).tick === t) {
      const plan = input.plans[p] as ReplayPlan<P>;
      run.submit(plan.plan, plan.seq, plan.tick);
      p++;
    }
  }
  run.advanceTo(until);
  return { tick: until, hash: run.hash(), checked };
}

/** Las claves de `meta` que el replay necesita de un guardado. */
export const REPLAY_META = ["seed", "versions", "setup"] as const;

/** Arma la entrada del replay desde una vida guardada, con sus checkpoints. */
export function replayInputFromStore(store: LifeStore): {
  input: ReplayInput;
  checkpoints: Checkpoint[];
} {
  const missing = REPLAY_META.filter((k) => store.getMeta(k) === undefined).sort(compareStrings);
  if (missing.length > 0) throw new ReplayError(`al guardado le falta: ${missing.join(", ")}`);
  return {
    input: {
      seed: store.getMeta("seed") as Seed,
      versions: store.getMeta("versions") as ReplayVersions,
      setup: store.getMeta("setup"),
      plans: store.plans().map((p) => ({ seq: p.seq, tick: p.tick, plan: p.plan })),
    },
    checkpoints: store.checkpoints(),
  };
}
