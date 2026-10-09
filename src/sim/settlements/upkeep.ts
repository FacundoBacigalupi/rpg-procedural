// Deterioro y mantenimiento de los edificios (settlements §7), puro: cuánto se gasta un componente
// en un tramo según su material, el clima, el uso y sus defectos; cuándo vale la pena repararlo y
// cuánta materia se cambia; en qué estado queda la puerta y qué barrera hacen puerta y paredes. El
// proceso que lo aplica a la aldea está en `game/life/upkeep.ts`.

import { exp } from "../../core/index.ts";
import type { Barrier } from "../world/index.ts";
import type { MaterialDef } from "./defs.ts";
import type { BuildingComponent } from "./tables.ts";

/** Una puerta abierta (vano), cerrada, o trabada (hinchada o torcida: no cede sin arreglo). */
export const DOOR_STATES = ["open", "closed", "jammed"] as const;
export type DoorState = (typeof DOOR_STATES)[number];

/** La barrera que hace una puerta en cada estado (perception §3). */
export function doorBarrier(state: DoorState): Barrier {
  return state === "open" ? "doorway" : "door_closed";
}

/** El estado en que una puerta descansa cuando nadie la toca: las casas abiertas, lo comunal cerrado. */
export function restingDoor(household: boolean): DoorState {
  return household ? "open" : "closed";
}

/** Lo que el día le hace a un edificio desde afuera. */
export interface Exposure {
  readonly rainMm: number;
  readonly frost: boolean;
  readonly windMs: number;
}

/** Cuánto pesa cada agente de desgaste sobre cada parte (calibración abierta, settlements §Preguntas). */
const RAIN_PER_MM = { roof: 0.12, walls: 0.04, foundation: 0.02, door: 0.05 } as const;
const FROST_EXTRA = { roof: 0.3, walls: 0.5, foundation: 0.6, door: 0.1 } as const;
const WIND_PER_MS = { roof: 0.04, walls: 0.01, foundation: 0, door: 0.02 } as const;
/** Techo del multiplicador por clima: una tormenta enorme no gasta un año en un día. */
const MAX_WEATHER_MULT = 6;

/** Cuántas veces el desgaste base (el del material) pesa hoy sobre esta parte. */
export function wearMultiplier(
  part: BuildingComponent["part"],
  exposure: Exposure,
  use: number,
  defects: BuildingComponent["defects"],
): number {
  const weather =
    1 +
    exposure.rainMm * RAIN_PER_MM[part] +
    (exposure.frost ? FROST_EXTRA[part] : 0) +
    Math.max(0, exposure.windMs - 5) * WIND_PER_MS[part];
  // El uso gasta sobre todo la puerta (se abre y se cierra) y el piso/cimiento un poco.
  const used = 1 + Math.min(1, Math.max(0, use)) * (part === "door" ? 1.5 : 0.25);
  const hidden = 1 + defects.reduce((s, d) => s + d.severity, 0);
  return Math.min(MAX_WEATHER_MULT, weather) * used * hidden;
}

/**
 * La condición de un componente tras `days` días. Con clima parejo y sin uso es la misma curva
 * exponencial que usó la sembradora (`decayPerYear` del material por año de 365 días).
 */
export function wornCondition(
  component: BuildingComponent,
  material: MaterialDef,
  days: number,
  exposure: Exposure,
  use: number,
): number {
  const mult = wearMultiplier(component.part, exposure, use, component.defects);
  const next = component.condition * exp((-material.decayPerYear * mult * days) / 365);
  return Math.round(next * 100000) / 100000;
}

/** Por debajo de esta condición un componente pide arreglo (un techo antes que una pared). */
export const REPAIR_BELOW: Readonly<Record<BuildingComponent["part"], number>> = {
  roof: 0.6,
  door: 0.5,
  walls: 0.45,
  foundation: 0.35,
};

/** Los componentes que piden arreglo, el más gastado primero (el desempate es el orden de las partes). */
export function needsRepair(components: readonly BuildingComponent[]): BuildingComponent[] {
  return components
    .filter((c) => c.condition < REPAIR_BELOW[c.part])
    .sort((a, b) => a.condition - b.condition || (a.part < b.part ? -1 : a.part > b.part ? 1 : 0));
}

/** Qué parte del componente se cambia al repararlo, según cuánto se gastó y el oficio de quien repara. */
export function replacedShare(condition: number, skill: number): number {
  const worn = 1 - condition;
  return Math.min(1, Math.max(0, worn * (0.6 + 0.35 * Math.min(1, Math.max(0, skill)))));
}

/** La condición después de reparar: lo cambiado queda nuevo (1), el resto como estaba. */
export function repairedCondition(condition: number, share: number): number {
  return Math.round(Math.min(1, condition + share) * 1000) / 1000;
}

/** Los defectos que sobreviven a cambiar `share` del componente (lo cambiado se lleva su parte). */
export function repairedDefects(
  defects: BuildingComponent["defects"],
  share: number,
): BuildingComponent["defects"] {
  return defects
    .map((d) => ({ ...d, severity: Math.round(d.severity * (1 - share) * 100) / 100 }))
    .filter((d) => d.severity >= 0.05);
}

/** Los gramos que salen y entran al cambiar `share` de un componente de `grams`. */
export function replacedGrams(grams: number, share: number): number {
  return Math.min(grams, Math.max(0, Math.round(grams * share)));
}

/** Una puerta se traba si está muy gastada y el día es húmedo (la madera hincha); arreglarla la libera. */
export function jammedDoor(door: BuildingComponent | undefined, rainMm: number): boolean {
  return door !== undefined && door.condition < 0.3 && rainMm > 0;
}

/** La barrera de las paredes hacia afuera: la del material más pesado del componente (settlements §5). */
export function wallBarrier(
  components: readonly BuildingComponent[],
  materials: ReadonlyMap<string, MaterialDef>,
): Barrier {
  const walls = components.find((c) => c.part === "walls");
  const heaviest = walls?.materials.reduce<(typeof walls.materials)[number] | undefined>(
    (best, line) => (best === undefined || line.grams > best.grams ? line : best),
    undefined,
  );
  return (heaviest && materials.get(heaviest.material)?.wall) || "wood_wall";
}

/** La barrera de un tabique entre cuartos seg�n la pared del edificio: solo el papel cierra la vista. */
export function partitionBarrier(wall: Barrier): Barrier {
  return wall === "paper_wall" ? "paper_wall" : "doorway";
}
