// Lo que cada uno cree del mal ajeno (npc-psychology §11, `psy-conditions-beliefs`): una vez al día,
// el que lleva una condición con etiqueta (duelo, depresión, trauma, adicción, culpa) y los de su
// casa la creen cada uno con su teoría de la mente (`mind.theory`): el mismo mal es «duelo» para uno,
// «posesión» para otro y «debilidad» para un tercero. La creencia entra a `BELIEFS` como el atributo
// `condition` (valor: el id de la etiqueta), citando el evento que abrió la condición. No lee la
// condición de afuera: los de afuera no la ven. Con `stigma` (`psy-conditions-stigma`) los conocidos de
// afuera sí la ven (con su propia teoría, menos segura que la de la casa) y le ponen estigma a su
// reputación (`STIGMA`), salvo que la familia lo esconda (`hides`: encierro): entonces nadie de afuera
// forma la creencia ni el estigma. Lo que ya no se ve se va olvidando de a poco.

import { type AgentId, compareStrings } from "../../core/index.ts";
import {
  BELIEFS,
  type Beliefs,
  believeCondition,
  conditionEvidence,
  deleteComponent,
  ENTITY,
  familyHides,
  type LabeledKind,
  learn,
  MENTAL,
  type MentalLabelDef,
  PERSON,
  PERSON_CULTURE,
  type ProcessDef,
  RELATIONS,
  STIGMA,
  type StateChange,
  setComponent,
  stepStigma,
  stigmaFrom,
  visibleCondition,
} from "../../sim/index.ts";
import { mindTheoryOf } from "./support.ts";

export const CONDITION_BELIEFS_PROCESS = "life.condition_beliefs";

/** Confianza de quien lo sufre sobre su propio mal: lo siente, aunque lo nombre mal. */
export const SELF_CONDITION_CONFIDENCE = 0.9;
/** Confianza base de los de la casa y lo que suma la gravedad (se nota más cuanto peor está). */
export const HOUSEHOLD_CONDITION_BASE = 0.3;
export const HOUSEHOLD_CONDITION_SPAN = 0.6;

/** Confianza de un conocido de afuera sobre el mal ajeno: lo ve de lejos (base) y más cuanto peor está. */
export const OUTSIDER_CONDITION_BASE = 0.1;
export const OUTSIDER_CONDITION_SPAN = 0.5;

export interface ConditionBeliefsOptions {
  readonly mentalLabels: readonly MentalLabelDef[];
  /** `psy-conditions-stigma`: los conocidos de afuera la creen y le ponen estigma, salvo que la familia esconda. */
  readonly stigma?: boolean;
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
    reads: [
      PERSON.name,
      ENTITY.name,
      MENTAL.name,
      BELIEFS.name,
      PERSON_CULTURE.name,
      ...(o.stigma ? [RELATIONS.name, STIGMA.name] : []),
    ],
    writes: o.stigma ? [BELIEFS.name, STIGMA.name] : [BELIEFS.name],
    run(ctx) {
      // Una pasada por día de mundo: reforzar cada hora llevaría la confianza al tope sin evidencia nueva.
      if (Math.floor(ctx.now / 3_600) % 24 !== 0) return {};
      const truth = ctx.truth;
      const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
      const people = (truth.ids(PERSON) as AgentId[]).sort(compareStrings).filter(alive);
      const staged = new Map<AgentId, Beliefs | undefined>();
      const stigmaChanges: StateChange[] = [];
      for (const sick of people) {
        const mental = truth.get(MENTAL, sick);
        const worst = mental ? visibleCondition(mental.conditions) : undefined;
        if (o.stigma && (!mental || !worst)) {
          // Ya no se ve nada: el estigma que quedaba se va olvidando.
          const prev = truth.get(STIGMA, sick);
          const next = prev ? stepStigma(prev, {}, prev.originEventId) : undefined;
          if (prev) {
            stigmaChanges.push(
              next ? setComponent(STIGMA, sick, next) : deleteComponent(STIGMA, sick),
            );
          }
        }
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
        if (!o.stigma) continue;
        const kin = holders.filter((id) => id !== sick);
        const hidden =
          kin.length > 0 &&
          familyHides(
            o.mentalLabels,
            kin.map((id) => mindTheoryOf(truth, id)),
            worst.kind as LabeledKind,
          );
        const fresh: Record<string, number> = {};
        if (!hidden) {
          for (const outsider of people) {
            if (holders.includes(outsider)) continue;
            // Solo lo ve quien lo conoce (tiene relación con él).
            if (truth.get(RELATIONS, outsider)?.toward[sick] === undefined) continue;
            const theory = mindTheoryOf(truth, outsider);
            const belief = believeCondition(
              o.mentalLabels,
              theory,
              outsider,
              sick,
              worst,
              OUTSIDER_CONDITION_BASE + OUTSIDER_CONDITION_SPAN * worst.severity,
              source,
            );
            if (!belief) continue;
            const before = staged.has(outsider)
              ? staged.get(outsider)
              : truth.get(BELIEFS, outsider);
            staged.set(outsider, learn(before, conditionEvidence(belief, ctx.now), ctx.now));
            fresh[outsider] = stigmaFrom(o.mentalLabels, theory, worst);
          }
        }
        const next = stepStigma(truth.get(STIGMA, sick), fresh, source);
        const had = truth.get(STIGMA, sick);
        if (next) stigmaChanges.push(setComponent(STIGMA, sick, next));
        else if (had) stigmaChanges.push(deleteComponent(STIGMA, sick));
      }
      const changes: StateChange[] = [...staged.keys()].sort(compareStrings).flatMap((id) => {
        const b = staged.get(id);
        return b === undefined ? [] : [setComponent(BELIEFS, id, b)];
      });
      changes.push(...stigmaChanges);
      return changes.length === 0 ? {} : { changes };
    },
  };
}
