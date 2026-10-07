// El turno del stub (player-loop §3, Fase 0): el plan entra al personaje, el mundo avanza hasta
// que el plan termina o alguien se mete con el personaje, y sale una vista con lo que el
// personaje percibió. La vista es un stub de `PlayerView` (narration §2): solo lo que pasó con
// él o a la vista en la aldea, nunca la verdad entera. El rutinario `work` de los otros no se
// nota.

import type { EventLog, Ledger } from "../../core/index.ts";
import {
  type AgentId,
  type Event,
  holderAccount,
  type IdAllocator,
  type IdCounterState,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import {
  hashState,
  type SchedulerState,
  type StateHash,
  type WorldTruth,
} from "../../sim/index.ts";
import {
  COIN,
  createStubWorld,
  HUT,
  INTENT,
  intentKey,
  living,
  PLAYER,
  planDuration,
  resumeStubWorld,
  type StubPlan,
  type StubSetup,
  type StubWorld,
} from "./world.ts";

/** Lo que el personaje notó de un evento, con etiquetas en vez de ids. */
export interface SeenEvent {
  readonly tick: Tick;
  readonly kind: string;
  readonly actors: readonly string[];
  readonly data: unknown;
}

export interface StubView {
  readonly now: Tick;
  readonly purse: number;
  readonly huts: number;
  /** La gente que el personaje ve en la aldea (sin él). */
  readonly people: readonly string[];
}

export interface TurnReport {
  readonly from: Tick;
  readonly to: Tick;
  readonly interrupted: boolean;
  readonly seen: readonly SeenEvent[];
  readonly view: StubView;
  /** Si el personaje ya no está (en el stub no se muere, pero el loop lo mira). */
  readonly over: boolean;
}

/** Lo que hace falta para guardar o seguir la vida (la forma de `LifeState`). */
export interface StubState {
  readonly truth: WorldTruth;
  readonly log: EventLog;
  readonly ledger: Ledger;
  readonly ids: IdCounterState;
  readonly scheduler: SchedulerState;
}

export function label(id: string, player: AgentId): string {
  if (id === player) return "vos";
  const [kind, n] = id.split(":");
  return kind === "agent" ? `aldeano ${n}` : `${kind} ${n}`;
}

export class StubSession {
  readonly #w: StubWorld;
  readonly player: AgentId;

  private constructor(w: StubWorld) {
    this.#w = w;
    const [player] = w.truth.ids(PLAYER) as AgentId[];
    if (!player) throw new Error("el mundo no tiene personaje");
    this.player = player;
  }

  static create(seed: Seed, setup: StubSetup): StubSession {
    return new StubSession(createStubWorld(seed, setup));
  }

  static resume(
    seed: Seed,
    s: {
      truth: WorldTruth;
      ids: IdAllocator;
      log: EventLog;
      ledger: Ledger;
      scheduler: SchedulerState;
    },
  ): StubSession {
    return new StubSession(resumeStubWorld(seed, s));
  }

  get now(): Tick {
    return this.#w.scheduler.now;
  }

  state(): StubState {
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
  submit(plan: StubPlan, seq: number): Tick {
    const w = this.#w;
    const now = w.scheduler.now;
    const end = now + planDuration(plan);
    w.truth.set(INTENT, this.player, { seq, plan, at: now });
    w.scheduler.schedule({
      at: end,
      phase: "act",
      process: "stub.intent",
      scope: this.player,
      reason: { kind: "state", entity: this.player, key: intentKey(seq) },
    });
    return end;
  }

  advanceTo(t: Tick): void {
    this.#w.scheduler.advanceTo(t);
  }

  /** Un turno: el plan, el avance con interrupciones y lo que el personaje vio. */
  turn(plan: StubPlan, seq: number): TurnReport {
    const from = this.now;
    const end = this.submit(plan, seq);
    const seen: SeenEvent[] = [];
    const interruptible = plan.verb === "wait";
    const result = this.#w.scheduler.advanceUntil(end, (report) => {
      let interrupt = false;
      for (const e of report.events) {
        if (!this.#notices(e)) continue;
        seen.push(this.#see(e));
        // Alguien se metió con el personaje: una espera se corta para que el usuario decida.
        // Lo que está haciendo (una choza, un regalo) se termina; las reglas de interrupción
        // configurables llegan con las rutinas (§5, §6).
        if (interruptible && e.actors[0] !== this.player && e.actors.includes(this.player)) {
          interrupt = true;
        }
      }
      return interrupt;
    });
    return {
      from,
      to: result.now,
      interrupted: result.interrupted,
      seen,
      view: this.view(),
      over: !this.alive,
    };
  }

  get alive(): boolean {
    return living(this.#w.truth).includes(this.player);
  }

  /** Lo que el personaje sabe de sí y ve alrededor. */
  view(): StubView {
    const w = this.#w;
    return {
      now: this.now,
      purse: w.ledger.balance(holderAccount(this.player), COIN),
      huts: w.truth.ids(HUT).filter((h) => w.truth.get(HUT, h)?.owner === this.player).length,
      people: living(w.truth)
        .filter((a) => a !== this.player)
        .map((a) => label(a, this.player)),
    };
  }

  #notices(e: Event): boolean {
    if (e.actors.includes(this.player)) return true;
    return e.kind === "gift" || e.kind === "build";
  }

  #see(e: Event): SeenEvent {
    const data =
      e.kind === "give-failed" && e.data !== null && typeof e.data === "object"
        ? {
            ...(e.data as Record<string, unknown>),
            to: label(String((e.data as { to: string }).to), this.player),
          }
        : e.data;
    return {
      tick: e.tick,
      kind: e.kind,
      actors: e.actors.map((a) => label(a, this.player)),
      data: e.kind === "build" ? null : data,
    };
  }
}

/** Las versiones del stub para el replay (tooling §4): la del formato la pone quien guarda. */
export const STUB_ENGINE = "stub-0";

/** El stub como juego del replay (tools/replay), sin importarlo: misma forma. */
export function stubReplayGame(versions: { engine: string; content: string; format: number }) {
  return {
    versions,
    start(seed: Seed, setup: StubSetup) {
      const s = StubSession.create(seed, setup);
      return {
        advanceTo: (t: Tick) => s.advanceTo(t),
        submit: (plan: StubPlan, seq: number) => void s.submit(plan, seq),
        hash: () => s.hash(),
      };
    },
  };
}
