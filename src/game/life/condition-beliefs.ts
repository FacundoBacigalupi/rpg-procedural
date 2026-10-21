// Lo que cada uno cree del mal ajeno (npc-psychology §11, `psy-conditions-beliefs`): una vez al día,
// el que lleva una condición con etiqueta (duelo, depresión, trauma, adicción, culpa) y los de su
// casa la creen cada uno con su teoría de la mente (`mind.theory`): el mismo mal es «duelo» para uno,
// «posesión» para otro y «debilidad» para un tercero. La creencia entra a `BELIEFS` como el atributo
// `condition` (valor: el id de la etiqueta), citando el evento que abrió la condición. No lee la
// condición de afuera: los de afuera no la ven (el estigma y el encierro van con `psy-conditions-stigma`).

import { type AgentId, compareStrings } from "../../core/index.ts";
import {
  BELIEFS,
  type Beliefs,
  believeCondition,
  conditionEvidence,
  ENTITY,
  learn,
  MENTAL,
  type MentalLabelDef,
  PERSON,
  PERSON_CULTURE,
  type ProcessDef,
  type StateChange,
  setComponent,
  visibleCondition,
} from "../../sim/index.ts";
import { mindTheoryOf } from "./support.ts";

export const CONDITION_BELIEFS_PROCESS = "life.condition_beliefs";

/** Confianza de quien lo sufre sobre su propio mal: lo siente, aunque lo nombre mal. */
export const SELF_CONDITION_CONFIDENCE = 0.9;
/** Confianza base de los de la casa y lo que suma la gravedad (se nota más cuanto peor está). */
export const HOUSEHOLD_CONDITION_BASE = 0.3;
export const HOUSEHOLD_CONDITION_SPAN = 0.6;

export interface ConditionBeliefsOptions {
  readonly mentalLabels: readonly MentalLabelDef[];
}

/** Proceso opt-in (`conditionLabels`): vuelca la etiqueta de cada condición a `BELIEFS` de la casa. */
export function conditionBeliefsProcess(o: ConditionBeliefsOptions): ProcessDef {
  return {
    id: CONDITION_BELIEFS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    // Fuera de `perceive`: ahí `life.knowing` escribe los mismos libros cada hora y chocarían.
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, MENTAL.name, BELIEFS.name, PERSON_CULTURE.name],
    writes: [BELIEFS.name],
    run(ctx) {
      // Una pasada por día de mundo: reforzar cada hora llevaría la confianza al tope sin evidencia nueva.
      if (Math.floor(ctx.now / 3_600) % 24 !== 0) return {};
      const truth = ctx.truth;
      const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
      const people = (truth.ids(PERSON) as AgentId[]).sort(compareStrings).filter(alive);
      const staged = new Map<AgentId, Beliefs | undefined>();
      for (const sick of people) {
        const mental = truth.get(MENTAL, sick);
        const worst = mental ? visibleCondition(mental.conditions) : undefined;
        if (!mental || !worst) continue;
        const home = truth.get(PERSON, sick)?.household;
        const holders =
          home === undefined
            ? [sick]
            : people.filter((id) => id === sick || truth.get(PERSON, id)?.household === home);
        const source = worst.originEventIds[0] ?? mental.originEventId;
        for (const holder of holders) {
          const confidence =
            holder === sick
              ? SELF_CONDITION_CONFIDENCE
              : HOUSEHOLD_CONDITION_BASE + HOUSEHOLD_CONDITION_SPAN * worst.severity;
          const belief = believeCondition(
            o.mentalLabels,
            mindTheoryOf(truth, holder),
            holder,
            sick,
            worst,
            confidence,
            source,
          );
          if (!belief) continue;
          const before = staged.has(holder) ? staged.get(holder) : truth.get(BELIEFS, holder);
          staged.set(holder, learn(before, conditionEvidence(belief, ctx.now), ctx.now));
        }
      }
      const changes: StateChange[] = [...staged.keys()].sort(compareStrings).flatMap((id) => {
        const b = staged.get(id);
        return b === undefined ? [] : [setComponent(BELIEFS, id, b)];
      });
      return changes.length === 0 ? {} : { changes };
    },
  };
}
