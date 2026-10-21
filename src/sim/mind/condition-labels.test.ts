import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent, makeId } from "../../core/index.ts";
import { believed, learn } from "../knowledge/index.ts";
import {
  believeCondition,
  conditionEvidence,
  visibleCondition,
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

  it("la evidencia entra al libro como `condition` con el id de la etiqueta y cita el evento", () => {
    const b = believeCondition(defs, "spirit", A, B, { kind: "trauma", severity: 0.6 }, 0.7, ev);
    if (!b) throw new Error("sin creencia");
    const learned = learn(undefined, conditionEvidence(b, 1000), 1000);
    const held = believed(learned, B, "condition");
    expect(held?.value).toBe("spirit.trauma");
    expect(held?.confidence).toBe(0.7);
    expect(held?.sources[0]).toMatchObject({ kind: "percept", event: ev });
  });

  it("una etiqueta ajena y débil no pisa una creencia más firme", () => {
    const a = believeCondition(defs, "spirit", A, B, { kind: "trauma", severity: 0.6 }, 0.9, ev);
    const w = believeCondition(defs, "weakness", A, B, { kind: "trauma", severity: 0.6 }, 0.2, ev);
    if (!a || !w) throw new Error("sin creencia");
    const first = learn(undefined, conditionEvidence(a, 10), 10);
    const second = learn(first, conditionEvidence(w, 20), 20);
    expect(believed(second, B, "condition")?.value).toBe("spirit.trauma");
  });

  it("visibleCondition elige la más grave con etiqueta", () => {
    const cs = [
      { kind: "mania", severity: 0.99 },
      { kind: "guilt", severity: 0.2 },
      { kind: "grief", severity: 0.5 },
    ];
    expect(visibleCondition(cs)?.kind).toBe("grief");
    expect(visibleCondition([{ kind: "mania", severity: 1 }])).toBeUndefined();
  });
});
