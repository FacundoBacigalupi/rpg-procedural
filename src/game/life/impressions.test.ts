import { describe, expect, it } from "vitest";
import type { AgentId, Tick } from "../../core/index.ts";
import { type Beliefs, learn, type Percept } from "../../sim/index.ts";
import { figureText, impressionEvidence, parseFigure, withImpressions } from "./impressions.ts";

const WHO = "agent:7" as AgentId;
const percept = (tick: number, attire: string): Percept => ({
  id: `p@${tick}`,
  observer: "agent:1" as AgentId,
  tick: tick as Tick,
  channels: ["sight"],
  detail: "identified",
  fields: {
    figure: { value: { sex: "female", age: "adult" }, confidence: 0.8, mistaken: false },
    attire: { value: attire, confidence: 0.7, mistaken: false },
    action: { value: "action.chop", confidence: 0.6, mistaken: false },
    identity: { value: WHO, confidence: 0.9, mistaken: false },
  },
});

describe("impresiones", () => {
  it("la figura va y vuelve como texto", () => {
    const f = { sex: "male", age: "elder" } as const;
    expect(parseFigure(figureText(f))).toEqual(f);
    expect(parseFigure("nada")).toBeUndefined();
  });

  it("un percept da evidencia de figura, ropa y acción con la confianza de cada campo", () => {
    const ev = impressionEvidence(WHO, percept(10, "plain"));
    expect(ev.map((e) => e.prop.attr)).toEqual(["figure", "attire", "action"]);
    expect(ev.map((e) => e.confidence)).toEqual([0.8, 0.7, 0.6]);
  });

  it("la vista lee la ropa creída y no la del momento", () => {
    let b: Beliefs | undefined;
    for (const e of impressionEvidence(WHO, percept(10, "plain"))) b = learn(b, e, 10);
    const now = percept(100, "silk");
    const out = withImpressions(now, WHO, b, 100 as Tick);
    expect(out.fields.attire?.value).toBe("plain");
    expect(out.fields.figure?.value).toEqual({ sex: "female", age: "adult" });
    // sin impresión guardada queda la lectura directa
    expect(withImpressions(now, WHO, undefined, 100 as Tick).fields.attire?.value).toBe("silk");
  });
});
