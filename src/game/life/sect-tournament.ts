// El torneo entre sectas (novel4-tournament). Convocarlo (novel4-tournament-call): cada día, por par
// de sectas rivales sin torneo convocado y con el anterior lejos (`tournamentDue`), si las dos lo
// aceptan por lo que sienten de la otra (`acceptsTournament`), la que le toca (`nextHost`) lo pone en
// su plataforma a `TOURNAMENT_NOTICE_DAYS` (`org.tournament_called`, en su sede). Si el día pasa y no
// se hizo, se pierde (`org.tournament_lapsed`) y desde ahí corre la espera del siguiente.

import { compareStrings, type EntityRef, type EventId, type PlaceId } from "../../core/index.ts";
import {
  acceptsTournament,
  draftEvent,
  type EventDraft,
  nextHost,
  ORG_RELATION,
  ORG_TOURNAMENT_CALLED_EVENT,
  ORG_TOURNAMENT_LAPSED_EVENT,
  orgTie,
  type ProcessDef,
  SECT,
  SECT_TOURNAMENT,
  type SectTournaments,
  setComponent,
  TOURNAMENT_NOTICE_DAYS,
  type TournamentRecord,
  tournamentDue,
  tournamentKeeper,
  tournamentLate,
} from "../../sim/index.ts";

export const SECT_TOURNAMENT_PROCESS = "life.sect_tournament";

export function sectTournamentProcess(o: { readonly dayTicks: number }): ProcessDef {
  return {
    id: SECT_TOURNAMENT_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [SECT.name, ORG_RELATION.name, SECT_TOURNAMENT.name],
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
          keep(keeper, other, { host, at, called: draftEvent(events.length), status: "called" });
          events.push({
            kind: ORG_TOURNAMENT_CALLED_EVENT,
            actors: [],
            place: { kind: "place", place: seat as unknown as PlaceId },
            data: { host, guest, at },
            emissions: {},
            causes: [
              { kind: "event", event: prev },
              { kind: "state", entity: a, key: ORG_RELATION.name },
              { kind: "state", entity: b, key: ORG_RELATION.name },
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
