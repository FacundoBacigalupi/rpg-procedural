import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type EventId,
  type OrgId,
  Rng,
  type SettlementId,
} from "../../core/index.ts";
import { foundCouncil, orgViolations } from "./council.ts";
import {
  type Agenda,
  agendaViolations,
  chooseRaiser,
  closeIssue,
  DEFAULT_ISSUE_RULES,
  deliberate,
  EMPTY_AGENDA,
  hearIssue,
  type Issue,
  type IssueBelief,
  lapse,
  type MemberView,
  openIssue,
  type Perceived,
  perceiveIssue,
  recentlyHandled,
  utility,
  voteProbability,
  weightsFor,
} from "./issues.ts";

const ag = (n: number) => `agent:${n}` as AgentId;
const ev = (n: number) => `event:${n}` as EventId;
const orgId = "org:1" as OrgId;

const council = (n: number) =>
  foundCouncil({
    id: orgId,
    settlement: "settlement:1" as SettlementId,
    elders: Array.from({ length: n }, (_, i) => ({ agent: ag(i + 1), ageYears: 70 - i })),
    originEventId: ev(1),
    at: 0,
  });

const view = (n: number, over: Partial<MemberView> = {}): MemberView => ({
  agent: ag(n),
  affected: false,
  closeness: 0,
  stake: 0,
  trustIn: () => 0,
  ...over,
});
const belief = (severity: number, confidence: number): IssueBelief => ({
  kind: "famine",
  subject: "household:1",
  severity,
  confidence,
});
const issueBy = (raisedBy: AgentId, n = 0): Issue => ({
  id: `issue:org:1:${n}`,
  org: orgId,
  kind: "famine",
  subject: "household:1",
  raisedBy,
  raisedAt: 0,
  beliefs: [belief(0.8, 1)],
  raisedEvent: ev(10 + n),
  causes: [{ kind: "event", event: ev(2) }],
});

describe("sim/org: asuntos", () => {
  it("quien está lejos de la presión ni se entera; el afectado la ve entera", () => {
    expect(perceiveIssue("famine", "h", 0.9, view(1, { closeness: 0.05 }))).toBeNull();
    const far = perceiveIssue("famine", "h", 0.9, view(1, { closeness: 0.4 }));
    const own = perceiveIssue("famine", "h", 0.9, view(1, { affected: true }));
    expect(own?.confidence).toBe(1);
    expect((far?.confidence ?? 0) < 1 && (far?.severity ?? 1) < (own?.severity ?? 0)).toBe(true);
  });

  it("un asunto que nadie percibe no existe aunque la presión sea real", () => {
    const o = council(3);
    const none = new Map<AgentId, Perceived>(
      [1, 2, 3].map((n) => [ag(n), { view: view(n), belief: null }]),
    );
    expect(chooseRaiser(o, none)).toBeNull();
  });

  it("a quien le conviene callar no lo plantea, aunque lo perciba mejor", () => {
    const o = council(3);
    const perceived = new Map<AgentId, Perceived>([
      [ag(1), { view: view(1, { stake: -1, affected: true }), belief: belief(0.26, 1) }],
      [ag(2), { view: view(2, { closeness: 0.5 }), belief: belief(0.5, 0.5) }],
      [ag(3), { view: view(3), belief: null }],
    ]);
    expect(chooseRaiser(o, perceived)?.agent).toBe(ag(2));
  });

  it("oír la creencia del otro la debilita por la desconfianza", () => {
    const b = belief(0.8, 0.8);
    expect(hearIssue(b, 1).confidence).toBe(0.8);
    expect(hearIssue(b, -1).confidence).toBe(0);
    expect(hearIssue(b, 0).confidence).toBe(0.4);
  });

  it("la utilidad sube con la gravedad creída y con el interés propio", () => {
    const w = weightsFor("elder", DEFAULT_ISSUE_RULES);
    const v = view(2);
    expect(utility(belief(0.9, 1), v, ag(1), w)).toBeGreaterThan(
      utility(belief(0.2, 1), v, ag(1), w),
    );
    expect(utility(null, view(2, { stake: 0.8 }), ag(1), w)).toBeGreaterThan(
      utility(null, v, ag(1), w),
    );
    expect(voteProbability(0, 0.25)).toBe(0.5);
  });

  it("delibera con las creencias que circulan y es determinista con el mismo RNG", () => {
    const o = council(5);
    const perceived = new Map<AgentId, Perceived>(
      [1, 2, 3, 4, 5].map((n) => [
        ag(n),
        {
          view: view(n, { trustIn: () => 0.5, stake: n === 1 ? 0.8 : 0 }),
          belief: n === 1 ? belief(0.9, 1) : null,
        },
      ]),
    );
    const run = () =>
      deliberate({
        org: o,
        issue: issueBy(ag(1)),
        perceived,
        raiserBelief: belief(0.9, 1),
        rng: Rng.root(7 as never).fork("t"),
        at: 100,
        decisionId: "decision:org:1:1",
      });
    const a = run();
    expect(a).toEqual(run());
    expect(a.circulated).toEqual([ag(2), ag(3), ag(4), ag(5)]);
    expect(a.decision.votes.map((v) => v.agent)).toEqual([ag(1), ag(2), ag(3), ag(4), ag(5)]);
    expect(a.decision.votes.find((v) => v.agent === ag(2))?.confidence).toBeCloseTo(0.75);
    const agenda = closeIssue(openIssue(EMPTY_AGENDA, issueBy(ag(1))), a.decision, 20);
    expect(agendaViolations(o, agenda)).toEqual([]);
  });

  it("enfriamiento: lo recién decidido o abierto no se vuelve a plantear", () => {
    const o = council(3);
    const open = openIssue(EMPTY_AGENDA, issueBy(ag(1)));
    expect(recentlyHandled(open, "famine", "household:1", 5, 100)).toBe(true);
    const done = closeIssue(open, lapse(issueBy(ag(1)), 10, "decision:org:1:1"), 20);
    expect(recentlyHandled(done, "famine", "household:1", 50, 100)).toBe(true);
    expect(recentlyHandled(done, "famine", "household:1", 500, 100)).toBe(false);
    expect(agendaViolations(o, done)).toEqual([]);
  });

  it("las violaciones se detectan: voto de un extraño, doble voto y resultado torcido", () => {
    const o = council(3);
    const d = deliberate({
      org: o,
      issue: issueBy(ag(1)),
      perceived: new Map(
        [1, 2, 3].map((n) => [ag(n), { view: view(n, { stake: 1 }), belief: belief(0.9, 1) }]),
      ),
      raiserBelief: belief(0.9, 1),
      rng: Rng.root(1 as never).fork("t"),
      at: 1,
      decisionId: "decision:org:1:1",
    }).decision;
    const bad: Agenda = {
      open: [],
      decisions: [
        {
          ...d,
          outcome: d.outcome === "enacted" ? "rejected" : "enacted",
          votes: [...d.votes, { ...(d.votes[0] as (typeof d.votes)[number]), agent: ag(99) }],
        },
      ],
      serial: 1,
    };
    const v = agendaViolations(o, bad);
    expect(v.some((x) => x.includes("sin ser miembro"))).toBe(true);
    expect(v.some((x) => x.includes("no coincide"))).toBe(true);
  });

  it("propiedad: toda deliberación cumple las reglas, es reproducible y el desempate rechaza", () => {
    const row = fc.record({
      severity: fc.double({ min: 0, max: 1, noNaN: true }),
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      stake: fc.double({ min: -1, max: 1, noNaN: true }),
      trust: fc.double({ min: -1, max: 1, noNaN: true }),
      knows: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(row, { minLength: 2, maxLength: 6 }),
        fc.integer({ min: 1, max: 1e6 }),
        (rows, seed) => {
          const o = council(rows.length);
          expect(orgViolations(o)).toEqual([]);
          const perceived = new Map<AgentId, Perceived>(
            rows.map((r, i) => [
              ag(i + 1),
              {
                view: view(i + 1, { stake: r.stake, trustIn: () => r.trust }),
                belief: r.knows ? belief(r.severity, r.confidence) : null,
              },
            ]),
          );
          const input = {
            org: o,
            issue: issueBy(ag(1)),
            perceived,
            raiserBelief: belief(rows[0]?.severity ?? 0, rows[0]?.confidence ?? 0),
            rng: Rng.root(seed as never).fork("p"),
            at: 5,
            decisionId: "decision:org:1:1",
          };
          const a = deliberate(input);
          expect(deliberate({ ...input, rng: Rng.root(seed as never).fork("p") })).toEqual(a);
          expect(a.decision.votes).toHaveLength(rows.length);
          const agenda = closeIssue(openIssue(EMPTY_AGENDA, issueBy(ag(1))), a.decision, 20);
          expect(agendaViolations(o, agenda)).toEqual([]);
        },
      ),
      { numRuns: 80 },
    );
  });
});
