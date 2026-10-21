import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, EventId, ProjectId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  addParticipant,
  advanceStep,
  contribute,
  coordinationFailures,
  decideJoin,
  fundedSteps,
  type InviteeView,
  makeProject,
  planDivergence,
  playerKnownPlan,
  poolConserved,
  projectCauses,
  settleProject,
  splitInteger,
  tellPlan,
} from "./index.ts";

const ag = (n: number) => `agent:${n}` as AgentId;
const ev = (n: number) => `event:${n}` as EventId;
const rng = (n = 1) => Rng.root(7 as never).fork("project", n);
const canal = () =>
  makeProject({
    id: "project:1" as ProjectId,
    kind: "construction",
    owner: ag(1),
    plan: [
      { key: "survey", cost: 2 },
      { key: "dig", cost: 10 },
      { key: "gate", cost: 3 },
    ],
    good: "labor-day",
    shareRule: "contribution",
    originEventId: ev(1),
  });
type P = ReturnType<typeof canal>;
const join = (p: P, n: number, known: readonly string[] | null, promised = 5) =>
  addParticipant(p, {
    agent: ag(n),
    role: "obrero",
    knownPlan: known,
    believedShare: 0.2,
    promised,
    stake: 0.1,
    joinedBy: ev(100 + n),
  });
const view = (o: Partial<InviteeView> = {}): InviteeView => ({
  believedGain: 0.6,
  trustInLeader: 0.8,
  believedRisk: 0.1,
  costOfRefusing: 0.2,
  opportunityCost: 0.2,
  cooperativeness: 0.6,
  ...o,
});

describe("proyectos cooperativos: sumarse", () => {
  it("confianza y ganancia creída lo deciden; el riesgo y el costo lo frenan", () => {
    expect(decideJoin(view(), rng()).join).toBe(true);
    const bad = view({ believedRisk: 1, opportunityCost: 1, believedGain: 0.1 });
    expect(decideJoin(bad, rng()).join).toBe(false);
    const distrust = view({ trustInLeader: 0, believedGain: 0.3, costOfRefusing: 0 });
    expect(decideJoin(distrust, rng()).join).toBe(false);
  });
  it("es determinista", () => {
    expect(decideJoin(view(), rng(3))).toEqual(decideJoin(view(), rng(3)));
  });
  it("no duplica a un participante", () => {
    const p = join(join(canal(), 2, null), 2, null);
    expect(p.participants).toHaveLength(1);
  });
});

describe("proyectos cooperativos: pool con conservación", () => {
  it("nunca entra más de lo que el aportante tiene", () => {
    const p = join(canal(), 2, null);
    const r = contribute(p, ag(2), 8, 3, ev(10));
    expect(r.moved).toBe(3);
    expect(r.project.pool.balance).toBe(3);
    expect(r.project.participants[0]?.contributed).toBe(3);
    expect(r.project.status).toBe("preparing");
  });
  it("un ajeno no aporta", () => {
    expect(contribute(canal(), ag(9), 5, 5, ev(10)).moved).toBe(0);
  });
  it("los pasos se pagan del pool y el último cierra el proyecto", () => {
    let p = join(canal(), 2, null, 15);
    p = contribute(p, ag(2), 15, 15, ev(10)).project;
    let steps = 0;
    for (let i = 0; i < 5; i++) {
      const r = advanceStep(p, ev(20 + i));
      p = r.project;
      if (r.step !== null) steps++;
    }
    expect(steps).toBe(3);
    expect(p.status).toBe("succeeded");
    expect(p.pool.balance).toBe(0);
    expect(fundedSteps(p)).toBe(3);
    expect(poolConserved(p.pool)).toBe(true);
  });
  it("sin saldo suficiente no gasta nada", () => {
    let p = join(canal(), 2, null);
    p = contribute(p, ag(2), 1, 1, ev(10)).project;
    expect(advanceStep(p, ev(11)).step).toBeNull();
  });
  it("el reparto sale del pool, según el aporte, y suma exacto", () => {
    let p = join(join(join(canal(), 2, null), 3, null), 4, null);
    p = contribute(p, ag(2), 7, 7, ev(10)).project;
    p = contribute(p, ag(3), 3, 3, ev(11)).project;
    p = contribute(p, ag(4), 1, 1, ev(12)).project;
    const r = settleProject(p, ev(13));
    expect(r.payouts.reduce((a, x) => a + x.weight, 0)).toBe(11);
    expect(r.project.pool.balance).toBe(0);
    expect(r.project.pool.distributed).toBe(11);
    expect(poolConserved(r.project.pool)).toBe(true);
    const w2 = r.payouts.find((x) => x.agent === ag(2))?.weight ?? 0;
    const w3 = r.payouts.find((x) => x.agent === ag(3))?.weight ?? 99;
    expect(w2).toBeGreaterThan(w3);
  });
  it("propiedad: aportes, gastos y repartos siempre conservan", () => {
    const op = fc.tuple(
      fc.integer({ min: 2, max: 6 }),
      fc.integer({ min: 0, max: 20 }),
      fc.integer({ min: 0, max: 20 }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
        let p = canal();
        for (let n = 2; n <= 6; n++) p = join(p, n, null);
        let e = 100;
        let given = 0;
        for (const [who, qty, have] of ops) {
          const r = contribute(p, ag(who), qty, have, ev(e++));
          p = r.project;
          given += r.moved;
        }
        const step = advanceStep(p, ev(e++));
        p = step.project;
        const spent = step.step?.cost ?? 0;
        p = settleProject(p, ev(e++)).project;
        return poolConserved(p.pool) && p.pool.contributed === given && p.pool.spent === spent;
      }),
    );
  });
  it("splitInteger suma el total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 8 }),
        (total, ws) => {
          const w = ws.map((x, i) => ({ agent: ag(i), weight: x }));
          const sum = splitInteger(total, w).reduce((a, x) => a + x.weight, 0);
          return ws.every((x) => x === 0) ? sum === 0 : sum === total;
        },
      ),
    );
  });
});

describe("proyectos cooperativos: knownPlan y coordinación", () => {
  it("cuenta el plan compartimentado y mide la divergencia", () => {
    const p = canal();
    expect(tellPlan(p, 1)).toEqual(["survey"]);
    const q = join(join(p, 2, tellPlan(p, "all")), 3, ["survey", "gate"]);
    const [a, b] = q.participants;
    expect(a && planDivergence(q, a)).toBe(0);
    expect(b && planDivergence(q, b)).toBeGreaterThan(0);
  });
  it("dos participantes con planes distintos fallan al coordinarse; con el mismo, no", () => {
    const p = canal();
    const full = tellPlan(p, "all");
    expect(coordinationFailures(join(join(p, 2, full), 3, full))).toEqual([]);
    const diff = join(join(p, 2, full), 3, ["survey", "gate", "dig"]);
    expect(coordinationFailures(diff)).toEqual([{ a: ag(2), b: ag(3), atStep: 1 }]);
  });
  it("el narrador solo recibe el plan que conoce el personaje", () => {
    const p = join(join(canal(), 2, ["survey"]), 3, null);
    expect(playerKnownPlan(p, ag(2))).toEqual(["survey"]);
    expect(playerKnownPlan(p, ag(3))).toBeNull();
    expect(playerKnownPlan(p, ag(1))).toBeNull();
  });
  it("todo evento del proyecto cita el origen", () => {
    let p = join(canal(), 2, null);
    p = contribute(p, ag(2), 2, 2, ev(10)).project;
    expect(projectCauses(p)).toEqual([ev(10), ev(1)]);
    expect(projectCauses(canal())).toEqual([ev(1)]);
  });
});
