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

import {
  type AgentId,
  compareStrings,
  type EntityRef,
  type EventId,
  type PlaceId,
} from "../../core/index.ts";
import {
  acceptsTournament,
  BODY_STATE,
  delegateLeg,
  draftEvent,
  ENTITY,
  type EventDraft,
  houseKey,
  LOCATION,
  type LocalMap,
  nextHost,
  ORG_RELATION,
  ORG_TOURNAMENT_CALLED_EVENT,
  ORG_TOURNAMENT_LAPSED_EVENT,
  orgTie,
  PERSON,
  PLACE,
  type ProcessDef,
  patchOf,
  type ReadonlyWorldTruth,
  SECT,
  SECT_MEMBER,
  SECT_MISSION,
  SECT_TOURNAMENT,
  type SectTournaments,
  type SpaceGraph,
  setComponent,
  TOURNAMENT_DELEGATES,
  TOURNAMENT_NOTICE_DAYS,
  type TournamentRecord,
  tournamentDue,
  tournamentKeeper,
  tournamentLate,
} from "../../sim/index.ts";
import { atSeat, pickEnvoy } from "./sect-grievance.ts";

export const SECT_TOURNAMENT_PROCESS = "life.sect_tournament";
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
