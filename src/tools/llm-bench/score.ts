// Cuánto se parece el borrador de un modelo al esperado (narration §1, banco de pruebas). No pide
// igualdad: dos borradores que la sim convierte en el mismo plan valen lo mismo. Se mira por
// campo, para saber en qué falla cada modelo:
// - kind: la clase de intención (`act` y `plan` cuentan igual: la sim los trata igual);
// - steps: la misma secuencia de hojas (verbos, plantillas y la condición de cada `until`);
// - roles: cada hoja con los mismos roles;
// - refs: cada referencia esperada nombrada con sus rasgos (por palabras normalizadas, como
//   `resolveRef`), en el mismo lugar del plan;
// - speech: si se esperaba habla, la hay (y con destinatario si se esperaba);
// - stripped y unmapped: si se esperaba descartar algo o dejar algo sin verbo, se hizo, y al revés.
// - purpose: el mismo motivo declarado (o ninguno, si el jugador no dijo para qué).

import type { DraftArg, DraftPlanNode, IntentDraft, RefDescription } from "../../sim/index.ts";
import { refTokens } from "../../sim/index.ts";

export const SCORE_FIELDS = [
  "kind",
  "steps",
  "roles",
  "refs",
  "speech",
  "stripped",
  "unmapped",
  "purpose",
] as const;
export type ScoreField = (typeof SCORE_FIELDS)[number];

export type DraftScore = Readonly<Record<ScoreField, boolean>> & { readonly pass: boolean };

interface Leaf {
  readonly sig: string;
  readonly args: readonly DraftArg[];
}

function leaves(node: DraftPlanNode | undefined, out: Leaf[] = []): Leaf[] {
  if (!node) return out;
  switch (node.kind) {
    case "do":
      out.push({ sig: node.verb, args: node.args });
      break;
    case "seq":
      for (const s of node.steps) leaves(s, out);
      break;
    case "until":
      out.push({ sig: `until:${node.cond.is?.kind ?? "?"}`, args: [] });
      leaves(node.body, out);
      break;
    case "template":
      out.push({ sig: `template:${node.template}`, args: Object.values(node.params) });
      break;
    default:
      out.push({ sig: node.kind, args: [] });
  }
  return out;
}

function refWords(r: RefDescription): Set<string> {
  const words = [r.text, ...r.features];
  if (r.relation) {
    words.push(r.relation.rel);
    if (r.relation.to !== "self") words.push(...refWords(r.relation.to));
    else words.push("self");
  }
  return new Set(words.flatMap(refTokens));
}

/** Las palabras que tiene que nombrar el modelo: los rasgos (o el texto si no hay) y la relación. */
function wanted(r: RefDescription): string[] {
  const words = r.features.length > 0 ? [...r.features] : [r.text];
  if (r.relation)
    words.push(r.relation.rel, r.relation.to === "self" ? "self" : r.relation.to.text);
  return words.flatMap(refTokens);
}

function refsMatch(want: RefDescription, got: RefDescription | undefined): boolean {
  if (!got) return false;
  const have = refWords(got);
  return wanted(want).every((w) => have.has(w));
}

const isAct = (k: IntentDraft["kind"]) => (k === "plan" ? "act" : k);
const has = (xs: readonly unknown[] | undefined) => (xs?.length ?? 0) > 0;

export function scoreDraft(expected: IntentDraft, got: IntentDraft): DraftScore {
  const want = leaves(expected.plan);
  const have = leaves(got.plan);
  const steps = want.length === have.length && want.every((l, i) => l.sig === have[i]?.sig);
  const roles =
    steps &&
    want.every((l, i) => {
      const a = l.args.map((x) => x.role).sort();
      const b = (have[i]?.args ?? []).map((x) => x.role).sort();
      return a.length === b.length && a.every((r, j) => r === b[j]);
    });
  let refs =
    roles &&
    want.every((l, i) =>
      l.args.every((a) => {
        if (!("ref" in a)) return true;
        const g = have[i]?.args.find((x) => x.role === a.role);
        return g !== undefined && "ref" in g && refsMatch(a.ref, g.ref);
      }),
    );
  let speech = true;
  if (expected.speech) {
    speech = got.speech !== undefined && (!expected.speech.to || got.speech.to !== undefined);
    if (expected.speech.to) refs = refs && refsMatch(expected.speech.to, got.speech?.to);
  }
  const fields: Record<ScoreField, boolean> = {
    kind: isAct(expected.kind) === isAct(got.kind),
    steps,
    roles,
    refs,
    speech,
    stripped: has(expected.stripped) === has(got.stripped),
    unmapped: has(expected.unmapped) === has(got.unmapped),
    // El porqué: el mismo motivo si se esperaba, y ninguno inventado si no se esperaba.
    purpose: expected.purpose?.motive === got.purpose?.motive,
  };
  return { ...fields, pass: SCORE_FIELDS.every((f) => fields[f]) };
}
