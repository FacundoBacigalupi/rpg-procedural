// Mirar a propósito escribe lo visto (player-loop §9): cuando el personaje hace `look`, mira a los
// presentes con la atención de quien observa y lo que reconoce (dónde está, que vive, cómo lo ve) queda
// en sus `BELIEFS`. Corre en la fase `perceive` por evento, dentro del scheduler: el turno y el
// replay lo escriben por el mismo camino. Los extraños de cara no reconocida no se guardan acá
// (van como impresiones sin identidad, ítem aparte).

import type { AgentId, PlanetClock, Seed } from "../../core/index.ts";
import {
  attireLook,
  BELIEFS,
  doubtAt,
  ENTITY,
  LOCATION,
  type LocalMap,
  learn,
  PERSON,
  type ProcessDef,
  perceive,
  presenceStimulus,
  type SpaceGraph,
  STATUS,
  type StatusDef,
  setComponent,
  skyLight,
  watching,
} from "../../sim/index.ts";
import { impressionEvidence } from "./impressions.ts";
import { KNOWN_VILLAGER } from "./knowing.ts";
import { playerObserver } from "./witness.ts";

export const LOOKING_PROCESS = "life.looking";

export interface LookingOptions {
  readonly player: AgentId;
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly clock: PlanetClock;
  readonly seed: Seed;
  readonly statuses: readonly StatusDef[];
}

/** La agudeza con que salió el `look` de un evento, o `undefined` si el evento no fue mirar. */
export function lookAcuity(data: unknown): number | undefined {
  const fx = (data as { effect?: { kind?: unknown; acuity?: unknown } } | null)?.effect;
  if (fx?.kind !== "observe") return undefined;
  return typeof fx.acuity === "number" ? fx.acuity : 0;
}

/** A quién buscó sin encontrarlo ni verlo de pasada, o `undefined` si el evento no fue eso. */
export function searchedInVain(data: unknown): AgentId | undefined {
  const fx = (
    data as {
      effect?: { kind?: unknown; target?: unknown; found?: unknown; glimpsed?: unknown };
    } | null
  )?.effect;
  if (fx?.kind !== "search" || fx.found !== false || fx.glimpsed !== false) return undefined;
  return typeof fx.target === "string" && fx.target.startsWith("agent:")
    ? (fx.target as AgentId)
    : undefined;
}

export function lookingProcess(o: LookingOptions): ProcessDef {
  return {
    id: LOOKING_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [PERSON.name, ENTITY.name, LOCATION.name, STATUS.name, BELIEFS.name],
    writes: [BELIEFS.name],
    run(ctx) {
      const truth = ctx.truth;
      let beliefs = truth.get(BELIEFS, o.player);
      const before = beliefs;
      const done = () =>
        beliefs === before || beliefs === undefined
          ? {}
          : { changes: [setComponent(BELIEFS, o.player, beliefs)] };
      const looked = ctx.recent.filter(
        (e) => e.actors[0] === o.player && lookAcuity(e.data) !== undefined,
      );
      const last = looked.at(-1);
      const mineAt = truth.get(LOCATION, o.player);
      if (!mineAt) return {};
      // Buscó a alguien y no lo encontró (también cuando no estaba): lo que creía de dónde
      // estaba se debilita; no sabe adónde fue (information §1, evidencia negativa).
      for (const e of ctx.recent) {
        if (e.actors[0] !== o.player) continue;
        const gone = searchedInVain(e.data);
        if (gone === undefined) continue;
        beliefs = doubtAt(beliefs, gone, mineAt, ctx.now, {
          kind: "reasoning",
          evidence: [e.id],
          rules: ["search.absent"],
          tick: ctx.now,
        });
      }
      if (!last) return done();
      const acuity = lookAcuity(last.data) ?? 0;
      const medium = {
        graph: o.spaces,
        forest: o.map.forest,
        daylight: skyLight(o.map, o.clock, o.seed, ctx.now),
      };
      for (const subject of (truth.ids(PERSON) as AgentId[]).sort()) {
        if (subject === o.player || truth.get(ENTITY, subject)?.endedAt !== undefined) continue;
        const me = truth.get(PERSON, subject);
        const at = truth.get(LOCATION, subject);
        if (!me || !at || at.hex !== mineAt.hex) continue;
        const mine = playerObserver(
          { truth, player: o.player, clock: o.clock },
          watching(acuity),
          ctx.now,
        );
        const percepts = perceive(
          presenceStimulus({
            id: subject,
            at,
            look: {
              sex: me.sex,
              ageYears: (ctx.now - me.born) / o.clock.year,
              ...attireLook(truth.get(STATUS, subject), o.statuses),
            },
            tick: ctx.now,
          }),
          [
            {
              ...mine,
              familiar: new Map([
                [subject, Math.max(KNOWN_VILLAGER, mine.familiar.get(subject) ?? 0)],
              ]),
            },
          ],
          medium,
          ctx.rng.fork("look", subject),
        );
        for (const pc of percepts) {
          const who = pc.fields.identity;
          if (pc.detail !== "identified" || who === undefined || who.value !== subject) continue;
          const source = { kind: "percept", percept: pc.id, tick: pc.tick } as const;
          const ev = (attr: "at" | "alive", value: boolean | typeof at) => ({
            prop: { kind: "attr", subject, attr } as const,
            value,
            confidence: who.confidence,
            asOf: pc.tick,
            source,
          });
          beliefs = learn(beliefs, ev("at", at), ctx.now);
          beliefs = learn(beliefs, ev("alive", true), ctx.now);
          for (const imp of impressionEvidence(subject, pc)) beliefs = learn(beliefs, imp, ctx.now);
        }
      }
      return done();
    },
  };
}
