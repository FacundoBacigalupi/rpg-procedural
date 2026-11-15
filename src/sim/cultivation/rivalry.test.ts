// La rivalidad entre sectas (novel4-rival-sect-relation): la fuerza creída con error acotado y el
// sentimiento de rival, puros y deterministas.

import { describe, expect, it } from "vitest";
import { type EventId, Rng } from "../../core/index.ts";
import type { OrgTie } from "../org/index.ts";
import {
  addGrievance,
  afterSectDuel,
  BELIEF_ERROR,
  chooseGrievanceResponse,
  GRIEVANCE_RESENTMENT,
  grievanceUtilities,
  rivalSentiment,
  seededBelief,
  strengthScore,
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
