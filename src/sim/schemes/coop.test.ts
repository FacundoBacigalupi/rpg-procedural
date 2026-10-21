import { describe, expect, it } from "vitest";
import type { AgentId, EventId, ProjectId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  actualShare,
  addParticipant,
  contribute,
  contributionFraction,
  detectFreeRiders,
  freeRiderFraction,
  freeRiders,
  leavePressure,
  leaveProject,
  makeProject,
  poolConserved,
  sanctionFreeRider,
  settleProject,
  shareCommitment,
  wantsToLeave,
} from "./index.ts";

const ag = (n: number) => `agent:${n}` as AgentId;
const ev = (n: number) => `event:${n}` as EventId;
const rng = (n = 1) => Rng.root(11 as never).fork("coop", n);

function caravan(rule: "equal" | "contribution" | "stake" = "equal") {
  let p = makeProject({
    id: "project:2" as ProjectId,
    kind: "venture",
    owner: ag(1),
    plan: [{ key: "buy", cost: 4 }],
    good: "coin",
    shareRule: rule,
    originEventId: ev(1),
  });
  for (const n of [2, 3, 4]) {
    p = addParticipant(p, {
      agent: ag(n),
      role: "socio",
      knownPlan: null,
      believedShare: 1 / 3,
      promised: 10,
      stake: 0,
      joinedBy: ev(100 + n),
    });
  }
  return p;
}

describe("free riders", () => {
  it("el cooperativo con control paga más que el aprovechado sin control", () => {
    const good = {
      cooperativeness: 0.9,
      opportunityCost: 0.1,
      believedOthersPay: 0.9,
      believedOversight: 0.8,
    };
    const bad = {
      cooperativeness: 0.1,
      opportunityCost: 0.8,
      believedOthersPay: 0.2,
      believedOversight: 0,
    };
    expect(contributionFraction(good, rng())).toBeGreaterThan(contributionFraction(bad, rng()));
    expect(contributionFraction(good, rng(5))).toEqual(contributionFraction(good, rng(5)));
  });

  it("quien aporta bastante menos de lo prometido es free rider", () => {
    let p = caravan();
    p = contribute(p, ag(2), 10, 10, ev(10)).project;
    p = contribute(p, ag(3), 10, 10, ev(11)).project;
    p = contribute(p, ag(4), 2, 10, ev(12)).project;
    expect(freeRiders(p).map((x) => x.agent)).toEqual([ag(4)]);
    expect(freeRiderFraction(p)).toBeCloseTo(1 / 3, 5);
  });

  it("con reparto igual el free rider cobra lo mismo; sancionado, pierde la parte", () => {
    let p = caravan("equal");
    p = contribute(p, ag(2), 10, 10, ev(10)).project;
    p = contribute(p, ag(3), 10, 10, ev(11)).project;
    p = contribute(p, ag(4), 0, 10, ev(12)).project;
    expect(actualShare(p, ag(4))).toBeCloseTo(1 / 3, 5);
    const s = sanctionFreeRider(p, ag(4), ev(13));
    expect(actualShare(s, ag(4))).toBe(0);
    const r = settleProject(s, ev(14));
    expect(r.payouts.find((x) => x.agent === ag(4))).toBeUndefined();
    expect(r.payouts.reduce((a, x) => a + x.weight, 0)).toBe(20);
    expect(poolConserved(r.project.pool)).toBe(true);
  });

  it("con reparto por aporte el free rider cobra poco sin sanción", () => {
    let p = caravan("contribution");
    p = contribute(p, ag(2), 10, 10, ev(10)).project;
    p = contribute(p, ag(3), 10, 10, ev(11)).project;
    p = contribute(p, ag(4), 2, 10, ev(12)).project;
    expect(actualShare(p, ag(4))).toBeLessThan(actualShare(p, ag(2)));
  });

  it("la vigilancia descubre más y es determinista", () => {
    let p = caravan();
    p = contribute(p, ag(2), 10, 10, ev(10)).project;
    p = contribute(p, ag(3), 1, 10, ev(11)).project;
    p = contribute(p, ag(4), 0, 10, ev(12)).project;
    const count = (vig: number) => {
      let n = 0;
      for (let k = 0; k < 200; k++) n += detectFreeRiders(p, vig, rng(k)).length;
      return n;
    };
    expect(count(0)).toBe(0);
    expect(count(1)).toBeGreaterThan(count(0.3));
    expect(detectFreeRiders(p, 0.7, rng(9))).toEqual(detectFreeRiders(p, 0.7, rng(9)));
  });
});

describe("compromiso de reparto", () => {
  it("expresa el acuerdo como Commitment y refleja lo aportado", () => {
    let p = caravan();
    p = contribute(p, ag(2), 10, 10, ev(10)).project;
    p = contribute(p, ag(3), 4, 10, ev(11)).project;
    const c = shareCommitment(p, { id: "commitment:9", startDay: 0, dueDay: 30, day: 10 });
    expect(c.obligations.map((o) => o.state)).toEqual(["fulfilled", "partial", "pending"]);
    expect(c.status).toBe("active");
    expect(c.originEventId).toBe(ev(1));
    const late = shareCommitment(p, { id: "commitment:9", startDay: 0, dueDay: 30, day: 31 });
    expect(late.obligations.map((o) => o.state)).toEqual(["fulfilled", "defaulted", "defaulted"]);
    expect(late.status).toBe("defaulted");
  });
});

describe("irse", () => {
  it("el reparto injusto con free riders impunes y sin confianza empuja a irse", () => {
    const v = { believedShare: 0.4, perceivedFreeRiders: 0.6, trustInLeader: 0.2, sunk: 0.1 };
    expect(wantsToLeave(v, 0.1)).toBe(true);
    expect(wantsToLeave({ ...v, perceivedFreeRiders: 0, trustInLeader: 0.9, sunk: 0.8 }, 0.4)).toBe(
      false,
    );
    expect(leavePressure(v, 0.4)).toBeLessThan(leavePressure(v, 0.1));
  });
  it("lo aportado por quien se va queda en el pool y no cobra", () => {
    let p = caravan("contribution");
    p = contribute(p, ag(2), 10, 10, ev(10)).project;
    p = contribute(p, ag(3), 6, 10, ev(11)).project;
    p = leaveProject(p, ag(3), ev(12));
    expect(p.pool.balance).toBe(16);
    const r = settleProject(p, ev(13));
    expect(r.payouts.find((x) => x.agent === ag(3))).toBeUndefined();
    expect(r.payouts.find((x) => x.agent === ag(2))?.weight).toBe(16);
    expect(poolConserved(r.project.pool)).toBe(true);
  });
});
