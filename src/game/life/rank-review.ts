// La secta decide el ascenso (novel2-rank-review, organizations §4): un asunto que alguien plantea
// (el anciano al que se lo pidieron, `cultivation.rank_petition`, o el maestro del candidato cuando
// rompe y ya llega) lo decide el maestro de la secta si está en la sede, o el anciano más alto que
// esté; los demás ancianos presentes y el maestro del candidato pesan con lo que sienten por él. Sin
// nadie que decida en la sede, el asunto se cae. Lo escribe `sectDutyProcess`, el único escritor de
// `SECT_MEMBER` y `SECT_RANK_RULING`.

import type { AgentId, EntityRef, EventId, PlaceRef, Rng, Tick } from "../../core/index.ts";
import {
  CULTIVATION_STATE,
  type DecayContext,
  daysInRank,
  ENTITY,
  type EventDraft,
  judgeRankUp,
  LOCATION,
  MASTER_OF,
  MIND,
  nextRank,
  PLACE,
  type RankVoice,
  RELATIONS,
  type ReadonlyWorldTruth,
  rankWaits,
  relationship,
  SECT,
  SECT_CONTRIBUTION,
  SECT_MEMBER,
  SECT_PROMOTED_EVENT,
  SECT_RANK_REFUSED_EVENT,
  SECT_RANK_RULING,
  SECT_TRIAL,
  type SectMember,
  SPONSOR_WEIGHT,
  type StateChange,
  setComponent,
  warmth,
} from "../../sim/index.ts";

/** Las tablas que lee la revisión (además de las que ya lee `sect-duty`). */
export const RANK_REVIEW_READS = [
  ENTITY.name,
  MASTER_OF.name,
  MIND.name,
  RELATIONS.name,
  SECT_RANK_RULING.name,
  SECT_TRIAL.name,
] as const;

/** Un asunto de ascenso: de quién, quién lo planteó y por qué evento. */
export interface RankIssue {
  readonly who: AgentId;
  readonly org: EntityRef;
  readonly raisedBy: AgentId;
  readonly cause: EventId;
  readonly place: PlaceRef;
  /**
   * Lo plantea el maestro del candidato por su cuenta (al romper): solo si está en la sede y cree
   * que ya cumple los pisos; si no, no hay asunto.
   */
  readonly onlyIfDue?: boolean;
}

export interface RankReviewContext {
  readonly truth: ReadonlyWorldTruth;
  readonly now: Tick;
  readonly rng: Rng;
  readonly dayTicks: number;
  /** Las dimensiones y lazos de las relaciones; sin esto, nadie siente nada por el candidato. */
  readonly relations?: Pick<DecayContext, "dims" | "bonds">;
}

const alive = (truth: ReadonlyWorldTruth, who: AgentId) =>
  truth.has(ENTITY, who as unknown as EntityRef) &&
  truth.get(ENTITY, who as unknown as EntityRef)?.endedAt === undefined;

/** Cómo siente `a` a `b` (-1 a 1), con sus relaciones; sin contenido de relaciones, 0. */
function regardOf(c: RankReviewContext, a: AgentId, b: AgentId): number {
  if (!c.relations) return 0;
  const ref = a as unknown as EntityRef;
  const feel = relationship(c.truth.get(RELATIONS, ref), b, c.now, {
    ...c.relations,
    schemaStrength: (s) => c.truth.get(MIND, ref)?.schemas[s]?.strength ?? 0,
  }).dims;
  return Math.max(-1, Math.min(1, warmth(feel)));
}

/** Los ancianos y el maestro de `org` vivos en la sede, del más alto al más bajo. */
function eldersAtSeat(c: RankReviewContext, org: EntityRef, except: AgentId): AgentId[] {
  const sect = c.truth.get(SECT, org);
  const seat = sect ? c.truth.get(PLACE, sect.seatPlace) : undefined;
  if (!seat) return [];
  const out: { id: AgentId; master: boolean; stage: number }[] = [];
  for (const id of c.truth.ids(SECT_MEMBER)) {
    const who = id as unknown as AgentId;
    if (who === except) continue;
    const m = c.truth.get(SECT_MEMBER, id);
    if (m?.org !== org || (m.rank !== "elder" && m.rank !== "master")) continue;
    const hex = c.truth.get(LOCATION, id)?.hex;
    if (hex === undefined || !seat.hexes.includes(hex) || !alive(c.truth, who)) continue;
    out.push({
      id: who,
      master: m.rank === "master",
      stage: c.truth.get(CULTIVATION_STATE, id)?.stage ?? 0,
    });
  }
  out.sort(
    (a, b) =>
      Number(b.master) - Number(a.master) ||
      b.stage - a.stage ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return out.map((x) => x.id);
}

/** Lo que la secta sabe del candidato: rango, tramo, aporte, días en el rango y talento medido. */
function rankFacts(c: RankReviewContext, ref: EntityRef, member: SectMember, org: EntityRef) {
  const contribution = c.truth.get(SECT_CONTRIBUTION, ref);
  const trial = c.truth.get(SECT_TRIAL, ref);
  return {
    rank: member.rank,
    stage: c.truth.get(CULTIVATION_STATE, ref)?.stage ?? 0,
    points: contribution?.org === org ? contribution.points : 0,
    days: daysInRank(member, c.now, c.dayTicks),
    ...(trial && trial.org === org ? { talent: trial.reading.quality } : {}),
  };
}

/**
 * Trata un asunto de ascenso: nada si el candidato ya no es de la secta, no tiene paso que se decida
 * o la secta todavía lo hace esperar; si no, decide el que manda en la sede (o se cae, sin nadie).
 */
export function reviewRank(
  c: RankReviewContext,
  issue: RankIssue,
): { readonly changes: StateChange[]; readonly events: EventDraft[] } {
  const none = { changes: [], events: [] };
  const who = issue.who;
  const ref = who as unknown as EntityRef;
  const member = c.truth.get(SECT_MEMBER, ref);
  if (member?.org !== issue.org) return none;
  const step = nextRank(member.rank);
  if (!step) return none;
  if (rankWaits(c.truth.get(SECT_RANK_RULING, ref), member, c.now, c.dayTicks)) return none;
  const base = {
    kind: SECT_RANK_REFUSED_EVENT,
    actors: [who],
    place: issue.place,
    emissions: {},
    causes: [
      { kind: "event" as const, event: issue.cause },
      { kind: "state" as const, entity: ref, key: SECT_MEMBER.name },
    ],
  };
  const elders = eldersAtSeat(c, issue.org, who);
  const facts = rankFacts(c, ref, member, issue.org);
  if (issue.onlyIfDue) {
    if (!elders.includes(issue.raisedBy)) return none;
    const due = judgeRankUp({ ...facts, regard: regardOf(c, issue.raisedBy, who), voices: [] }, 0);
    if (due.kind !== "promoted") return none;
  }
  const decider = elders[0];
  if (decider === undefined) {
    return {
      changes: [],
      events: [
        {
          ...base,
          data: {
            org: issue.org,
            from: member.rank,
            to: step.to,
            refused: "no_one",
            raisedBy: issue.raisedBy,
          },
        },
      ],
    };
  }
  // Las voces: los otros ancianos presentes, y el maestro del candidato con más peso.
  const sponsor = c.truth.get(MASTER_OF, ref)?.master;
  const voices: RankVoice[] = elders.slice(1).map((e) => ({
    regard: regardOf(c, e, who),
    weight: e === sponsor ? SPONSOR_WEIGHT : 1,
  }));
  const ruling = judgeRankUp(
    { ...facts, regard: regardOf(c, decider, who), voices },
    c.rng.fork("rank", who).float(),
  );
  const changes: StateChange[] = [
    setComponent(SECT_RANK_RULING, ref, {
      org: issue.org,
      rank: member.rank,
      at: c.now,
      outcome: ruling.kind,
      ...(ruling.kind === "refused" ? { refused: ruling.refused } : {}),
    }),
  ];
  const data = {
    org: issue.org,
    from: member.rank,
    to: step.to,
    by: decider,
    raisedBy: issue.raisedBy,
    voices: voices.length,
    ...(ruling.score !== undefined ? { score: ruling.score } : {}),
    ...(ruling.p !== undefined ? { p: ruling.p } : {}),
  };
  const causes = [
    ...base.causes,
    { kind: "state" as const, entity: ref, key: SECT_CONTRIBUTION.name },
    { kind: "state" as const, entity: ref, key: CULTIVATION_STATE.name },
  ];
  if (ruling.kind === "refused") {
    return {
      changes,
      events: [
        { ...base, actors: [who, decider], data: { ...data, refused: ruling.refused }, causes },
      ],
    };
  }
  changes.push(setComponent(SECT_MEMBER, ref, { ...member, rank: ruling.to, rankSince: c.now }));
  return {
    changes,
    events: [
      {
        ...base,
        kind: SECT_PROMOTED_EVENT,
        actors: [who, decider],
        data,
        emissions: { sight: 0.3 },
        causes,
      },
    ],
  };
}
