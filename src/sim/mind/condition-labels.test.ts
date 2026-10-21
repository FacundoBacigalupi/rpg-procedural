import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent, makeId } from "../../core/index.ts";
import {
  believeCondition,
  hides,
  LABELED_KINDS,
  labelFor,
  MENTAL_LABELS,
  stigmaOf,
  treatmentHarm,
  treatmentSupport,
} from "./condition-labels.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const defs = loadContent(
  [MENTAL_LABELS],
  [{ kind: "mental-labels", file: "m.json", data: json("content/mental-labels/human.json") }],
).all(MENTAL_LABELS);
const A = makeId("agent", 1);
const B = makeId("agent", 2);
const ev = makeId("event", 1);

describe("sim.mind.condition-labels", () => {
  it("el contenido cubre cada teoría con todos los tipos", () => {
    const theories = [...new Set(defs.map((d) => d.theory))];
    expect(theories).toContain("plain");
    for (const t of theories)
      for (const k of LABELED_KINDS)
        expect(defs.some((d) => d.theory === t && d.kind === k)).toBe(true);
  });

  it("la misma depresión se nombra distinto según la teoría", () => {
    const spirit = labelFor(defs, "spirit", "depression");
    const weak = labelFor(defs, "weakness", "depression");
    expect(spirit?.treatment).toBe("exorcism");
    expect(weak?.treatment).toBe("confinement");
    expect(spirit?.name).not.toBe(weak?.name);
  });

  it("sin teoría o con una desconocida cae a la llana", () => {
    expect(labelFor(defs, undefined, "grief")?.theory).toBe("plain");
    expect(labelFor(defs, "nope", "grief")?.theory).toBe("plain");
    expect(labelFor([], "spirit", "grief")).toBeUndefined();
  });

  it("la creencia cita la fuente, acota la confianza y es de quien mira", () => {
    const b = believeCondition(defs, "spirit", A, B, { kind: "trauma", severity: 0.6 }, 1.7, ev);
    expect(b).toMatchObject({
      holder: A,
      about: B,
      kind: "trauma",
      label: "spirit.trauma",
      confidence: 1,
    });
    expect(b?.sourceEventId).toBe(ev);
  });

  it("tipos sin etiqueta no producen creencia", () => {
    const c = { kind: "mania", severity: 0.5 } as never;
    expect(believeCondition(defs, "spirit", A, B, c, 0.5, ev)).toBeUndefined();
  });

  it("el trato que ayuda suma apoyo, el que daña alarga la condición y esconde o estigmatiza", () => {
    const care = labelFor(defs, "wounded_heart", "depression");
    const weak = labelFor(defs, "weakness", "depression");
    expect(treatmentSupport(care)).toBeGreaterThan(treatmentSupport(weak));
    expect(treatmentSupport(weak)).toBe(0);
    expect(treatmentHarm(weak)).toBeGreaterThan(1);
    expect(treatmentHarm(care)).toBe(1);
    expect(hides(weak)).toBe(true);
    expect(hides(care)).toBe(false);
    expect(stigmaOf(weak, 0.8)).toBeGreaterThan(stigmaOf(care, 0.8));
    expect(stigmaOf(weak, 0)).toBe(0);
    expect(stigmaOf(undefined, 1)).toBe(0);
  });

  it("es determinista", () => {
    const f = () =>
      believeCondition(defs, "humoral", A, B, { kind: "grief", severity: 0.3 }, 0.5, ev);
    expect(f()).toEqual(f());
  });
});
