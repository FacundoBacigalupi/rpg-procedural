// El saber hacer de una persona (technology §2): `ProcessKnowledge` es una vista del modelo
// general de habilidad (skills §10) con lo que un proceso mortal necesita de más: cuánto de la
// receta real conoce (`fidelity`; lo que falta o está errado produce defectos), cuánta mano tiene
// (`skill`), de dónde lo sacó (`source`, el evento del aprendizaje o la invención) y si lo guarda.
// Saber no es usar ni adoptar: la adopción por hogares es de la Fase 5.
//
// Los efectos sobre la producción son funciones puras de lo que sabe quien trabaja: el factor se
// mezcla con 1 según su eficacia (`effectiveness`), y un efecto no rinde sin las herramientas que
// el proceso pide, que son otros procesos que ese mismo trabajador tiene que saber hacer.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { compareStrings } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { TechCatalog, TechEffect, TechProcessDef } from "./process.ts";

export interface ProcessKnowledge {
  readonly process: string;
  /** Cuánto de la receta real conoce, 0-1. */
  readonly fidelity: number;
  /** Práctica: control, sentidos, juicio (crafts §1), 0-1. Nunca pasa de la fidelidad. */
  readonly skill: number;
  /** El evento de donde sale: la invención, la lección del maestro, el manual leído. */
  readonly source: EventId;
  /** De quién lo aprendió, si fue de una persona. */
  readonly taughtBy?: AgentId;
  /** Si lo guarda y no lo enseña a cualquiera (§6). */
  readonly secret: boolean;
  readonly learnedAt: Tick;
}

/** Lo que sabe hacer una persona, por id de proceso. */
export type KnownProcesses = Readonly<Record<string, ProcessKnowledge>>;

/** La tabla de `sim/technology` en la verdad, por `AgentId`. */
export const PROCESS_KNOWLEDGE = table<KnownProcesses>("technology.knowledge");

/** Por debajo de esta fidelidad no sirve como herramienta: se sabe de oídas. */
export const TOOL_MIN_FIDELITY = 0.3;

/** Cuánto de la eficacia máxima da solo la fidelidad, sin mano (calibración abierta). */
export const FIDELITY_ONLY_SHARE = 0.4;

/**
 * Cuánto rinde de verdad lo que sabe, 0-1: la fidelidad manda, la mano lo completa. Con el saber
 * perfecto pero sin práctica rinde `FIDELITY_ONLY_SHARE`; con las dos, todo.
 */
export function effectiveness(k: Pick<ProcessKnowledge, "fidelity" | "skill">): number {
  return k.fidelity * (FIDELITY_ONLY_SHARE + (1 - FIDELITY_ONLY_SHARE) * k.skill);
}

/** Pone o reemplaza lo que alguien sabe de un proceso. */
export function withKnowledge(
  known: KnownProcesses | undefined,
  k: ProcessKnowledge,
): KnownProcesses {
  return { ...(known ?? {}), [k.process]: k };
}

/** Los procesos que sabe, ordenados por id. */
export function knownIds(known: KnownProcesses | undefined): readonly string[] {
  return Object.keys(known ?? {}).sort(compareStrings);
}

/** Si tiene todas las herramientas del proceso con fidelidad suficiente. */
export function hasTools(def: TechProcessDef, known: KnownProcesses | undefined): boolean {
  return def.requires.tools.every((t) => (known?.[t]?.fidelity ?? 0) >= TOOL_MIN_FIDELITY);
}

/** Los efectos que rinden hoy: de los procesos que sabe, con las herramientas en la mano. */
function active<K extends TechEffect["kind"]>(
  catalog: TechCatalog,
  known: KnownProcesses | undefined,
  kind: K,
): readonly { readonly effect: Extract<TechEffect, { kind: K }>; readonly power: number }[] {
  const out: { effect: Extract<TechEffect, { kind: K }>; power: number }[] = [];
  for (const id of knownIds(known)) {
    const def = catalog.get(id);
    const k = known?.[id];
    if (!def || !k || !hasTools(def, known)) continue;
    const power = effectiveness(k);
    for (const e of def.effects) if (e.kind === kind) out.push({ effect: e as never, power });
  }
  return out;
}

/** El factor de un efecto que vale `factor` con el saber completo: 1 sin saber, `factor` con todo. */
const blend = (factor: number, power: number) => 1 + (factor - 1) * power;

/** Cuánto cambia la cosecha de un cultivo con lo que sabe quien trabaja el campo (1 = sin cambio). */
export function yieldFactor(
  catalog: TechCatalog,
  known: KnownProcesses | undefined,
  crop: string,
): number {
  let f = 1;
  for (const { effect, power } of active(catalog, known, "yield")) {
    if (effect.crop === crop) f *= blend(effect.factor, power);
  }
  return f;
}

/** Cuántas horas de trabajo pide una unidad de cosecha respecto de sin técnica (1 = igual). */
export function laborFactor(
  catalog: TechCatalog,
  known: KnownProcesses | undefined,
  crop: string,
): number {
  let f = 1;
  for (const { effect, power } of active(catalog, known, "yield")) {
    if (effect.crop === crop) f *= blend(effect.labor, power);
  }
  return f;
}

/** Cuánto se pudre un bien guardado por alguien que sabe conservarlo (1 = igual que sin técnica). */
export function storageFactor(
  catalog: TechCatalog,
  known: KnownProcesses | undefined,
  good: string,
): number {
  let f = 1;
  for (const { effect, power } of active(catalog, known, "storage")) {
    if (effect.good === good) f *= blend(effect.spoilage, power);
  }
  return f;
}

/** Los materiales que puede producir con calidad (el mejor para cada uno), por id. */
export function materialQuality(
  catalog: TechCatalog,
  known: KnownProcesses | undefined,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const { effect, power } of active(catalog, known, "material")) {
    out[effect.produces] = Math.max(out[effect.produces] ?? 0, effect.quality * power);
  }
  return out;
}

/** Los procesos que lo que sabe habilita (`craft_unlock`), sin los que ya sabe, ordenados. */
export function unlockedProcesses(
  catalog: TechCatalog,
  known: KnownProcesses | undefined,
): readonly string[] {
  const out = new Set<string>();
  for (const { effect } of active(catalog, known, "craft_unlock")) {
    if (!known?.[effect.process]) out.add(effect.process);
  }
  return [...out].sort(compareStrings);
}
