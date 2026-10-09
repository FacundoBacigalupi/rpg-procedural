// La fase `perceive` del personaje (perception.md, player-loop §3): al cerrar cada paso, lo que
// otros hicieron y el personaje pudo ver u oír queda guardado como percepts. El bucle (las
// interrupciones fijas) lee de ahí y no vuelve a percibir por su cuenta, así que lo que cortó un
// turno es exactamente lo que quedó en su cabeza. Los NPC todavía no perciben (llegan con su
// decisión, Fase 3): cada uno sería una corrida más por evento.

import type { AgentId, Event, EventId, PlanetClock, Rng, Seed } from "../../core/index.ts";
import {
  ATTENTION,
  actionStimulus,
  attireLook,
  LOCATION,
  type LocalMap,
  localHour,
  PERSON,
  type Percept,
  type ProcessDef,
  perceive,
  type ReadonlyWorldTruth,
  type SpaceGraph,
  STATUS,
  type StatusDef,
  skyLight,
  type TraitDef,
  table,
} from "../../sim/index.ts";
import { ASCRIBED_GROUPS, ascribeFromPercepts } from "./identity.ts";
import { PURPOSE_READS, type ReaderContent, readWitnessed, rememberReads } from "./reading.ts";
import { playerObserver } from "./witness.ts";

export const PERCEIVE_PROCESS = "life.perceive";

/** Cuántos percepts recientes guarda el personaje (los más viejos pasan a ser memoria: Fase 2). */
export const KEPT_PERCEPTS = 40;

export interface Percepts {
  /** En orden de llegada; el último es el más nuevo. */
  readonly recent: readonly Percept[];
}

/** Lo que el personaje percibió, guardado en su entidad. */
export const PERCEPTS = table<Percepts>("life.percepts");

export interface PerceiveOptions {
  readonly player: AgentId;
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly clock: PlanetClock;
  readonly seed: Seed;
  readonly statuses: readonly StatusDef[];
  /** Rasgos de cultura: con ellos lo visto se vuelve creencia de a qué grupo es cada uno. */
  readonly cultureTraits?: readonly TraitDef[];
  /** Dimensiones y vínculos de relación: con ellos el aprecio por el actor entra a la lectura. */
  readonly relations?: ReaderContent;
}

/** Los pasos de otros que se perciben: lo que hacen y que alguien muera. */
function perceivable(kind: string): boolean {
  return kind.startsWith("action.") || kind === "body.died";
}

export function perceiveProcess(o: PerceiveOptions): ProcessDef {
  return {
    id: PERCEIVE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [PERCEPTS.name, PERSON.name, LOCATION.name, "culture.person", "culture.community"],
    writes: [PERCEPTS.name, ASCRIBED_GROUPS.name, PURPOSE_READS.name],
    run(ctx) {
      const fresh = perceiveEvents(o, ctx.truth, ctx.recent, ctx.rng);
      if (fresh.length === 0) return {};
      // Lo que vio con un porqué detrás, lo lee con su sospecha y su aprecio por el actor.
      const seen = new Set(fresh.map((p) => p.sourceEventId));
      const reads = ctx.recent.flatMap((e) => {
        if (!seen.has(e.id)) return [];
        const r = readWitnessed(ctx.rng.fork("read", e.id), ctx.truth, o.player, e, o.relations);
        return r === undefined ? [] : [r];
      });
      const ascribed = ascribeFromPercepts(
        ctx.truth,
        o.player,
        fresh,
        ctx.recent,
        o.cultureTraits ?? [],
      );
      return {
        changes: [
          ...(reads.length > 0
            ? [
                {
                  op: "set" as const,
                  table: PURPOSE_READS.name,
                  id: o.player,
                  value: rememberReads(ctx.truth, o.player, reads),
                },
              ]
            : []),
          {
            op: "set",
            table: PERCEPTS.name,
            id: o.player,
            value: remember(ctx.truth, o.player, fresh),
          },
          ...(ascribed
            ? [{ op: "set" as const, table: ASCRIBED_GROUPS.name, id: o.player, value: ascribed }]
            : []),
        ],
      };
    },
  };
}

/** Lo que el personaje guarda después de percibir `fresh`: lo anterior más lo nuevo, con tope. */
export function remember(
  truth: ReadonlyWorldTruth,
  player: AgentId,
  fresh: readonly Percept[],
): Percepts {
  const before = truth.get(PERCEPTS, player)?.recent ?? [];
  return { recent: [...before, ...fresh].slice(-KEPT_PERCEPTS) };
}

/** Lo que el personaje ve u oye de `events` (cada uno tira con el rng forkeado por su id). */
export function perceiveEvents(
  o: PerceiveOptions,
  truth: ReadonlyWorldTruth,
  events: readonly Event[],
  rng: Rng,
): Percept[] {
  const out: Percept[] = [];
  for (const e of events) {
    const who = e.actors[0] as AgentId | undefined;
    if (!who || who === o.player || !perceivable(e.kind)) continue;
    const at = truth.get(LOCATION, who);
    const p = truth.get(PERSON, who);
    if (!at || !p) continue;
    const em = (e.emissions ?? {}) as { sight?: number; sound?: number };
    const data = e.data as { effect?: { text?: string | null } } | null;
    const words = e.kind === "action.speak" ? (data?.effect?.text ?? null) : undefined;
    out.push(
      ...perceive(
        actionStimulus({
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
        }),
        [playerObserver({ ...o, truth }, ATTENTION.relaxed, e.tick)],
        {
          graph: o.spaces,
          forest: o.map.forest,
          daylight: skyLight(o.map, o.clock, o.seed, e.tick),
        },
        rng.fork(e.id),
      ),
    );
  }
  return out;
}

/** Cuánto supo el personaje del evento, o `null` si no le llegó nada. */
export function perceivedDetail(
  truth: ReadonlyWorldTruth,
  player: AgentId,
  event: EventId,
): Percept["detail"] | null {
  const found = truth.get(PERCEPTS, player)?.recent.filter((p) => p.sourceEventId === event);
  if (!found || found.length === 0) return null;
  return found.some((p) => p.detail !== "vague") ? "clear" : "vague";
}
