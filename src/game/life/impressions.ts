// Impresiones de quien se ve (player-loop §9, information §1): la figura, la ropa y lo que hacía
// se guardan como creencias de texto (`figure`, `attire`, `action`) y no se leen de nuevo de la
// verdad. Puro: convierte un percept en evidencia y las creencias de vuelta en campos de percept.

import type { AgentId, Tick } from "../../core/index.ts";
import {
  type Beliefs,
  beliefConfidenceAt,
  believed,
  type Evidence,
  type Figure,
  type Percept,
  type PerceptField,
} from "../../sim/index.ts";

/** La figura como texto (`sexo:franja`), que es lo que se guarda en la creencia. */
export function figureText(f: Figure): string {
  return `${f.sex}:${f.age}`;
}

export function parseFigure(text: string): Figure | undefined {
  const [sex, age] = text.split(":");
  if ((sex !== "female" && sex !== "male") || age === undefined) return undefined;
  if (age !== "child" && age !== "youth" && age !== "adult" && age !== "elder") return undefined;
  return { sex, age };
}

/** Confianza mínima (envejecida) para que una impresión guardada pese en la vista. */
export const IMPRESSION_CONFIDENCE = 0.1;

/**
 * Lo que el percept enseña de `subject` sobre su figura, su ropa y lo que hace, como evidencia con
 * la confianza con que se leyó cada campo. No mira la identidad: quien llama ya sabe de quién es.
 */
export function impressionEvidence(subject: AgentId, p: Percept): Evidence[] {
  const source = { kind: "percept", percept: p.id, tick: p.tick } as const;
  const out: Evidence[] = [];
  const add = (
    attr: "figure" | "attire" | "action",
    field: PerceptField | undefined,
    v?: string,
  ) => {
    if (field === undefined || v === undefined) return;
    out.push({
      prop: { kind: "attr", subject, attr },
      value: v,
      confidence: field.confidence,
      asOf: p.tick,
      source,
    });
  };
  const fig = p.fields.figure;
  if (fig !== undefined) add("figure", fig, figureText(fig.value as Figure));
  const attire = p.fields.attire;
  if (attire !== undefined && typeof attire.value === "string") add("attire", attire, attire.value);
  const action = p.fields.action;
  if (action !== undefined && typeof action.value === "string") add("action", action, action.value);
  return out;
}

/**
 * El percept de alguien reconocido, con la figura y la ropa de lo que el personaje cree haber
 * visto (no de la verdad del momento). Si no guardó nada de eso, queda la lectura directa.
 */
export function withImpressions(
  p: Percept,
  subject: AgentId,
  beliefs: Beliefs | undefined,
  now: Tick,
): Percept {
  const fields = { ...p.fields };
  const fig = believed(beliefs, subject, "figure");
  if (fig !== undefined && typeof fig.value === "string") {
    const c = beliefConfidenceAt(fig, now);
    const parsed = parseFigure(fig.value);
    if (parsed !== undefined && c >= IMPRESSION_CONFIDENCE) {
      fields.figure = { value: parsed, confidence: c, mistaken: false };
    }
  }
  const attire = believed(beliefs, subject, "attire");
  if (attire !== undefined && typeof attire.value === "string") {
    const c = beliefConfidenceAt(attire, now);
    if (c >= IMPRESSION_CONFIDENCE) {
      fields.attire = { value: attire.value, confidence: c, mistaken: false };
    }
  }
  return { ...p, fields };
}
