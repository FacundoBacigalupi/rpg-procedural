// El torneo entre sectas (novel4-tournament). Convocarlo (novel4-tournament-call): cada día, por par
// de sectas rivales sin torneo convocado y con el anterior lejos (`tournamentDue`), si las dos lo
// aceptan por lo que sienten de la otra (`acceptsTournament`), la que le toca (`nextHost`) lo pone en
// su plataforma a `TOURNAMENT_NOTICE_DAYS` (`org.tournament_called`, en su sede). Si el día pasa y no
// se hizo, se pierde (`org.tournament_lapsed`) y desde ahí corre la espera del siguiente.
//
// La delegación (novel4-tournament-delegation, con viajes de NPC): al convocarlo, la visitante elige
// a los que manda (`pickDelegates`: un anciano primero, después internos o ancianos libres, como el
// enviado) y van en `delegates`. Desde unos días antes caminan a la sede que lo pone y se quedan ahí
// mientras siga convocado; cerrado, vuelven (`tournamentDuty`, que leen `decide` y la rutina).
//
// Los duelos (novel4-tournament-bouts): el día del torneo, a `TOURNAMENT_HOUR`, los discípulos de la
// que lo pone que están en su sede y los delegados de la visitante que llegaron se emparejan por
// rango y etapa (`tournamentBouts`, el primero de una con el primero de la otra) y suben a la
// plataforma con un anciano de la casa que mira (`tournamentJudge`); cada par pelea a rendirse
// (`strikeFight`) y `life.duels` mueve la cara y lo que una secta siente por la otra. Se cierra
// hecho (`org.tournament_held`, con quién ganó cada duelo). Sin pares, se espera al día siguiente
// hasta que se pierde.

import {
  type AgentId,
  compareStrings,
  type EntityRef,
  type EventId,
  type PlaceId,
  type PlanetClock,
} from "../../core/index.ts";
import {
  acceptsTournament,
  BODY_STATE,
  CULTIVATION_STATE,
  DUEL,
  delegateLeg,
  draftEvent,
  ENTITY,
  type EventDraft,
  houseKey,
  LOCATION,
  type LocalMap,
  localHour,
  nextHost,
  ORG_RELATION,
  ORG_TOURNAMENT_CALLED_EVENT,
  ORG_TOURNAMENT_HELD_EVENT,
  ORG_TOURNAMENT_LAPSED_EVENT,
  orgTie,
  PERSON,
  PLACE,
  type ProcessDef,
  patchOf,
  RELATIONS,
  type ReadonlyWorldTruth,
  SECT,
  SECT_MEMBER,
  SECT_MISSION,
  SECT_TOURNAMENT,
  type SectTournaments,
  SKILL_STATE,
  type SpaceGraph,
  type StateChange,
  sectSpaceKey,
  setComponent,
  TOURNAMENT_DELEGATES,
  TOURNAMENT_NOTICE_DAYS,
  type TournamentRecord,
  TRIBULATION,
  tournamentDue,
  tournamentKeeper,
  tournamentLate,
  YIELDED,
} from "../../sim/index.ts";
import { duelVictor } from "./duels.ts";
import { canFight, DUEL_INTENT, exposeSkills, FIGHT_STATE, strikeFight } from "./fight.ts";
import { PLAYER } from "./player.ts";
import { atSeat, pickEnvoy } from "./sect-grievance.ts";
import { DUEL_PLATFORM_EVENT, type SectSparOptions } from "./sect-spar.ts";

export const SECT_TOURNAMENT_PROCESS = "life.sect_tournament";
export const SECT_TOURNAMENT_BOUTS_PROCESS = "life.sect_tournament_bouts";
/** La hora local de los duelos (de mañana: no choca con la práctica de la tarde). */
export const TOURNAMENT_HOUR = 10;
/** Lo que espera de una vez el delegado en la sede que pone el torneo (decide es diario). */
export const TOURNAMENT_STAY_SECONDS = 8 * 3600;

function alive(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  return (
    truth.get(ENTITY, id)?.endedAt === undefined &&
    (truth.get(BODY_STATE, id)?.death ?? null) === null
  );
}

/**
 * A quiénes manda la visitante (puro, novel4-tournament-delegation): un anciano vivo libre (sin
 * misión, no el personaje) primero, si hay; después, hasta `TOURNAMENT_DELEGATES`, los que elegiría
 * de enviado (`pickEnvoy`: internos o ancianos libres, primero los que están en la sede).
 */
export function pickDelegates(
  truth: ReadonlyWorldTruth,
  org: EntityRef,
  player: AgentId,
): AgentId[] {
  const out: AgentId[] = [];
  const elder = ([...truth.ids(SECT_MEMBER)].sort(compareStrings) as AgentId[]).find((id) => {
    const m = truth.get(SECT_MEMBER, id);
    return (
      m?.org === org &&
      m.rank === "elder" &&
      id !== player &&
      truth.get(SECT_MISSION, id) === undefined &&
      alive(truth, id)
    );
  });
  if (elder !== undefined) out.push(elder);
  while (out.length < TOURNAMENT_DELEGATES) {
    const next = pickEnvoy(truth, org, player, new Set(out));
    if (next === undefined) break;
    out.push(next);
  }
  return out;
}

/** Con qué se ve que el delegado ya volvió: el parche de su sede o el de su casa. */
export interface TournamentHome {
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
}

/**
 * Qué le toca a un delegado (puro, novel4-tournament-delegation): ir a la sede que pone el torneo
 * (`go`), quedarse ahí (`stay`) o volver a la suya (`go`). Undefined si no es delegado de un torneo
 * vigente o ya volvió: a su sede o, con `home`, al parche de su sede o al de su casa (el discípulo
 * que vive en la aldea sigue de la sede a su casa).
 */
export function tournamentDuty(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  now: number,
  dayTicks: number,
  home?: TournamentHome,
): { readonly kind: "go"; readonly place: string } | { readonly kind: "stay" } | undefined {
  const org = truth.get(SECT_MEMBER, who)?.org as EntityRef | undefined;
  if (org === undefined) return undefined;
  for (const other of ([...truth.ids(SECT)] as EntityRef[]).sort(compareStrings)) {
    if (other === org) continue;
    const [keeper, key] = tournamentKeeper(org, other);
    const rec = truth.get(SECT_TOURNAMENT, keeper)?.with[key];
    if (!rec?.delegates?.includes(who)) continue;
    const leg = delegateLeg(rec, now, dayTicks);
    if (leg === undefined) return undefined;
    const to = leg === "host" ? rec.host : org;
    if (atSeat(truth, who, to)) return leg === "host" ? { kind: "stay" } : undefined;
    if (leg === "home" && home && backHome(truth, who, org, home)) return undefined;
    const seat = truth.get(SECT, to)?.seatPlace;
    return seat === undefined ? undefined : { kind: "go", place: seat };
  }
  return undefined;
}

function backHome(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  org: EntityRef,
  home: TournamentHome,
): boolean {
  const here = truth.get(LOCATION, who)?.hex;
  if (here === undefined) return false;
  const base = patchOf(home.map, here).base;
  const seat = truth.get(SECT, org)?.seatPlace;
  const seatHex = seat === undefined ? undefined : truth.get(PLACE, seat)?.hexes[0];
  if (seatHex !== undefined && patchOf(home.map, seatHex).base === base) return true;
  const household = truth.get(PERSON, who)?.household;
  if (household === undefined) return false;
  const house = home.spaces.spaces.find((s) => s.key === houseKey(household));
  return house !== undefined && patchOf(home.map, house.hex).base === base;
}

const RANK_ORDER: Readonly<Record<string, number>> = { inner: 0, outer: 1 };

/**
 * Quiénes de `org` pelean en el torneo que pone `host` (puro, novel4-tournament-bouts): discípulos
 * internos o externos (los ancianos miran), vivos, despiertos, en condiciones de pelear, en la sede
 * de `host`, sin el Cielo encima ni duelo propio; no el personaje. De `only` si se da (la
 * delegación). Primero los internos, después por etapa de mayor a menor y por id.
 */
export function tournamentFighters(
  truth: ReadonlyWorldTruth,
  org: EntityRef,
  host: EntityRef,
  player: AgentId,
  only?: readonly AgentId[],
): AgentId[] {
  const ids = only ?? ([...truth.ids(SECT_MEMBER)] as AgentId[]);
  const stage = (id: AgentId) => truth.get(CULTIVATION_STATE, id)?.stage ?? 0;
  const rank = (id: AgentId) => RANK_ORDER[truth.get(SECT_MEMBER, id)?.rank ?? ""] ?? 9;
  return ids
    .filter((id) => {
      const m = truth.get(SECT_MEMBER, id);
      if (m?.org !== org || RANK_ORDER[m.rank] === undefined || id === player) return false;
      if (truth.has(PLAYER, id) || truth.has(TRIBULATION, id) || truth.has(DUEL, id)) return false;
      if (truth.get(BODY_STATE, id)?.activity === "sleep") return false;
      return atSeat(truth, id, host) && canFight(truth, id);
    })
    .sort((a, b) => rank(a) - rank(b) || stage(b) - stage(a) || compareStrings(a, b));
}

/**
 * Los duelos del torneo (puro, novel4-tournament-bouts): los de la que lo pone en su sede contra los
 * delegados de la visitante que llegaron, el i-ésimo de uno con el i-ésimo del otro. Tantos como el
 * lado más corto.
 */
export function tournamentBouts(
  truth: ReadonlyWorldTruth,
  rec: TournamentRecord,
  guest: EntityRef,
  player: AgentId,
): { readonly host: AgentId; readonly guest: AgentId }[] {
  const h = tournamentFighters(truth, rec.host, rec.host, player);
  const g = tournamentFighters(truth, guest, rec.host, player, rec.delegates ?? []);
  return g.slice(0, h.length).map((x, i) => ({ host: h[i] as AgentId, guest: x }));
}

/** El que mira desde la plataforma: un anciano o el maestro de la casa en su sede, despierto. */
export function tournamentJudge(
  truth: ReadonlyWorldTruth,
  host: EntityRef,
  player: AgentId,
): AgentId | undefined {
  return ([...truth.ids(SECT_MEMBER)].sort(compareStrings) as AgentId[]).find((id) => {
    const m = truth.get(SECT_MEMBER, id);
    if (m?.org !== host || (m.rank !== "elder" && m.rank !== "master") || id === player) {
      return false;
    }
    if (truth.has(DUEL, id) || truth.get(BODY_STATE, id)?.activity === "sleep") return false;
    return atSeat(truth, id, host) && canFight(truth, id);
  });
}

/** Escritor de los duelos del torneo (cableado opt-in, con la región hasta la sede). */
export function sectTournamentBoutsProcess(
  o: SectSparOptions & {
    readonly clock: PlanetClock;
    readonly lonDeg: number;
    readonly player: AgentId;
  },
): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  return {
    id: SECT_TOURNAMENT_BOUTS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "perceive",
    reads: [
      SECT.name,
      SECT_TOURNAMENT.name,
      SECT_MEMBER.name,
      PLACE.name,
      LOCATION.name,
      ENTITY.name,
      BODY_STATE.name,
      SKILL_STATE.name,
      RELATIONS.name,
      TRIBULATION.name,
      DUEL.name,
      FIGHT_STATE.name,
      PLAYER.name,
      CULTIVATION_STATE.name,
    ],
    // Un duelo puede dejar a uno rendido o la pelea pausada (`strikeFight`).
    writes: [
      BODY_STATE.name,
      SKILL_STATE.name,
      LOCATION.name,
      YIELDED.name,
      FIGHT_STATE.name,
      SECT_TOURNAMENT.name,
    ],
    run(ctx) {
      if (Math.floor(localHour(o.clock, ctx.now, o.lonDeg)) !== TOURNAMENT_HOUR) return {};
      const truth = ctx.truth;
      const sects = ([...truth.ids(SECT)] as EntityRef[]).sort(compareStrings);
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      const kept = new Map<EntityRef, SectTournaments>();
      for (const [i, a] of sects.entries()) {
        for (const b of sects.slice(i + 1)) {
          const [keeper, other] = tournamentKeeper(a, b);
          const rec = truth.get(SECT_TOURNAMENT, keeper)?.with[other];
          if (rec?.status !== "called" || ctx.now < rec.at) continue;
          if (tournamentLate(rec, ctx.now, o.clock.day)) continue;
          const guest = rec.host === a ? b : a;
          const seat = truth.get(SECT, rec.host)?.seatPlace;
          const bouts = tournamentBouts(truth, rec, guest, o.player);
          const first = bouts[0];
          const at = first ? truth.get(LOCATION, first.host) : undefined;
          if (seat === undefined || !first || !at) continue;
          const judge = tournamentJudge(truth, rec.host, o.player);
          const place = { kind: "place" as const, place: seat as unknown as PlaceId };
          const arena = { hex: at.hex, space: sectSpaceKey(seat, "arena") };
          const up = [...bouts.flatMap((x) => [x.host, x.guest]), ...(judge ? [judge] : [])];
          for (const id of up) changes.push(setComponent(LOCATION, id, arena));
          const platform = draftEvent(events.length);
          events.push({
            kind: DUEL_PLATFORM_EVENT,
            actors: up,
            place,
            data: { rule: "yield", tournament: rec.called },
            emissions: { sight: 0.6 },
            causes: [{ kind: "event", event: rec.called }],
          });
          const fights: EventId[] = [];
          const results: { host: AgentId; guest: AgentId; winner?: AgentId }[] = [];
          for (const x of bouts) {
            const mine = truth.get(BODY_STATE, x.host);
            if (!mine) continue;
            const f = strikeFight({
              truth,
              me: x.host,
              myBody: mine,
              target: x.guest,
              plans,
              skills: o.skills,
              traits: o.traits,
              intent: DUEL_INTENT.yield,
              light: o.light,
              ...(o.refined ? { refined: true } : {}),
              duel: "yield",
              ...(judge ? { witness: judge } : {}),
              start: ctx.now,
              rng: ctx.rng.fork("tournament", x.host, x.guest),
              day: o.dayTicks,
              cause: rec.called,
              place,
            });
            changes.push(setComponent(BODY_STATE, x.host, f.myBody), ...f.changes);
            if (f.exposure) {
              changes.push(
                setComponent(
                  SKILL_STATE,
                  x.host,
                  exposeSkills(
                    truth.get(SKILL_STATE, x.host),
                    f.exposure,
                    ctx.now + f.seconds,
                    o.dayTicks,
                  ),
                ),
              );
            }
            fights.push(draftEvent(events.length));
            events.push(f.event);
            const v = duelVictor(f.event);
            results.push({ ...x, ...(v ? { winner: v.winner } : {}) });
          }
          const closedBy = draftEvent(events.length);
          events.push({
            kind: ORG_TOURNAMENT_HELD_EVENT,
            actors: up,
            place,
            data: { host: rec.host, guest, at: rec.at, bouts: results },
            emissions: { sight: 0.6 },
            causes: [
              { kind: "event", event: rec.called },
              { kind: "event", event: platform },
              ...fights.map((event) => ({ kind: "event" as const, event })),
            ],
          });
          const had = kept.get(keeper) ?? truth.get(SECT_TOURNAMENT, keeper) ?? { with: {} };
          kept.set(keeper, {
            with: { ...had.with, [other]: { ...rec, status: "held", closed: ctx.now, closedBy } },
          });
        }
      }
      if (events.length === 0) return {};
      return {
        events,
        changes: [
          ...changes,
          ...[...kept]
            .sort(([x], [y]) => compareStrings(x, y))
            .map(([id, t]) => setComponent(SECT_TOURNAMENT, id, t)),
        ],
      };
    },
  };
}

export function sectTournamentProcess(o: {
  readonly dayTicks: number;
  /**
   * Opt-in (novel4-tournament-delegation): la visitante elige a los que manda de cuerpo. `player`
   * no es elegido (él pide ir si quiere).
   */
  readonly delegations?: { readonly player: AgentId };
}): ProcessDef {
  return {
    id: SECT_TOURNAMENT_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      SECT.name,
      ORG_RELATION.name,
      SECT_TOURNAMENT.name,
      ...(o.delegations
        ? [
            SECT_MEMBER.name,
            SECT_MISSION.name,
            ENTITY.name,
            BODY_STATE.name,
            PLACE.name,
            LOCATION.name,
          ]
        : []),
    ],
    writes: [SECT_TOURNAMENT.name],
    run(ctx) {
      const truth = ctx.truth;
      const sects = ([...truth.ids(SECT)] as EntityRef[]).sort(compareStrings);
      const events: EventDraft[] = [];
      const kept = new Map<EntityRef, SectTournaments>();
      const keep = (keeper: EntityRef, other: EntityRef, rec: TournamentRecord) => {
        const had = kept.get(keeper) ?? truth.get(SECT_TOURNAMENT, keeper) ?? { with: {} };
        kept.set(keeper, { with: { ...had.with, [other]: rec } });
      };
      for (const [i, a] of sects.entries()) {
        for (const b of sects.slice(i + 1)) {
          const [keeper, other] = tournamentKeeper(a, b);
          const rec = truth.get(SECT_TOURNAMENT, keeper)?.with[other];
          const sa = truth.get(SECT, a);
          const sb = truth.get(SECT, b);
          if (!sa || !sb) continue;
          if (rec && tournamentLate(rec, ctx.now, o.dayTicks)) {
            const host = rec.host === a ? sa : sb;
            const closedBy = draftEvent(events.length);
            events.push({
              kind: ORG_TOURNAMENT_LAPSED_EVENT,
              actors: [],
              place: { kind: "place", place: host.seatPlace as unknown as PlaceId },
              data: { host: rec.host, guest: rec.host === a ? b : a, at: rec.at },
              emissions: {},
              causes: [{ kind: "event", event: rec.called }],
            });
            keep(keeper, other, { ...rec, status: "lapsed", closed: ctx.now, closedBy });
            continue;
          }
          if (!tournamentDue(rec, ctx.now, o.dayTicks)) continue;
          const ab = orgTie(truth.get(ORG_RELATION, a), b);
          const ba = orgTie(truth.get(ORG_RELATION, b), a);
          if (!ab || !ba || !acceptsTournament(ab) || !acceptsTournament(ba)) continue;
          const host = nextHost(
            rec,
            { id: a, founded: sa.founded },
            { id: b, founded: sb.founded },
          );
          const guest = host === a ? b : a;
          const at = ctx.now + TOURNAMENT_NOTICE_DAYS * o.dayTicks;
          const seat = (host === a ? sa : sb).seatPlace;
          const prev: EventId = rec?.closedBy ?? rec?.called ?? ab.originEventId;
          const delegates = o.delegations ? pickDelegates(truth, guest, o.delegations.player) : [];
          keep(keeper, other, {
            host,
            at,
            called: draftEvent(events.length),
            status: "called",
            ...(delegates.length > 0 ? { delegates } : {}),
          });
          events.push({
            kind: ORG_TOURNAMENT_CALLED_EVENT,
            actors: delegates,
            place: { kind: "place", place: seat as unknown as PlaceId },
            data: { host, guest, at, ...(delegates.length > 0 ? { delegates } : {}) },
            emissions: {},
            causes: [
              { kind: "event", event: prev },
              { kind: "state", entity: a, key: ORG_RELATION.name },
              { kind: "state", entity: b, key: ORG_RELATION.name },
              ...delegates.map((d) => ({
                kind: "state" as const,
                entity: d as unknown as EntityRef,
                key: SECT_MEMBER.name,
              })),
            ],
          });
        }
      }
      if (events.length === 0 && kept.size === 0) return {};
      return {
        events,
        changes: [...kept]
          .sort(([x], [y]) => compareStrings(x, y))
          .map(([id, t]) => setComponent(SECT_TOURNAMENT, id, t)),
      };
    },
  };
}
