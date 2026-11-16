// La rivalidad entre sectas (novel4-rival-sect-relation): la fuerza creída con error acotado y el
// sentimiento de rival, puros y deterministas.

import { describe, expect, it } from "vitest";
import { type AgentId, type EntityRef, type EventId, Rng, type Tick } from "../../core/index.ts";
import type { OrgTie } from "../org/index.ts";
import {
  addGrievance,
  afterAvenged,
  afterReplyGiven,
  afterReplyReceived,
  afterSectDuel,
  BELIEF_ERROR,
  chooseGrievanceResponse,
  chooseReply,
  ENVOY_DAYS,
  ENVOY_WAIT_DAYS,
  envoySlotReturns,
  envoyWanted,
  GRIEVANCE_RESENTMENT,
  grievanceUtilities,
  rivalSentiment,
  seededBelief,
  strengthScore,
  wantedBy,
} from "./rivalry.ts";

describe("la fuerza creída de la otra secta (novel4-rival-sect-relation)", () => {
  const truth = { elders: 3, disciples: 10, topStage: 3 };

  it("erra dentro del margen, a veces de más y a veces de menos; determinista", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const b = seededBelief(truth, Rng.root(i).fork("b"));
      expect(b.disciples).toBeGreaterThanOrEqual(Math.floor(10 * (1 - BELIEF_ERROR)));
      expect(b.disciples).toBeLessThanOrEqual(Math.ceil(10 * (1 + BELIEF_ERROR)));
      expect(b.elders).toBeGreaterThanOrEqual(1);
      expect(Math.abs(b.topStage - 3)).toBeLessThanOrEqual(1);
      seen.add(Math.sign(strengthScore(b) - strengthScore(truth)).toString());
      expect(seededBelief(truth, Rng.root(i).fork("b"))).toEqual(b);
    }
    expect(seen.has("1") && seen.has("-1")).toBe(true);
  });

  it("teme más a la que cree más fuerte", () => {
    const weak = { elders: 1, disciples: 3, topStage: 1 };
    const strong = { elders: 4, disciples: 12, topStage: 4 };
    const scared = rivalSentiment(weak, strong, Rng.root(1));
    const calm = rivalSentiment(strong, weak, Rng.root(1));
    expect(scared.fear).toBeGreaterThan(calm.fear);
    for (const v of Object.values(scared)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("el duelo entre sectas mueve la relación (novel4-sect-meet-face)", () => {
  const tie = {
    formal: ["rival" as const],
    sentiment: { trust: 0.1, respect: 0.4, fear: 0.2, resentment: 0.3 },
    believedStrength: { elders: 1, disciples: 3, topStage: 1 },
    grievances: [],
    originEventId: "event:1" as EventId,
    history: ["event:1" as EventId],
  };
  const fight = "event:9" as EventId;

  it("la del vencido respeta más y guarda más rencor; la del vencedor respeta menos", () => {
    const lost = afterSectDuel(tie, "lost", fight);
    expect(lost.sentiment.respect).toBeGreaterThan(0.4);
    expect(lost.sentiment.resentment).toBeGreaterThan(0.3);
    expect(lost.sentiment.trust).toBe(0.1);
    const won = afterSectDuel(tie, "won", fight);
    expect(won.sentiment.respect).toBeLessThan(0.4);
    expect(won.sentiment.resentment).toBe(0.3);
    expect(won.history).toEqual(["event:1", "event:9"]);
  });

  it("no pasa de los bordes", () => {
    let t: OrgTie = { ...tie, sentiment: { ...tie.sentiment, respect: 0.99, resentment: 0.99 } };
    for (let i = 0; i < 5; i++) t = afterSectDuel(t, "lost", fight);
    expect(t.sentiment.respect).toBe(1);
    expect(t.sentiment.resentment).toBe(1);
    let w: OrgTie = { ...tie, sentiment: { ...tie.sentiment, respect: 0.01 } };
    for (let i = 0; i < 5; i++) w = afterSectDuel(w, "won", fight);
    expect(w.sentiment.respect).toBe(0);
  });
});

describe("las ofensas entre sectas (novel4-grievance-record)", () => {
  const tie: OrgTie = {
    formal: ["rival"],
    sentiment: { trust: 0.1, respect: 0.4, fear: 0.2, resentment: 0.3 },
    believedStrength: { elders: 1, disciples: 3, topStage: 1 },
    grievances: [],
    originEventId: "event:1" as EventId,
    history: ["event:1" as EventId],
  };

  it("la ofensa queda una sola vez y sube el rencor según su peso", () => {
    const killed = addGrievance(tie, "event:7" as EventId, "killing");
    expect(killed.grievances).toEqual(["event:7"]);
    expect(killed.history).toEqual(["event:1", "event:7"]);
    expect(killed.sentiment.resentment).toBeCloseTo(0.3 + GRIEVANCE_RESENTMENT.killing);
    expect(addGrievance(killed, "event:7" as EventId, "killing")).toBe(killed);
    const robbed = addGrievance(tie, "event:8" as EventId, "theft");
    expect(robbed.sentiment.resentment).toBeLessThan(killed.sentiment.resentment);
  });
});

describe("la secta trata la ofensa (novel4-grievance-matter)", () => {
  const tieWith = (fear: number, resentment: number): OrgTie => ({
    formal: ["rival"],
    sentiment: { trust: 0.1, respect: 0.4, fear, resentment },
    believedStrength: { elders: 1, disciples: 3, topStage: 1 },
    grievances: [],
    originEventId: "event:1" as EventId,
    history: ["event:1" as EventId],
  });

  it("con miedo y un robo, olvida; con rencor, sin miedo y una muerte, la devuelve", () => {
    const scared = grievanceUtilities(tieWith(0.9, 0.1), "theft");
    expect(scared.forget).toBeGreaterThan(scared.demand);
    expect(scared.forget).toBeGreaterThan(scared.retaliate);
    const angry = grievanceUtilities(tieWith(0.05, 0.8), "killing");
    expect(angry.retaliate).toBeGreaterThan(angry.demand);
    expect(angry.retaliate).toBeGreaterThan(angry.forget);
    expect(chooseGrievanceResponse(tieWith(0.9, 0.1), "theft", 0.5)).toBe("forget");
    expect(chooseGrievanceResponse(tieWith(0.05, 0.8), "killing", 0.5)).toBe("retaliate");
  });

  it("la tirada recorre todas las respuestas en orden; la misma tirada, la misma respuesta", () => {
    const tie = tieWith(0.3, 0.3);
    const seen = new Set(
      [0, 0.2, 0.4, 0.6, 0.8, 0.999].map((r) => chooseGrievanceResponse(tie, "assault", r, 10)),
    );
    expect(seen).toEqual(new Set(["demand", "retaliate", "forget"]));
    expect(chooseGrievanceResponse(tie, "assault", 0.37)).toBe(
      chooseGrievanceResponse(tie, "assault", 0.37),
    );
  });
});

describe("la ofensa se cobra (novel4-grievance-act)", () => {
  const tieWith = (fear: number, resentment: number, trust = 0.1): OrgTie => ({
    formal: ["rival"],
    sentiment: { trust, respect: 0.4, fear, resentment },
    believedStrength: { elders: 1, disciples: 3, topStage: 1 },
    grievances: [],
    originEventId: "event:1" as EventId,
    history: ["event:1" as EventId],
  });

  it("repara la que teme; se niega la que guarda rencor y no teme", () => {
    expect(chooseReply(tieWith(0.9, 0.1, 0.5), "killing", 0.5)).toBe("pay");
    expect(chooseReply(tieWith(0.05, 0.9), "theft", 0.5)).toBe("refuse");
  });

  it("reparar enfría a la ofendida y le cuesta cara a la otra; negarse la calienta", () => {
    const ours = tieWith(0.2, 0.5);
    const paid = afterReplyReceived(ours, "assault", "pay");
    expect(paid.sentiment.resentment).toBeCloseTo(0.5 - GRIEVANCE_RESENTMENT.assault);
    expect(paid.sentiment.trust).toBeGreaterThan(ours.sentiment.trust);
    const refused = afterReplyReceived(ours, "assault", "refuse");
    expect(refused.sentiment.resentment).toBeGreaterThan(0.5);
    expect(refused.sentiment.trust).toBeLessThan(ours.sentiment.trust);
    expect(afterReplyGiven(ours).sentiment.resentment).toBeGreaterThan(0.5);
    const avenged = afterAvenged(ours, "killing", "event:9" as EventId);
    expect(avenged.sentiment.resentment).toBeCloseTo(0.5 - GRIEVANCE_RESENTMENT.killing);
    expect(avenged.history).toContain("event:9");
  });

  it("buscados: solo las represalias abiertas, una por ofensor", () => {
    const base = {
      against: "org:2" as EntityRef,
      kind: "theft" as const,
      victim: "agent:3" as AgentId,
      at: 0 as Tick,
    };
    const w = wantedBy({
      entries: [
        {
          ...base,
          deed: "event:4" as EventId,
          by: "agent:1" as AgentId,
          response: { choice: "retaliate", at: 1 as Tick },
        },
        {
          ...base,
          deed: "event:5" as EventId,
          by: "agent:1" as AgentId,
          response: { choice: "retaliate", at: 1 as Tick },
        },
        {
          ...base,
          deed: "event:6" as EventId,
          by: "agent:2" as AgentId,
          response: { choice: "demand", at: 1 as Tick },
        },
        {
          ...base,
          deed: "event:7" as EventId,
          by: "agent:5" as AgentId,
          response: { choice: "retaliate", at: 1 as Tick },
          outcome: { result: "avenged", at: 2 as Tick },
        },
        { ...base, deed: "event:8" as EventId, by: "agent:6" as AgentId },
      ],
    });
    expect([...w.keys()]).toEqual(["agent:1"]);
    expect(w.get("agent:1" as AgentId)?.deed).toBe("event:4");
  });
});

describe("quién lleva la exigencia (novel4-grievance-envoy-mission)", () => {
  const day = 100;
  const e = {
    deed: "event:1" as EventId,
    against: "org:2" as EntityRef,
    kind: "theft" as const,
    by: "agent:1" as AgentId,
    victim: "agent:2" as AgentId,
    at: 0 as Tick,
    response: { choice: "demand" as const, at: 10 as Tick },
  };

  it("sin enviado sale la ranura al terminar la espera; con uno que la lleva, no; vencida, desde el plazo", () => {
    expect(envoySlotReturns(e, day, false)).toBe(10 + (ENVOY_WAIT_DAYS + ENVOY_DAYS) * day);
    expect(envoySlotReturns(e, day, true)).toBeUndefined();
    const lapsed = { ...e, envoy: { who: "agent:9" as AgentId, due: 5000 as Tick } };
    expect(envoySlotReturns(lapsed, day, false)).toBe(5000 + ENVOY_DAYS * day);
    expect(
      envoySlotReturns({ ...e, response: { choice: "retaliate", at: 10 as Tick } }, day, false),
    ).toBeUndefined();
  });

  it("se busca enviado solo durante la espera, si nadie la tomó y sigue abierta", () => {
    expect(envoyWanted(e, 10 as Tick, day)).toBe(true);
    expect(envoyWanted(e, (10 + ENVOY_WAIT_DAYS * day) as Tick, day)).toBe(false);
    expect(
      envoyWanted({ ...e, envoy: { who: "agent:9" as AgentId, due: 99 as Tick } }, 10 as Tick, day),
    ).toBe(false);
    expect(
      envoyWanted({ ...e, outcome: { result: "paid", at: 11 as Tick } }, 12 as Tick, day),
    ).toBe(false);
  });
});
