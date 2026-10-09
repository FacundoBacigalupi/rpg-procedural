import { describe, expect, it } from "vitest";
import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { BODY_STATE, type Body, LOCATION, TRACE, WorldTruth } from "../../sim/index.ts";
import { addAccuracy, factTruth } from "./inference-metric.ts";

const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;

describe("verdad de las conclusiones del personaje", () => {
  it("«cortado por un filo» se decide por las heridas reales", () => {
    const t = new WorldTruth();
    t.set(BODY_STATE, A, { wounds: [{ kind: "cut" }] } as unknown as Body);
    t.set(BODY_STATE, B, { wounds: [{ kind: "blunt" }] } as unknown as Body);
    expect(factTruth(t, { pred: "cut_by_blade", args: [A] })).toBe(true);
    expect(factTruth(t, { pred: "cut_by_blade", args: [B] })).toBe(false);
    expect(factTruth(t, { pred: "cut_by_blade", args: ["agent:9"] })).toBeUndefined();
  });

  it("«pasó por acá» es cierto si está o si una huella suya lo prueba", () => {
    const t = new WorldTruth();
    t.set(LOCATION, A, { hex: 4 });
    t.set(TRACE, "trace:1" as never, {
      kind: "blood",
      at: { hex: 7 },
      made: 0 as Tick,
      by: [B],
      event: "event:1" as EventId,
      strength: 1,
    });
    t.set(LOCATION, B, { hex: 9 });
    expect(factTruth(t, { pred: "passed_recently", args: [A, "hex:4"] })).toBe(true);
    expect(factTruth(t, { pred: "passed_recently", args: [B, "hex:7"] })).toBe(true);
    expect(factTruth(t, { pred: "passed_recently", args: [A, "hex:7"] })).toBe(false);
  });

  it("lo que la verdad no decide queda fuera", () => {
    expect(
      factTruth(new WorldTruth(), { pred: "picked_lock", args: [A, "hex:1"] }),
    ).toBeUndefined();
  });

  it("suma muestras", () => {
    const s = addAccuracy(
      { total: 2, checked: 1, wrong: 1, confidentlyWrong: 0 },
      { total: 1, checked: 1, wrong: 0, confidentlyWrong: 0 },
    );
    expect(s).toEqual({ total: 3, checked: 2, wrong: 1, confidentlyWrong: 0 });
  });
});
