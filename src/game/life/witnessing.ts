// Los NPC presentes perciben lo que otros hacen (perception §12, npc-psychology §18): al cerrar
// cada paso, los vecinos del hex de quien actuó lo ven u oyen con sus propios sentidos y guardan
// un percept, con presupuesto por evento y detalle según su tier. El personaje queda aparte
// (`life.perceive`). Es la entrada de los testigos que no son parte: memorias, creencias de
// acciones y la ley en el hecho leen de acá, no de la verdad.

import { type AgentId, type Event, type PlanetClock, Rng, type Seed } from "../../core/index.ts";
import {
  ATTENTION,
  actionStimulus,
  attireLook,
  BODY_STATE,
  ENTITY,
  LOCATION,
  type LocalMap,
  MENTAL,
  PERSON,
  type Percept,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type SpaceGraph,
  STATUS,
  type StateChange,
  type StatusDef,
  sensorAcuity,
  setComponent,
  skyLight,
  table,
  vigilantAttention,
  type WitnessCandidate,
  witnessStimulus,
} from "../../sim/index.ts";

export const WITNESSING_PROCESS = "life.witnessing";

/** Cuántos percepts recientes guarda cada NPC (sin calibrar). */
export const KEPT_NPC_PERCEPTS = 12;
/** Cuántos eventos por paso evalúa el proceso (presupuesto determinista; sin calibrar). */
export const MAX_EVENTS_PER_STEP = 32;
/** Piso de lo conocido entre vecinos (como en `life.knowing`). */
const KNOWN_VILLAGER = 0.6;

export interface NpcPercepts {
  /** En orden de llegada; el último es el más nuevo. */
  readonly recent: readonly Percept[];
}

/** Lo que cada NPC percibió de otros (el personaje usa `life.percepts`). */
export const NPC_PERCEPTS = table<NpcPercepts>("life.npc_percepts");

export interface WitnessingOptions {
  readonly player: AgentId;
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly clock: PlanetClock;
  readonly seed: Seed;
  readonly statuses: readonly StatusDef[];
  /** Tier del NPC (simulation §4); por defecto `importanceTiers` (cupo de tier 3, el resto tier 2). */
  readonly tierOf?: (id: AgentId, truth: ReadonlyWorldTruth) => WitnessCandidate["tier"];
}

/** Cupo de agentes de tier 3 en la aldea (simulation §4; sin calibrar). */
export const TIER3_QUOTA = 8;

/**
 * Tiers por importancia, una vez por corrida del proceso: tier 3 para los del hogar del
 * personaje (los que más pesan en su historia; hasta `TIER3_QUOTA`, por id para que sea estable) y
 * tier 2 para el resto de la aldea. La asignación completa (poder, puesto, centralidad,
 * histéresis, cupos por región) es de la Fase 5.
 */
export function importanceTiers(
  truth: ReadonlyWorldTruth,
  player: AgentId,
): (id: AgentId) => WitnessCandidate["tier"] {
  const home = truth.get(PERSON, player)?.household;
  const top = new Set<AgentId>();
  if (home !== undefined) {
    for (const id of [...(truth.ids(PERSON) as AgentId[])].sort()) {
      if (top.size >= TIER3_QUOTA) break;
      if (id !== player && truth.get(PERSON, id)?.household === home) top.add(id);
    }
  }
  return (id) => (top.has(id) ? 3 : 2);
}

/** Los pasos de otros que se perciben: lo que hacen y que alguien muera. */
function perceivable(kind: string): boolean {
  return kind.startsWith("action.") || kind === "body.died";
}

export function witnessingProcess(o: WitnessingOptions): ProcessDef {
  return {
    id: WITNESSING_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [
      NPC_PERCEPTS.name,
      PERSON.name,
      ENTITY.name,
      LOCATION.name,
      STATUS.name,
      BODY_STATE.name,
      MENTAL.name,
    ],
    writes: [NPC_PERCEPTS.name],
    run(ctx) {
      const fresh = npcPerceive(o, ctx.truth, ctx.recent, witnessRng(o.seed));
      if (fresh.size === 0) return {};
      const changes: StateChange[] = [];
      for (const id of [...fresh.keys()].sort()) {
        const before = ctx.truth.get(NPC_PERCEPTS, id as AgentId)?.recent ?? [];
        const mine = fresh.get(id) ?? [];
        changes.push(
          setComponent(NPC_PERCEPTS, id as AgentId, {
            recent: [...before, ...mine].slice(-KEPT_NPC_PERCEPTS),
          }),
        );
      }
      return { changes };
    },
  };
}

/** La tirada de los testigos: solo del seed y del evento, así `life.appraise` repite lo mismo que guardó este proceso. */
export function witnessRng(seed: Seed): Rng {
  return Rng.root(seed);
}

/** Lo que perciben los NPC de `events`, por observador (tope de eventos por paso). */
export function npcPerceive(
  o: WitnessingOptions,
  truth: ReadonlyWorldTruth,
  events: readonly Event[],
  rng: Rng,
): Map<AgentId, Percept[]> {
  const out = new Map<AgentId, Percept[]>();
  let budget = MAX_EVENTS_PER_STEP;
  const custom = o.tierOf;
  const tierOf = custom ? (id: AgentId) => custom(id, truth) : importanceTiers(truth, o.player);
  for (const e of events) {
    if (budget <= 0) break;
    const who = e.actors[0] as AgentId | undefined;
    if (!who || !perceivable(e.kind)) continue;
    const at = truth.get(LOCATION, who);
    const p = truth.get(PERSON, who);
    if (!at || !p) continue;
    budget -= 1;
    const em = (e.emissions ?? {}) as { sight?: number; sound?: number };
    const data = e.data as { effect?: { text?: string | null } } | null;
    const words = e.kind === "action.speak" ? (data?.effect?.text ?? null) : undefined;
    const stimulus = actionStimulus({
      event: e.id,
      tick: e.tick,
      actor: who,
      at,
      look: {
        sex: p.sex,
        ageYears: (e.tick - p.born) / o.clock.year,
        ...attireLook(truth.get(STATUS, who), o.statuses),
      },
      verb: e.kind,
      emissions: { sight: em.sight ?? 0, sound: em.sound ?? 0 },
      ...(words === undefined ? {} : { words }),
    });
    const candidates = neighbours(o, truth, at.hex, who, e.tick, tierOf);
    const percepts = witnessStimulus(
      stimulus,
      candidates,
      {
        graph: o.spaces,
        forest: o.map.forest,
        daylight: skyLight(o.map, o.clock, o.seed, e.tick),
      },
      rng.fork("npc", e.id),
    );
    for (const pc of percepts) {
      const list = out.get(pc.observer) ?? [];
      list.push(pc);
      out.set(pc.observer, list);
    }
  }
  return out;
}

/** Los vecinos vivos del hex (menos el que actúa y el personaje) como posibles testigos. */
function neighbours(
  o: WitnessingOptions,
  truth: ReadonlyWorldTruth,
  hex: number,
  actor: AgentId,
  now: number,
  tierOf: (id: AgentId) => WitnessCandidate["tier"],
): WitnessCandidate[] {
  const out: WitnessCandidate[] = [];
  for (const id of truth.ids(PERSON) as AgentId[]) {
    if (id === actor || id === o.player) continue;
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const there = truth.get(LOCATION, id);
    const p = truth.get(PERSON, id);
    if (!there || !p || there.hex !== hex) continue;
    const activity = truth.get(BODY_STATE, id)?.activity;
    const base =
      activity === "sleep"
        ? ATTENTION.asleep
        : activity === "heavy" || activity === "moderate"
          ? ATTENTION.absorbed
          : ATTENTION.relaxed;
    const mine = truth.get(PERSON, actor);
    const kin = mine !== undefined && mine.household === p.household;
    out.push({
      tier: tierOf(id),
      observer: {
        id,
        at: there,
        acuity: sensorAcuity((now - p.born) / o.clock.year),
        attention: vigilantAttention(base, truth.get(MENTAL, id)),
        familiar: new Map([[actor, kin ? 0.9 : KNOWN_VILLAGER]]),
      },
    });
  }
  return out;
}
