import { describe, expect, it } from "vitest";
import type { EntityRef, EventId } from "../../core/index.ts";
import type { OrgTie } from "../org/index.ts";
import {
  acceptsTournament,
  afterTournamentSeen,
  delegateLeg,
  nextHost,
  TOURNAMENT_EVERY_DAYS,
  TOURNAMENT_LATE_DAYS,
  TOURNAMENT_MAX_FEAR,
  TOURNAMENT_MAX_RESENTMENT,
  TOURNAMENT_RETURN_DAYS,
  TOURNAMENT_SETOFF_DAYS,
  type TournamentRecord,
  tournamentDue,
  tournamentKeeper,
  tournamentLate,
} from "./tournament.ts";

const DAY = 100;
const A = "org:1" as EntityRef;
const B = "org:2" as EntityRef;
const tie = (resentment: number, fear: number, rival = true): OrgTie => ({
  formal: rival ? ["rival"] : [],
  sentiment: { trust: 0.3, respect: 0.4, fear, resentment },
  believedStrength: { elders: 2, disciples: 10, topStage: 3 },
  grievances: [],
  originEventId: "event:1" as EventId,
  history: [],
});
const rec = (o: Partial<TournamentRecord>): TournamentRecord => ({
  host: A,
  at: 1000,
  called: "event:2" as EventId,
  status: "called",
  ...o,
});

describe("el torneo entre sectas (novel4-tournament-call)", () => {
  it("se acepta entre rivales sin mucho rencor ni miedo", () => {
    expect(acceptsTournament(tie(0.2, 0.2))).toBe(true);
    expect(acceptsTournament(tie(TOURNAMENT_MAX_RESENTMENT, 0))).toBe(false);
    expect(acceptsTournament(tie(0, TOURNAMENT_MAX_FEAR))).toBe(false);
    expect(acceptsTournament(tie(0, 0, false))).toBe(false);
    expect(acceptsTournament(undefined)).toBe(false);
  });

  it("toca la primera vez y después de la espera desde el cierre", () => {
    expect(tournamentDue(undefined, 0, DAY)).toBe(true);
    expect(tournamentDue(rec({}), 5000, DAY)).toBe(false);
    const held = rec({ status: "held", closed: 1000 });
    expect(tournamentDue(held, 1000 + TOURNAMENT_EVERY_DAYS * DAY - 1, DAY)).toBe(false);
    expect(tournamentDue(held, 1000 + TOURNAMENT_EVERY_DAYS * DAY, DAY)).toBe(true);
  });

  it("se pierde pasado el día", () => {
    expect(tournamentLate(rec({}), 1000 + TOURNAMENT_LATE_DAYS * DAY - 1, DAY)).toBe(false);
    expect(tournamentLate(rec({}), 1000 + TOURNAMENT_LATE_DAYS * DAY, DAY)).toBe(true);
    expect(tournamentLate(rec({ status: "held" }), 1e9, DAY)).toBe(false);
  });

  it("lo pone la más vieja y después se turnan", () => {
    expect(nextHost(undefined, { id: A, founded: 50 }, { id: B, founded: 10 })).toBe(B);
    expect(nextHost(undefined, { id: A, founded: 10 }, { id: B, founded: 10 })).toBe(A);
    expect(nextHost(rec({ host: B }), { id: A, founded: 50 }, { id: B, founded: 10 })).toBe(A);
    expect(tournamentKeeper(B, A)).toEqual([A, B]);
  });

  it("el delegado va antes del día, se queda mientras está convocado y vuelve al cerrarse", () => {
    const at = 100 * DAY;
    expect(delegateLeg(rec({ at }), at - TOURNAMENT_SETOFF_DAYS * DAY - 1, DAY)).toBeUndefined();
    expect(delegateLeg(rec({ at }), at - TOURNAMENT_SETOFF_DAYS * DAY, DAY)).toBe("host");
    expect(delegateLeg(rec({ at }), at + 5 * DAY, DAY)).toBe("host");
    const held = rec({ at, status: "held", closed: at });
    expect(delegateLeg(held, at + DAY, DAY)).toBe("home");
    expect(delegateLeg(held, at + TOURNAMENT_RETURN_DAYS * DAY, DAY)).toBeUndefined();
  });
});

describe("lo que deja el torneo (novel4-tournament-prize)", () => {
  it("lo visto en la plataforma es un piso de la fuerza creída", () => {
    const t = tie(0.1, 0.1);
    const seen = afterTournamentSeen(
      t,
      { disciples: 3, elders: 0, topStage: 5 },
      "event:9" as EventId,
    );
    expect(seen.believedStrength).toEqual({ elders: 2, disciples: 10, topStage: 5 });
    expect(seen.history).toEqual(["event:9"]);
    const more = afterTournamentSeen(
      t,
      { disciples: 12, elders: 3, topStage: 1 },
      "event:9" as EventId,
    );
    expect(more.believedStrength).toEqual({ elders: 3, disciples: 12, topStage: 3 });
  });
});
