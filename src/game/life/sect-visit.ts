// La bajada anual de la secta (novel-cult-sect-visit, cultivation §3 «medición», organizations): un
// día al año, unos días después del pico de la cosecha, la secta manda gente a la plaza de la aldea a
// buscar chicos con raíz. Una semana antes llega el aviso (`cultivation.sect_herald`): todos los de
// siete años o más lo oyen y quedan creyendo cuándo bajan (`SECT_LORE.visitAt`; el que no sabía de
// la secta ahora la sabe, con su error). El día, de media mañana a la tarde, están en la plaza
// (`cultivation.sect_visit`). Los emisarios todavía no tienen cuerpo (son ranuras de la secta); la
// prueba es `novel-cult-sect-trial`. Solo con el cultivo encendido y una secta con `visitDay`.
//
// La prueba (novel-cult-sect-trial): mientras están en la plaza miden a los de 8 a 16 años con la
// piedra (`readRoots`: la raíz con el error del instrumento). Los que están en la plaza (el
// personaje si fue, cualquiera que pase) se miden en la hora que estén; a los demás chicos los lleva
// su casa o no (`TRIAL_BROUGHT_CHANCE`, una tirada por chico y año) y se miden al llegar la secta.
// Cada uno una vez por año: `SECT_TRIAL` guarda la última lectura, que el medido cree;
// `cultivation.sect_trial` la deja, causada por la bajada y por el talento.
//
// La membresía (novel-cult-sect-join-member): el aceptado queda discípulo externo (`SECT_MEMBER`,
// `cultivation.sect_joined` causado por su prueba) con la citación a la sede (`summonedLore`: rumbo
// y jornadas exactos, `SECT_REPORT_DAYS` para presentarse). El que ya era de la secta no se vuelve a
// sumar. Subir a la sede queda para `novel-sect-seat`.
//
// La escuela (novel-cult-school): si la secta tiene, al aceptado le enseñan ahí la técnica de entrada
// (`CULTIVATION_TECHNIQUE`, `cultivation.technique_taught`), que rinde al meditar y absorber.
//
// Dos sectas (novel4-recruit-visit): la rival baja unos días después. Su aviso deja la fecha en lo
// que cada uno oyó de ella (`SECTS_HEARD`; `SECT_LORE` sigue siendo la primera que conoció). La
// prueba se cuenta por secta y año; no se mide al que ya es de otra secta de antes, y el aceptado
// que ya estaba citado por otra ese año no se suma: le queda la oferta (`SECT_TRIAL` aceptado).
//
// La competencia (novel4-recruit-choice): a ese citado por la otra, la segunda le ofrece entrar como
// interno si la piedra lo leyó alto (`offeredRank`). Un NPC elige ahí mismo con lo que cree
// (`chooseOffer`: el rango, después la sede más cerca); si se cambia, queda de la segunda con su
// citación y su técnica (`cultivation.sect_joined` con `from`), lo que creía de la primera pasa a
// `SECTS_HEARD`, y la primera guarda la ofensa a la otra (`org.sect_poached`, `afterPoached`). El
// personaje no elige acá: le queda la oferta.
//
// El personaje elige (novel4-recruit-player): con la oferta de la otra, se queda en la que lo citó
// salvo que se presente en la sede de la otra antes de la fecha de la citación (`atSeat`, hasta
// `reportBy`); ahí lo anotan con el rango ofrecido, como al NPC que se cambia.

import {
  type AgentId,
  compareStrings,
  type EntityRef,
  type PlaceRef,
  type PlanetClock,
} from "../../core/index.ts";
import {
  afterPoached,
  CULTIVATION_LAW,
  CULTIVATION_TECHNIQUE,
  chooseOffer,
  draftEvent,
  type EventDraft,
  LOCATION,
  type MemberRank,
  ORG_RELATION,
  type OrgRelations,
  offeredRank,
  orgTie,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  readRoots,
  SECT,
  SECT_ANNOUNCE_DAYS,
  SECT_HERALD_EVENT,
  SECT_JOINED_EVENT,
  SECT_LORE,
  SECT_MEMBER,
  SECT_POACHED_EVENT,
  SECT_REPORT_DAYS,
  SECT_SCHOOL,
  SECT_TRIAL,
  SECT_TRIAL_EVENT,
  SECT_VISIT,
  SECT_VISIT_EVENT,
  SECTS_HEARD,
  type SectLore,
  type StateChange,
  sectLoreOf,
  setComponent,
  summonedLore,
  TALENT,
  TECHNIQUE_TAUGHT_EVENT,
  TRIAL_BROUGHT_CHANCE,
  TRIAL_MAX_YEARS,
  TRIAL_MIN_YEARS,
  trialAccepts,
  upcomingVisit,
  VILLAGE_SQUARE,
} from "../../sim/index.ts";
import { living } from "./living.ts";
import { atSeat } from "./sect-grievance.ts";

export const SECT_VISIT_PROCESS = "life.cultivation.sect_visit";

/** Desde qué edad se entiende y se recuerda el aviso. */
const HEARS_FROM_YEARS = 7;

export function sectVisitProcess(o: {
  readonly clock: PlanetClock;
  readonly lonDeg: number;
  /** La aldea: dónde pasan el aviso y la bajada. */
  readonly village: PlaceRef;
  /** El personaje: va a la plaza o no por su cuenta, nadie lo lleva. */
  readonly player?: AgentId;
}): ProcessDef {
  const offset = Math.round((o.lonDeg / 360) * o.clock.day);
  return {
    id: SECT_VISIT_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "act",
    reads: [
      SECT.name,
      SECT_VISIT.name,
      SECT_LORE.name,
      PERSON.name,
      CULTIVATION_LAW.name,
      TALENT.name,
      LOCATION.name,
      SECT_TRIAL.name,
      SECT_MEMBER.name,
      SECT_SCHOOL.name,
      SECTS_HEARD.name,
      ORG_RELATION.name,
    ],
    writes: [
      SECT_VISIT.name,
      SECT_LORE.name,
      SECTS_HEARD.name,
      SECT_TRIAL.name,
      SECT_MEMBER.name,
      CULTIVATION_TECHNIQUE.name,
      ORG_RELATION.name,
    ],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const relations = new Map<EntityRef, OrgRelations>();
      for (const org of ctx.truth.ids(SECT)) {
        const sect = ctx.truth.get(SECT, org);
        if (sect?.visitDay === undefined) continue;
        const state = ctx.truth.get(SECT_VISIT, org) ?? { announced: -1, visited: -1 };
        const visit = upcomingVisit(ctx.now, sect.visitDay, o.clock, offset);
        let next = state;
        if (
          state.announced < visit.year &&
          ctx.now >= visit.start - SECT_ANNOUNCE_DAYS * o.clock.day
        ) {
          next = { ...next, announced: visit.year };
          events.push({
            kind: SECT_HERALD_EVENT,
            actors: [],
            place: o.village,
            data: { org, visitAt: visit.start, year: visit.year },
            emissions: {},
            causes: [{ kind: "state", entity: org, key: SECT.name }],
          });
          for (const id of living(ctx.truth) as AgentId[]) {
            const p = ctx.truth.get(PERSON, id);
            if (!p || (ctx.now - p.born) / o.clock.year < HEARS_FROM_YEARS) continue;
            const first = ctx.truth.get(SECT_LORE, id);
            if (!first || first.org === org) {
              const known = first ?? sectLoreOf(ctx.rng.fork("lore", id), org, sect, ctx.now);
              changes.push(setComponent(SECT_LORE, id, { ...known, visitAt: visit.start }));
              continue;
            }
            // De otra secta que no es la primera que conoció: en lo que oyó de las otras.
            const heard = ctx.truth.get(SECTS_HEARD, id)?.toward ?? {};
            const known: SectLore =
              heard[org] ?? sectLoreOf(ctx.rng.fork("lore", id), org, sect, ctx.now);
            changes.push(
              setComponent(SECTS_HEARD, id, {
                toward: { ...heard, [org]: { ...known, visitAt: visit.start } },
              }),
            );
          }
        }
        const inWindow = ctx.now >= visit.start && ctx.now < visit.end;
        const arriving = inWindow && state.visited < visit.year;
        if (arriving) {
          next = { ...next, visited: visit.year };
          events.push({
            kind: SECT_VISIT_EVENT,
            actors: [],
            place: o.village,
            data: { org, start: visit.start, until: visit.end, year: visit.year },
            emissions: {},
            causes: [{ kind: "state", entity: org, key: SECT_VISIT.name }],
          });
        }
        const plane = ctx.truth.ids(CULTIVATION_LAW)[0];
        const law = inWindow && plane ? ctx.truth.get(CULTIVATION_LAW, plane) : undefined;
        if (law) {
          for (const id of living(ctx.truth) as AgentId[]) {
            const p = ctx.truth.get(PERSON, id);
            const talent = ctx.truth.get(TALENT, id);
            if (!p || !talent) continue;
            const age = (ctx.now - p.born) / o.clock.year;
            if (age < TRIAL_MIN_YEARS || age >= TRIAL_MAX_YEARS) continue;
            const last = ctx.truth.get(SECT_TRIAL, id);
            if (last?.org === org && last.year >= visit.year) continue;
            // El que ya es de otra secta de antes no se mide; el citado este año, sí (la oferta).
            const member = ctx.truth.get(SECT_MEMBER, id);
            const summoned = member?.trialYear === visit.year;
            if (member && member.org !== org && !summoned) continue;
            const atSquare = ctx.truth.get(LOCATION, id)?.space === VILLAGE_SQUARE;
            const brought =
              arriving &&
              id !== o.player &&
              ctx.rng.fork("brought", id, visit.year).chance(TRIAL_BROUGHT_CHANCE);
            if (!atSquare && !brought) continue;
            const reading = readRoots(law, talent.innate, ctx.rng.fork("trial", id, visit.year));
            const accepted = trialAccepts(reading);
            const contested = member !== undefined && member.org !== org;
            const rank = offeredRank(reading, contested);
            changes.push(
              setComponent(SECT_TRIAL, id, {
                org,
                year: visit.year,
                at: ctx.now,
                reading,
                accepted,
                ...(accepted ? { rank } : {}),
              }),
            );
            events.push({
              kind: SECT_TRIAL_EVENT,
              actors: [id],
              place: o.village,
              data: { org, year: visit.year, accepted, ...(accepted ? { rank } : {}), ...reading },
              emissions: { sight: 0.3 },
              causes: [
                { kind: "state", entity: org, key: SECT_VISIT.name },
                { kind: "state", entity: id, key: TALENT.name },
              ],
            });
            if (!accepted || (member && !contested)) continue;
            // Citado por la otra: un NPC elige ahí; el personaje se queda con la oferta.
            if (member && contested) {
              if (id === o.player) continue;
              const stay = loreOf(ctx.truth, id, member.org);
              const offer = loreOf(ctx.truth, id, org);
              const choice = chooseOffer(
                { rank: member.rank, days: stay?.days ?? Number.POSITIVE_INFINITY },
                { rank, days: offer?.days ?? Number.POSITIVE_INFINITY },
              );
              if (choice === "stay") continue;
            }
            const reportBy = visit.end + SECT_REPORT_DAYS * o.clock.day;
            joinSect(ctx.truth, changes, events, relations, {
              id,
              org,
              rank,
              now: ctx.now,
              trialYear: visit.year,
              reportBy,
              place: o.village,
              from: member?.org,
            });
          }
        }
        if (next !== state) changes.push(setComponent(SECT_VISIT, org, next));
      }
      // El personaje con la oferta de la otra que se presenta en su sede antes de la fecha.
      const offer = o.player === undefined ? undefined : pendingOffer(ctx.truth, o.player, ctx.now);
      if (o.player !== undefined && offer && atSeat(ctx.truth, o.player, offer.org)) {
        const seat = ctx.truth.get(SECT, offer.org)?.seatPlace;
        joinSect(ctx.truth, changes, events, relations, {
          id: o.player,
          org: offer.org,
          rank: offer.rank,
          now: ctx.now,
          trialYear: offer.year,
          reportBy: offer.reportBy,
          place: (seat as PlaceRef | undefined) ?? o.village,
          from: offer.from,
        });
      }
      for (const [id, r] of [...relations].sort(([x], [y]) => compareStrings(x, y))) {
        changes.push(setComponent(ORG_RELATION, id, r));
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}

/**
 * La oferta que le queda a `who` (novel4-recruit-player): la otra lo aceptó este año mientras ya
 * estaba citado por una, y todavía no venció la fecha de presentarse. Sin oferta, undefined.
 */
export function pendingOffer(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  now: number,
):
  | {
      readonly org: EntityRef;
      readonly from: EntityRef;
      readonly rank: MemberRank;
      readonly year: number;
      readonly reportBy: number;
    }
  | undefined {
  const trial = truth.get(SECT_TRIAL, who);
  const member = truth.get(SECT_MEMBER, who);
  if (!trial?.accepted || !member || member.org === trial.org) return undefined;
  if (member.trialYear !== trial.year || member.reportBy === undefined) return undefined;
  if (now > member.reportBy) return undefined;
  return {
    org: trial.org,
    from: member.org,
    rank: trial.rank ?? "outer",
    year: trial.year,
    reportBy: member.reportBy,
  };
}

/**
 * Sumar a `id` a la secta `org` (novel-cult-sect-join-member y novel4-recruit-choice): miembro con
 * su citación, lo que creía de la otra entre lo que oyó, `cultivation.sect_joined` (con `from` si se
 * cambia, y entonces `org.sect_poached` y la ofensa de la que lo perdió) y la técnica de entrada.
 */
function joinSect(
  truth: ReadonlyWorldTruth,
  changes: StateChange[],
  events: EventDraft[],
  relations: Map<EntityRef, OrgRelations>,
  j: {
    readonly id: AgentId;
    readonly org: EntityRef;
    readonly rank: MemberRank;
    readonly now: number;
    readonly trialYear: number;
    readonly reportBy: number;
    readonly place: PlaceRef;
    readonly from: EntityRef | undefined;
  },
): void {
  const { id, org, rank, from } = j;
  const sect = truth.get(SECT, org);
  if (!sect) return;
  changes.push(
    setComponent(SECT_MEMBER, id, {
      org,
      rank,
      since: j.now,
      trialYear: j.trialYear,
      reportBy: j.reportBy,
    }),
    ...joinLore(truth, id, org, summonedLore(loreOf(truth, id, org), org, sect, j.now)),
  );
  const joined = draftEvent(events.length);
  events.push({
    kind: SECT_JOINED_EVENT,
    actors: [id],
    place: j.place,
    data: { org, rank, reportBy: j.reportBy, seat: sect.seatPlace, ...(from ? { from } : {}) },
    emissions: { sight: 0.3 },
    causes: [
      { kind: "state", entity: id, key: SECT_TRIAL.name },
      { kind: "state", entity: org, key: SECT.name },
      ...(from ? [{ kind: "state" as const, entity: id, key: SECT_MEMBER.name }] : []),
    ],
  });
  // La que lo había citado se queda sin él y guarda la ofensa a la otra.
  if (from) {
    const poached = draftEvent(events.length);
    events.push({
      kind: SECT_POACHED_EVENT,
      actors: [id],
      place: j.place,
      data: { from, to: org, rank },
      emissions: {},
      causes: [{ kind: "event", event: joined }],
    });
    const had = relations.get(from) ?? truth.get(ORG_RELATION, from);
    const tie = orgTie(had, org);
    if (had && tie) {
      relations.set(from, { toward: { ...had.toward, [org]: afterPoached(tie, poached) } });
    }
  }
  // La técnica de entrada (novel-cult-school): se la enseñan ahí mismo, antes de irse.
  const school = truth.get(SECT_SCHOOL, org);
  if (!school) return;
  changes.push(
    setComponent(CULTIVATION_TECHNIQUE, id, {
      org,
      name: school.technique.name,
      factor: school.technique.factor,
      learnedAt: j.now,
      realm: 0,
    }),
  );
  events.push({
    kind: TECHNIQUE_TAUGHT_EVENT,
    actors: [id],
    place: j.place,
    data: { org, technique: school.technique.name },
    emissions: {},
    causes: [
      { kind: "state", entity: id, key: SECT_MEMBER.name },
      { kind: "state", entity: org, key: SECT_SCHOOL.name },
    ],
  });
}

/** Lo que `who` cree de la secta `org`: la primera que conoció o una de las que oyó. */
function loreOf(truth: ReadonlyWorldTruth, who: AgentId, org: EntityRef): SectLore | undefined {
  const first = truth.get(SECT_LORE, who);
  return first?.org === org ? first : truth.get(SECTS_HEARD, who)?.toward[org];
}

/**
 * Sumarse a `org` con la citación `lore`: pasa a ser la secta que conoce primero, y lo que creía de
 * la que lo era queda entre las que oyó.
 */
function joinLore(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  org: EntityRef,
  lore: SectLore,
): StateChange[] {
  const first = truth.get(SECT_LORE, who);
  const out: StateChange[] = [setComponent(SECT_LORE, who, lore)];
  const heard = truth.get(SECTS_HEARD, who)?.toward;
  if ((!first || first.org === org) && !heard?.[org]) return out;
  const toward: Record<string, SectLore> = { ...heard };
  delete toward[org];
  if (first && first.org !== org) toward[first.org] = first;
  out.push(setComponent(SECTS_HEARD, who, { toward }));
  return out;
}
