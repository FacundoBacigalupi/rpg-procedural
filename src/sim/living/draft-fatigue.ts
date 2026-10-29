// El cansancio del tiro (livestock-draft-fatigue): cada hora de campo con el buey suma a sus horas
// del día (`DRAFT_FATIGUE.hours`, con `addToField` desde la rutina de la gente, que conmuta entre los
// del mismo hogar); una vez por día, lo que pasó de `fatigue.hoursPerDay` sube su cansancio y el
// descanso lo baja (`draftFatigueStep`), y las horas vuelven a cero. El cansado rinde menos al día
// siguiente y, pasadas `fatigue.maxHoursPerDay` en el día, no tira más (lo mira `draftFor`).

import type { AnimalId, Duration } from "../../core/index.ts";
import {
  deleteComponent,
  type ProcessDef,
  type StateChange,
  setComponent,
} from "../scheduler/index.ts";
import { ENTITY, table } from "../world/index.ts";
import { ANIMAL, type DraftDef, type LivestockDef } from "./livestock.ts";

export const DRAFT_FATIGUE_PROCESS = "living.draft_fatigue";

/** Las horas de tiro del día y el cansancio (0-1) de un animal de tiro; sin fila, descansado. */
export interface DraftFatigue {
  /** Horas de campo tirando desde el último paso diario. */
  readonly hours: number;
  /** De 0 (descansado) a 1 (no da más). */
  readonly level: number;
}

export const DRAFT_FATIGUE = table<DraftFatigue>("living.draft_fatigue");

/**
 * Pura: el cansancio tras un día con `hours` horas de tiro: el de ayer baja con el descanso
 * (`recoveryPerDay`) y se acerca, a ese mismo ritmo, a lo que pasó de `hoursPerDay` (en partes de
 * `hoursPerDay`, hasta 1). Sin `fatigue`, 0.
 */
export function draftFatigueStep(level: number, hours: number, def: DraftDef): number {
  const f = def.fatigue;
  if (!f) return 0;
  const over = Math.min(1, Math.max(0, hours - f.hoursPerDay) / f.hoursPerDay);
  return Math.min(1, Math.max(0, level * (1 - f.recoveryPerDay) + f.recoveryPerDay * over));
}

/**
 * Pura: qué parte de su tiro da un animal con `row` (cansancio y horas del día). Con `rest`
 * (livestock-draft-rest), el que ya está cansado (`restAbove`) descansa al llegar a `hoursPerDay`:
 * la casa pierde su tiro hoy para no cansarlo más. `restAbove` cambia el umbral de la especie por el
 * de quien lo trabaja (livestock-draft-rest-choice, `draftRestThreshold`).
 */
export function draftFatigueFactor(
  def: DraftDef,
  row: DraftFatigue | undefined,
  rest = false,
  restAbove?: number,
): number {
  const f = def.fatigue;
  if (!f || !row) return 1;
  if (row.hours >= f.maxHoursPerDay) return 0;
  const above = f.restAbove === undefined ? undefined : (restAbove ?? f.restAbove);
  if (rest && above !== undefined && row.level >= above && row.hours >= f.hoursPerDay) {
    return 0;
  }
  return 1 - row.level;
}

/** Cuánto baja el umbral de descanso por unidad de calidez de quien trabaja al animal. */
export const REST_WARMTH_SHIFT = 0.25;
/** Cuánto sube el umbral de descanso con el apuro máximo de la casa (livestock-draft-rest-press). */
export const REST_PRESS_SHIFT = 0.4;

/**
 * Pura (livestock-draft-rest-choice): desde qué cansancio descansa al animal quien lo trabaja: el
 * `restAbove` de la especie, más bajo para el cálido (le duele verlo así) y más alto para el frío
 * (lo sigue arreando), entre 0.05 y 0.95. `press` (0-1, livestock-draft-rest-press) es el apuro de
 * la casa: lo sube hasta `REST_PRESS_SHIFT`. Sin `restAbove`, nada.
 */
export function draftRestThreshold(def: DraftDef, warmth: number, press = 0): number | undefined {
  const base = def.fatigue?.restAbove;
  if (base === undefined) return undefined;
  const pressed = REST_PRESS_SHIFT * Math.min(1, Math.max(0, press));
  return Math.min(0.95, Math.max(0.05, base - REST_WARMTH_SHIFT * warmth + pressed));
}

export interface DraftFatigueOptions {
  readonly species: readonly LivestockDef[];
  /** Duración del año (ticks), para la edad. */
  readonly year: Duration;
}

/**
 * Cada día: para cada animal vivo de tiro en edad (`draft.fatigue`), el cansancio nuevo sale de las
 * horas del día y las horas vuelven a cero (la fila existe siempre, para que la rutina sume); la
 * fila del que murió se borra. Fase `settle`: la rutina suma en `act`.
 */
export function draftFatigueProcess(o: DraftFatigueOptions): ProcessDef {
  const byId = new Map(
    o.species.flatMap((s) => (s.draft?.fatigue === undefined ? [] : [[s.id, s.draft] as const])),
  );
  return {
    id: DRAFT_FATIGUE_PROCESS,
    system: "living",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [ANIMAL.name, ENTITY.name, DRAFT_FATIGUE.name],
    writes: [DRAFT_FATIGUE.name],
    scopeGuard: (truth) => byId.size > 0 && truth.ids(ANIMAL).length > 0,
    run(ctx) {
      const changes: StateChange[] = [];
      for (const id of [...ctx.truth.ids(DRAFT_FATIGUE)].sort() as AnimalId[]) {
        if (ctx.truth.get(ENTITY, id)?.endedAt !== undefined) {
          changes.push(deleteComponent(DRAFT_FATIGUE, id));
        }
      }
      for (const id of [...ctx.truth.ids(ANIMAL)].sort() as AnimalId[]) {
        const a = ctx.truth.get(ANIMAL, id);
        const def = a ? byId.get(a.species) : undefined;
        if (!a || !def || ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        if ((ctx.now - a.bornAt) / o.year < def.minAgeYears) continue;
        const row = ctx.truth.get(DRAFT_FATIGUE, id);
        const level = draftFatigueStep(row?.level ?? 0, row?.hours ?? 0, def);
        if (row && row.hours === 0 && row.level === level) continue;
        changes.push(setComponent(DRAFT_FATIGUE, id, { hours: 0, level }));
      }
      return changes.length > 0 ? { changes } : {};
    },
  };
}
