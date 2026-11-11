// Los de la secta en carne (novel-sect-seat-hall-people-born, simulation §6): mientras nadie sube,
// los cultivadores de la secta son ranuras con hechos fijados (`SectSlot`). Cuando el jugador entra al
// parche de la sede (antes de que pueda verlos), cada ranura se vuelve una persona ahí: su sexo, su
// edad, su talento, su reino, su qi, su pureza y su fundamento son los de la ranura; el genoma, el
// innato, el cuerpo y el nombre salen de `rng.fork("materialize", org, ranura)`, así que mismo seed,
// misma gente. Un solo evento (`life.sect_hall`) los trae, causado por la fundación de la secta y por
// la llegada del jugador (su lugar); todos quedan miembros con su rango, de pie en el salón. `SECT_HALL` guarda
// quiénes salieron de cada ranura: no se materializa dos veces. El qi de las ranuras no estaba en
// ninguna reserva (era parte del agregado), así que pasa a la persona sin tocar las reservas.
// El sustento y la rutina son `novel-sect-seat-hall-people-keep`; hablarles, `-talk`.

import {
  type AgentId,
  type EntityRef,
  type HouseholdId,
  type PlaceId,
  Rng,
  type Tick,
} from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  CULTIVATION_STATE,
  createEntity,
  draftEvent,
  ENTITY,
  expressInnate,
  founderGenome,
  GENOME,
  INNATE,
  type Language,
  LOCATION,
  type LocalMap,
  type MemberRank,
  massOf,
  type NameRules,
  nameNewborn,
  newBody,
  PERSON,
  PERSON_NAME,
  PLACE,
  type ProcessDef,
  patchOf,
  SECT,
  SECT_MEMBER,
  type SectRank,
  type StateChange,
  sectSpaceKey,
  setComponent,
  TALENT,
  type Trait,
  table,
} from "../../sim/index.ts";
import { PLAYER } from "./player.ts";

/** Quiénes salieron de las ranuras de una secta (por organización), en el orden de las ranuras. */
export interface SectHall {
  readonly at: Tick;
  readonly people: readonly { readonly slot: number; readonly person: AgentId }[];
}
export const SECT_HALL = table<SectHall>("life.sect_hall");

export const SECT_HALL_PROCESS = "life.sect_hall";
/** El evento de la materialización: la gente de la secta, en su sede. */
export const SECT_HALL_EVENT = "life.sect_hall";

/** El rango de miembro de cada ranura: los discípulos de la sede son internos. */
const MEMBER_RANK: Readonly<Record<SectRank, MemberRank>> = {
  master: "master",
  elder: "elder",
  disciple: "inner",
};

export interface SectHallOptions {
  readonly map: LocalMap;
  readonly yearTicks: number;
  readonly traits: readonly Trait[];
  readonly bodyPlans: readonly BodyPlanDef[];
  /** La lengua de sus nombres (la de la región); sin ella quedan sin nombre. */
  readonly language?: Language;
  readonly names?: NameRules;
}

/** Escritor de `SECT_HALL` y de la gente de la secta que materializa (cableado opt-in). */
export function sectHallProcess(o: SectHallOptions): ProcessDef {
  return {
    id: SECT_HALL_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "settle",
    reads: [PLAYER.name, LOCATION.name, SECT.name, SECT_HALL.name, PLACE.name, ENTITY.name],
    writes: [
      SECT_HALL.name,
      ENTITY.name,
      PERSON.name,
      GENOME.name,
      INNATE.name,
      BODY_STATE.name,
      TALENT.name,
      CULTIVATION_STATE.name,
      SECT_MEMBER.name,
      LOCATION.name,
      PERSON_NAME.name,
    ],
    run(ctx) {
      const truth = ctx.truth;
      const plan = o.bodyPlans.find((p) => p.id === "human");
      if (!plan) return {};
      const here = (truth.ids(PLAYER) as AgentId[])
        .filter((p) => truth.get(ENTITY, p)?.endedAt === undefined)
        .flatMap((p) => {
          const hex = truth.get(LOCATION, p)?.hex;
          return hex === undefined ? [] : [{ p, base: patchOf(o.map, hex).base }];
        });
      if (here.length === 0) return {};
      for (const org of truth.ids(SECT)) {
        if (truth.has(SECT_HALL, org)) continue;
        const sect = truth.get(SECT, org);
        const seatHex = sect ? truth.get(PLACE, sect.seatPlace)?.hexes[0] : undefined;
        if (!sect || seatHex === undefined) continue;
        const base = patchOf(o.map, seatHex).base;
        const who = here.find((h) => h.base === base);
        if (!who) continue;
        const event = draftEvent(0);
        const house = ctx.newId("household") as unknown as HouseholdId;
        const changes: StateChange[] = [
          createEntity(house as unknown as EntityRef, event, ctx.now),
        ];
        const people: { slot: number; person: AgentId }[] = [];
        const usedGiven = new Set<string>();
        const hall = sectSpaceKey(sect.seatPlace, "hall");
        for (const slot of sect.slots) {
          const rng = Rng.root(ctx.rng.seed).fork("materialize", org, slot.slot);
          const id = ctx.newId("agent") as unknown as AgentId;
          const key = id as unknown as EntityRef;
          const genome = founderGenome(o.traits, rng.fork("genome"), event);
          const innate = expressInnate(o.traits, genome, slot.sex, rng.fork("development"));
          const years = Math.max(0, (ctx.now - slot.born) / o.yearTicks);
          changes.push(
            createEntity(key, event, ctx.now),
            setComponent(PERSON, key, {
              sex: slot.sex,
              born: slot.born,
              mother: null,
              father: null,
              household: house,
              spouse: null,
            }),
            setComponent(GENOME, key, genome),
            setComponent(INNATE, key, innate),
            setComponent(
              BODY_STATE,
              key,
              newBody(plan, massOf(plan, innate, o.traits, slot.sex, years), ctx.now),
            ),
            setComponent(TALENT, key, slot.talent),
            setComponent(CULTIVATION_STATE, key, {
              // Ya cultivan: sienten el qi desde antes de que el jugador los vea.
              sensitivity: 1,
              hours: 0,
              sensed: { at: ctx.now, event: event as never },
              qi: slot.qi,
              purity: slot.purity,
              stage: slot.stage,
              foundation: slot.foundation,
            }),
            setComponent(SECT_MEMBER, key, {
              org,
              rank: MEMBER_RANK[slot.rank],
              since: ctx.now,
            }),
            setComponent(LOCATION, key, { hex: seatHex, space: hall }),
          );
          if (o.language) {
            const name = nameNewborn(o.language, {
              rng: rng.fork("name"),
              sex: slot.sex,
              father: undefined,
              used: usedGiven,
              raisedBy: null,
              event,
              ...(o.names ? { rules: o.names } : {}),
            });
            const given = name.parts.find((x) => x.kind === "given")?.form;
            if (given) usedGiven.add(given.toLowerCase());
            changes.push(setComponent(PERSON_NAME, key, name));
          }
          people.push({ slot: slot.slot, person: id });
        }
        changes.push(setComponent(SECT_HALL, org, { at: ctx.now, people }));
        return {
          changes,
          events: [
            {
              kind: SECT_HALL_EVENT,
              actors: people.map((x) => x.person),
              place: { kind: "place", place: sect.seatPlace as unknown as PlaceId },
              data: { org, people: people.length },
              emissions: {},
              causes: [
                { kind: "event", event: sect.originEventId },
                { kind: "state", entity: who.p, key: LOCATION.name },
              ],
            },
          ],
        };
      }
      return {};
    },
  };
}
