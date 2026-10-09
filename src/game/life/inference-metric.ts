// Cuánto se equivoca el razonamiento del personaje (information §10, tooling §6): corre `infer` con
// la evidencia y las reglas que él tiene y compara las conclusiones con la verdad. Solo para la sim
// headless y el inspector: ninguna decisión del mundo lo lee. Las conclusiones que la verdad no
// decide (un veneno, una cerradura forzada) no entran al conteo `checked`.

import {
  BODY_STATE,
  type Fact,
  type InferenceAccuracy,
  type InferenceRuleDef,
  infer,
  inferenceAccuracy,
  LOCATION,
  type ReadonlyWorldTruth,
  TRACE,
  toRule,
} from "../../sim/index.ts";
import { evidenceOf, reasonerOf } from "./think.ts";
import type { LifeWorld } from "./world.ts";

const hexOfPlace = (place: string | undefined): number | undefined => {
  const m = /^hex:(\d+)/u.exec(place ?? "");
  return m === null ? undefined : Number(m[1]);
};

/** Lo que la verdad dice de una conclusión, o `undefined` si no la decide. */
export function factTruth(truth: ReadonlyWorldTruth, f: Fact): boolean | undefined {
  if (f.pred === "cut_by_blade") {
    const body = truth.get(BODY_STATE, f.args[0] as never);
    return body === undefined ? undefined : body.wounds.some((x) => x.kind === "cut");
  }
  if (f.pred === "passed_recently") {
    const who = f.args[0] as never;
    const hex = hexOfPlace(f.args[1]);
    if (hex === undefined) return undefined;
    if (truth.get(LOCATION, who)?.hex === hex) return true;
    return truth.ids(TRACE).some((id) => {
      const t = truth.get(TRACE, id);
      return t !== undefined && t.at.hex === hex && t.by.includes(who);
    });
  }
  return undefined;
}

/** La exactitud de lo que el personaje concluye hoy de lo que tiene delante y en la cabeza. */
export function playerInferenceAccuracy(
  w: LifeWorld,
  defs: readonly InferenceRuleDef[],
): InferenceAccuracy {
  const found = infer(evidenceOf(w), defs.map(toRule), reasonerOf(w, defs));
  return inferenceAccuracy(found, (f) => factTruth(w.truth, f));
}

/** Suma muestras (una por chequeo de la sim) en un solo acumulado. */
export function addAccuracy(a: InferenceAccuracy, b: InferenceAccuracy): InferenceAccuracy {
  return {
    total: a.total + b.total,
    checked: a.checked + b.checked,
    wrong: a.wrong + b.wrong,
    confidentlyWrong: a.confidentlyWrong + b.confidentlyWrong,
  };
}
