import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import { faceLoss, respondToOffense } from "../social/index.ts";
import { insultOffense, judgeFlattery, registerOffense } from "./regard.ts";
import {
  believedLevel,
  type ThreatInput,
  threatAftermath,
  threatCredibility,
  threatFaceDelta,
  threatFear,
  weighThreat,
} from "./threats.ts";

const base: ThreatInput = {
  credibility: 0.9,
  harm: 0.9,
  demandCost: 0.2,
  courage: 0.2,
  pride: 0.3,
  witnesses: 0,
  selfConfidence: 0.2,
  escape: 0.1,
  help: 0,
  recourse: 0,
};

describe("credibilidad de una amenaza", () => {
  it("sin confianza una creencia vale lo mismo que no saber", () => {
    expect(believedLevel({ level: 1, confidence: 0 })).toBe(0.5);
    expect(believedLevel(undefined)).toBe(0.5);
    expect(believedLevel({ level: 1, confidence: 1 })).toBe(1);
  });

  it("es capacidad creida por disposicion creida", () => {
    const sure = { level: 1, confidence: 1 };
    expect(threatCredibility({ capability: sure, disposition: sure })).toBe(1);
    expect(
      threatCredibility({ capability: sure, disposition: { level: 0.2, confidence: 1 } }),
    ).toBeCloseTo(0.2);
  });

  it("una demostracion sube la capacidad creida", () => {
    const c = { level: 0.3, confidence: 1 };
    const d = { level: 1, confidence: 1 };
    expect(threatCredibility({ capability: c, disposition: d, shown: 1 })).toBeGreaterThan(
      threatCredibility({ capability: c, disposition: d }),
    );
  });
});

describe("respuesta del amenazado", () => {
  it("el timido ante una amenaza creible cede", () => {
    const v = weighThreat(base, Rng.root(1));
    expect(v.response).toBe("yield");
  });

  it("el farol se desafia", () => {
    const v = weighThreat(
      { ...base, credibility: 0.05, courage: 0.8, selfConfidence: 0.7 },
      Rng.root(2),
    );
    expect(v.response).toBe("defy");
  });

  it("con salida y distancia huye en vez de ceder si ceder cuesta mucho", () => {
    const v = weighThreat({ ...base, demandCost: 1, escape: 1 }, Rng.root(3));
    expect(v.response).toBe("flee");
  });

  it("con autoridad creida denuncia", () => {
    const v = weighThreat(
      { ...base, demandCost: 1, escape: 0, recourse: 1, harm: 0.7 },
      Rng.root(4),
    );
    expect(["denounce", "yield"]).toContain(v.response);
  });

  it("la valentia baja el miedo", () => {
    expect(threatFear({ credibility: 1, harm: 1, courage: 1 })).toBeLessThan(
      threatFear({ credibility: 1, harm: 1, courage: 0 }),
    );
  });

  it("es determinista y el miedo queda en 0-1", () => {
    fc.assert(
      fc.property(fc.nat(), fc.double({ min: 0, max: 1, noNaN: true }), (seed, x) => {
        const i = { ...base, credibility: x, courage: 1 - x };
        const a = weighThreat(i, Rng.root(seed));
        const b = weighThreat(i, Rng.root(seed));
        expect(a).toEqual(b);
        expect(a.fear).toBeGreaterThanOrEqual(0);
        expect(a.fear).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("lo que deja la amenaza", () => {
  it("ceder en publico cuesta cara y deja rencor y menos confianza", () => {
    const i = { pride: 0.9, witnesses: 3, demandCost: 0.5 };
    const v = weighThreat({ ...base, ...i }, Rng.root(5));
    const a = threatAftermath({ ...v, response: "yield" }, i, 0.8);
    expect(a.targetFaceLoss).toBeGreaterThan(0);
    expect(a.trustDelta).toBeLessThan(0);
    expect(a.resentmentDelta).toBeGreaterThan(0);
    expect(a.vengeful).toBe(true);
  });

  it("desafiar no cuesta cara", () => {
    const i = { pride: 0.9, witnesses: 3, demandCost: 0.5 };
    const v = weighThreat(base, Rng.root(6));
    expect(threatAftermath({ ...v, response: "defy" }, i, 0.5).targetFaceLoss).toBe(0);
  });

  it("el que no cumple ante testigos pierde cara, mas cuantos mas", () => {
    expect(threatFaceDelta("backed_down", 4, 1)).toBeLessThan(threatFaceDelta("backed_down", 0, 1));
    expect(threatFaceDelta("backed_down", 2, 1)).toBeLessThan(0);
    expect(threatFaceDelta("obeyed", 2, 1)).toBeGreaterThan(0);
    expect(threatFaceDelta("carried_out", 2, 1)).toBe(0);
  });
});

describe("halagos, insultos y registro", () => {
  const flat = {
    vanity: 0.8,
    excess: 0.2,
    insight: 0.2,
    trust: 0.5,
    motiveKnown: false,
    recent: 0,
  };

  it("el vanidoso se complace con un halago creible", () => {
    const r = judgeFlattery(flat);
    expect(r.kind).toBe("pleased");
    expect(r.warmthDelta).toBeGreaterThan(0);
  });

  it("adular de mas a un perspicaz baja la confianza", () => {
    const r = judgeFlattery({ ...flat, excess: 1, insight: 1, trust: 0 });
    expect(r.kind).toBe("hollow");
    expect(r.trustDelta).toBeLessThan(0);
  });

  it("el humilde no se mueve y el repetido se desgasta", () => {
    expect(judgeFlattery({ ...flat, vanity: 0 }).kind).toBe("flat");
    expect(judgeFlattery({ ...flat, recent: 4 }).warmthDelta).toBeLessThan(
      judgeFlattery(flat).warmthDelta,
    );
  });

  it("el insulto pesa mas con testigos, con verdad y viniendo de abajo", () => {
    const a = insultOffense({ sting: 0.4, truth: 0, gap: 0, witnesses: 0 });
    const b = insultOffense({ sting: 0.4, truth: 1, gap: 2, witnesses: 3 });
    expect(b.size).toBeGreaterThan(a.size);
    expect(faceLoss(b)).toBeGreaterThan(faceLoss(a));
    expect(
      respondToOffense(b, { offendedRank: 3, believedActorRank: 1, face: 0.2, magnanimity: 0 }),
    ).toBe("punish");
  });

  it("el registro equivocado: quedarse corto ofende mas que pasarse", () => {
    const slip = (direction: "too-casual" | "too-formal") => ({
      direction,
      size: 0.5,
      demanded: 0.8,
      used: 0.2,
    });
    const casual = registerOffense({ slip: slip("too-casual"), gap: 2, witnesses: 2 });
    const formal = registerOffense({ slip: slip("too-formal"), gap: 2, witnesses: 2 });
    expect(casual.size).toBeGreaterThan(formal.size);
    expect(registerOffense({ slip: slip("too-casual"), gap: 0, witnesses: 0 }).size).toBeLessThan(
      casual.size,
    );
  });
});
