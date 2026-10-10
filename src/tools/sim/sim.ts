// Sim headless (tooling §6, §8, §9): corre una vida sin jugador durante N años, con los
// invariantes cada cierto tramo, y devuelve un reporte JSON con métricas. Si un invariante se
// viola, la corrida se detiene y arma el paquete de reproducción (`repro.json`) con lo mínimo para
// rehacer el fallo desde el seed. Nunca llama al LLM.

import {
  type AgentId,
  type Content,
  canonicalJson,
  type EventId,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import {
  addAccuracy,
  LIFE_ENGINE,
  Life,
  type LifeSetup,
  optionsOf,
  playerInferenceAccuracy,
} from "../../game/index.ts";
import {
  type BeliefAccuracy,
  beliefAccuracy,
  checkInvariants,
  ENTITY,
  INFERENCE_RULES,
  type InferenceAccuracy,
  MEMORIES,
  RUMORS,
  type Rumors,
  rumorDeformation,
  rumorTree,
  type StateHash,
} from "../../sim/index.ts";

/** Resumen de `rumorDeformation` sobre todos los hechos que circulan como rumor. */
export interface RumorDeformationMetric {
  /** Hechos con al menos una versión oída. */
  readonly roots: number;
  /** Versiones guardadas en total. */
  readonly versions: number;
  /** Deformación media por salto (clave = salto) sobre todos los árboles. */
  readonly meanByHop: Readonly<Record<string, number>>;
  /** Media de la distancia de la versión dominante a la de menor salto (0 si no hay). */
  readonly dominantDistance: number;
}

export function rumorDeformationMetric(
  holders: ReadonlyMap<AgentId, Rumors | undefined>,
): RumorDeformationMetric {
  const roots = new Set<EventId>();
  for (const r of holders.values()) for (const h of r?.items ?? []) roots.add(h.root);
  const sums = new Map<number, { total: number; n: number }>();
  let versions = 0;
  let dom = 0;
  let doms = 0;
  for (const root of [...roots].sort()) {
    const tree = rumorTree(root, holders);
    versions += tree.variants.length;
    const d = rumorDeformation(tree);
    for (const s of d.steps) {
      const acc = sums.get(s.hops) ?? { total: 0, n: 0 };
      sums.set(s.hops, { total: acc.total + s.mean * s.versions, n: acc.n + s.versions });
    }
    if (d.dominant) {
      dom += d.dominant.distance;
      doms++;
    }
  }
  const meanByHop: Record<string, number> = {};
  for (const [hops, a] of [...sums].sort((x, y) => x[0] - y[0])) {
    meanByHop[String(hops)] = Math.round((a.total / a.n) * 1000) / 1000;
  }
  return {
    roots: roots.size,
    versions,
    meanByHop,
    dominantDistance: doms > 0 ? Math.round((dom / doms) * 1000) / 1000 : 0,
  };
}

export interface SimOptions {
  readonly seed: Seed;
  readonly content: Content;
  readonly setup: LifeSetup;
  /** Años de mundo a correr desde el tick actual. */
  readonly years: number;
  /** Cada cuántos días de mundo se corren los invariantes. */
  readonly checkEveryDays?: number;
  /** Reloj de pared, inyectado para que el rendimiento quede fuera de la sim (regla 2). */
  readonly now?: () => number;
}

export const CHECK_EVERY_DAYS = 30;

export interface ReproPackage {
  readonly kind: "invariant" | "narrator" | "manual";
  readonly versions: { engine: string; content: string; format: number };
  readonly seed: Seed;
  readonly setup: LifeSetup;
  /** Los planes del jugador hasta el fallo (la sim headless no tiene). */
  readonly plans: readonly unknown[];
  readonly tick: Tick;
  readonly problems: readonly string[];
  /** Solo en `kind: "narrator"`: lo que vio el narrador y lo que salió (tooling §9). */
  readonly narrator?: NarratorRepro;
}

/** La vista, el prompt y la salida de un turno de narración rechazado por el validador. */
export interface NarratorRepro {
  /** El `PlayerView` con el que se armó el pedido (nunca la verdad: narration §2). */
  readonly view: unknown;
  readonly system: string;
  readonly user: string;
  /** Lo que se mostró en su lugar (plantillas) y por qué no se usó el modelo. */
  readonly output: string;
  readonly source: "llm" | "templates";
}

export interface SimReport {
  readonly seed: Seed;
  readonly years: number;
  readonly from: Tick;
  readonly to: Tick;
  readonly stoppedEarly: boolean;
  readonly checks: number;
  readonly metrics: {
    readonly events: number;
    readonly eventsByKind: Readonly<Record<string, number>>;
    readonly agentsAlive: number;
    readonly agentsDead: number;
    readonly deathsByCause: Readonly<Record<string, number>>;
    readonly playerAlive: boolean;
    readonly ledgerProblems: number;
    /** Exactitud de las creencias de todos al final de la corrida (tooling §6). */
    readonly beliefs: BeliefAccuracy;
    /** Conclusiones del personaje contra la verdad, sumadas sobre los chequeos (tooling §6). */
    readonly inference: InferenceAccuracy;
    readonly memories: { readonly holders: number; readonly items: number; readonly gists: number };
    /** Deformación de los rumores al final de la corrida (tooling §6, information §9). */
    readonly rumorDeformation: RumorDeformationMetric;
  };
  readonly performance: { readonly wallMs: number; readonly msPerWorldDay: number };
  readonly hash: StateHash;
  readonly repro?: ReproPackage;
}

function tally(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sorted(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function runSim(options: SimOptions): SimReport {
  const { seed, content, setup, years } = options;
  const wall = options.now ?? (() => performance.now());
  const started = wall();
  const life = Life.create(seed, content, optionsOf(setup));
  const w = life.world;
  const from = life.now;
  const target = from + Math.round(years * w.clock.year);
  const step = Math.round((options.checkEveryDays ?? CHECK_EVERY_DAYS) * w.clock.day);
  const versions = { engine: LIFE_ENGINE, content: content.hash, format: 1 };

  const rules = content.all(INFERENCE_RULES);
  let inference: InferenceAccuracy = { total: 0, checked: 0, wrong: 0, confidentlyWrong: 0 };
  let checks = 0;
  let repro: ReproPackage | undefined;
  while (life.now < target) {
    life.advanceTo(Math.min(target, life.now + step));
    const problems = checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger });
    checks++;
    inference = addAccuracy(inference, playerInferenceAccuracy(w, rules));
    if (problems.length > 0) {
      repro = {
        kind: "invariant",
        versions,
        seed,
        setup,
        plans: [],
        tick: life.now,
        problems: problems.slice(0, 50),
      };
      break;
    }
  }

  const byKind = new Map<string, number>();
  const causes = new Map<string, number>();
  for (const e of w.log.all()) {
    tally(byKind, e.kind);
    if (e.kind === "body.died") tally(causes, String((e.data as { cause?: unknown })?.cause));
  }
  let alive = 0;
  let dead = 0;
  for (const id of w.truth.ids(ENTITY)) {
    if (!id.startsWith("agent:")) continue;
    if (w.truth.get(ENTITY, id)?.endedAt === undefined) alive++;
    else dead++;
  }
  const memories = { holders: 0, items: 0, gists: 0 };
  for (const id of w.truth.ids(MEMORIES)) {
    const m = w.truth.get(MEMORIES, id);
    if (!m) continue;
    memories.holders++;
    memories.items += m.items.length;
    memories.gists += m.gists.length;
  }
  const holders = new Map<AgentId, Rumors | undefined>();
  for (const h of w.truth.ids(RUMORS)) holders.set(h as AgentId, w.truth.get(RUMORS, h));
  const wallMs = wall() - started;
  const worldDays = (life.now - from) / w.clock.day;

  return {
    seed,
    years,
    from,
    to: life.now,
    stoppedEarly: repro !== undefined,
    checks,
    metrics: {
      events: w.log.all().length,
      eventsByKind: sorted(byKind),
      agentsAlive: alive,
      agentsDead: dead,
      deathsByCause: sorted(causes),
      playerAlive: life.alive,
      ledgerProblems: w.ledger.audit().length,
      beliefs: beliefAccuracy(w.truth, life.now),
      inference,
      memories,
      rumorDeformation: rumorDeformationMetric(holders),
    },
    performance: { wallMs, msPerWorldDay: worldDays > 0 ? wallMs / worldDays : 0 },
    hash: life.hash(),
    ...(repro ? { repro } : {}),
  };
}

/** El reporte sin lo que depende del reloj de pared: lo que se compara entre corridas. */
export function deterministicPart(report: SimReport): string {
  const { performance: _p, ...rest } = report;
  return canonicalJson(rest);
}
