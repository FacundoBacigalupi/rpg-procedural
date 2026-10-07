// La vida en curso (player-loop §3, Fase 1): el plan del jugador entra al personaje, el mundo
// avanza hasta que el plan termina, se interrumpe o el personaje muere, y el turno devuelve lo que
// pasó. El mismo `submit` + `advanceTo` es el que rehace el replay (tooling §4).

import type { AgentId, Event, IdAllocator, Seed, Tick } from "../../core/index.ts";
import { type Content, MINUTE } from "../../core/index.ts";
import {
  type ActionPlan,
  ENTITY,
  FRESH_CURSOR,
  hashState,
  type SchedulerState,
  type StateHash,
  type WorldTruth,
} from "../../sim/index.ts";
import type { GameSetup } from "../setup/index.ts";
import { ACT_PROCESS, PLAN_STATE, type PlanState, planKey, type StepRecord } from "./act.ts";
import { createLife, type LifeOptions, type LifeTerrain } from "./create.ts";
import { type LifeParts, type LifeWorld, lifeWorld } from "./world.ts";

/** El largo máximo de un turno: más que eso es una rutina (player-loop §5), que llega después. */
export const MAX_TURN_DAYS = 30;

/** Lo que se elige antes de empezar y entra al replay como el seed (tooling §3). */
export interface LifeSetup {
  readonly game: GameSetup;
  /** Frecuencia de la grilla del planeta; sin ella, la del planeta real. */
  readonly frequency?: number;
}

/** Las versiones del motor para el replay (tooling §4): la del formato la pone quien guarda. */
export const LIFE_ENGINE = "life-1";

/** La vida como juego del replay (tools/replay), sin importarlo: misma forma. */
export function lifeReplayGame(
  content: Content,
  versions: { engine: string; content: string; format: number },
) {
  return {
    versions,
    start(seed: Seed, setup: LifeSetup) {
      const life = Life.create(seed, content, optionsOf(setup));
      return {
        advanceTo: (t: Tick) => life.advanceTo(t),
        submit: (plan: ActionPlan, seq: number) => life.submit(plan, seq),
        hash: () => life.hash(),
      };
    },
  };
}

export function optionsOf(setup: LifeSetup): LifeOptions {
  return setup.frequency === undefined ? {} : { frequency: setup.frequency };
}

export interface TurnReport {
  readonly from: Tick;
  readonly to: Tick;
  readonly interrupted: boolean;
  /** Los pasos del plan que se hicieron, con la autopercepción de cada uno. */
  readonly steps: readonly StepRecord[];
  /** Los eventos del personaje y de su cuerpo durante el turno. */
  readonly events: readonly Event[];
  /** El personaje ya no está. */
  readonly over: boolean;
}

/** Lo que hace falta para guardar o seguir la vida (la forma de `LifeState`). */
export interface LifeState {
  readonly truth: WorldTruth;
  readonly log: LifeWorld["log"];
  readonly ledger: LifeWorld["ledger"];
  readonly ids: ReturnType<IdAllocator["state"]>;
  readonly scheduler: SchedulerState;
}

export class Life {
  readonly #w: LifeWorld;
  readonly terrain: LifeTerrain;

  private constructor(w: LifeWorld, terrain: LifeTerrain) {
    this.#w = w;
    this.terrain = terrain;
  }

  static create(seed: Seed, content: Content, options: LifeOptions = {}): Life {
    const { world, terrain } = createLife(seed, content, options);
    return new Life(world, terrain);
  }

  /** Sigue una vida guardada: lo derivado del seed se rehace, el estado viene de la base. */
  static resume(
    seed: Seed,
    content: Content,
    saved: Pick<LifeWorld, "truth" | "ids" | "log" | "ledger"> & { scheduler: SchedulerState },
    options: LifeOptions = {},
  ): Life {
    const { world, terrain } = createLife(seed, content, options);
    const parts: LifeParts = { ...world, ...saved };
    const resumed = lifeWorld(parts, world.player, terrain.village, saved.scheduler);
    return new Life(resumed, terrain);
  }

  get player(): AgentId {
    return this.#w.player;
  }

  get now(): Tick {
    return this.#w.scheduler.now;
  }

  get world(): LifeWorld {
    return this.#w;
  }

  get alive(): boolean {
    return this.#w.truth.get(ENTITY, this.player)?.endedAt === undefined;
  }

  state(): LifeState {
    const w = this.#w;
    return {
      truth: w.truth,
      log: w.log,
      ledger: w.ledger,
      ids: w.ids.state(),
      scheduler: w.scheduler.state(),
    };
  }

  hash(): StateHash {
    return hashState(this.state());
  }

  /** El plan entra al personaje sin avanzar: lo que comparten el turno y el replay. */
  submit(plan: ActionPlan, seq: number): void {
    const w = this.#w;
    const state: PlanState = {
      seq,
      plan,
      cursor: FRESH_CURSOR,
      lastBelieved: null,
      steps: [],
      done: false,
    };
    w.truth.set(PLAN_STATE, this.player, state);
    w.scheduler.schedule({
      at: w.scheduler.now + 1,
      phase: "act",
      process: ACT_PROCESS,
      scope: this.player,
      reason: { kind: "state", entity: this.player, key: planKey(seq) },
    });
  }

  advanceTo(t: Tick): void {
    this.#w.scheduler.advanceTo(t);
  }

  /** Un turno: el plan, el avance hasta que termina o algo lo corta, y lo que pasó. */
  turn(plan: ActionPlan, seq: number): TurnReport {
    const w = this.#w;
    const from = this.now;
    this.submit(plan, seq);
    const events: Event[] = [];
    const cap = from + MAX_TURN_DAYS * w.clock.day;
    const result = w.scheduler.advanceUntil(cap, (report) => {
      for (const e of report.events) {
        if (e.actors.includes(this.player)) events.push(e);
      }
      if (!this.alive) return true;
      return w.truth.get(PLAN_STATE, this.player)?.done ?? true;
    });
    const state = w.truth.get(PLAN_STATE, this.player);
    return {
      from,
      to: result.now,
      interrupted: result.interrupted && !(state?.done ?? true),
      steps: state?.steps ?? [],
      events,
      over: !this.alive,
    };
  }
}

export { MINUTE };
