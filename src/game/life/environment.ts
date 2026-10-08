// El panel de entorno (player-loop, ampliación 2026-10-08; perception, habituación): lo que el
// personaje percibe del lugar por canal sensorial, con una saliencia que decae con una vida media
// por canal. Se renueva cuando el estado cambia (cambia el tiempo, entra a otro lugar) o cuando mira
// a propósito; lo habituado sigue ahí pero deja de figurar. Solo lee lo que el personaje percibe
// (luz, temperatura que siente, lluvia y viento que oye o toca), nunca la verdad oculta.
//
// La memoria de habituación (`EnvironmentMemory`) la lleva quien muestra el panel: no es estado del
// mundo ni se guarda, así que al retomar una vida todo vuelve a ser nuevo un rato.
// Faltan el olfato y el qi (no hay fuentes todavía); calibración abierta: vidas medias por canal.

import type { Tick } from "../../core/index.ts";
import { type DayWeather, LOCATION, skyLight, spaceLight, weatherAt } from "../../sim/index.ts";
import { ambientOf } from "./ambient.ts";
import type { LifeWorld } from "./world.ts";

export type Channel = "sight" | "hearing" | "touch" | "smell";

/** Qué se percibe; el texto lo pone quien muestra el panel. */
export type EnvironmentKind =
  | "dark"
  | "dim"
  | "bright"
  | "rain"
  | "snow"
  | "wind"
  | "freezing"
  | "cold"
  | "cool"
  | "warm"
  | "hot";

export interface EnvironmentItem {
  readonly channel: Channel;
  readonly kind: EnvironmentKind;
  /** 0-1: cuánto se nota todavía. */
  readonly salience: number;
}

/** Segundos en que la saliencia baja a la mitad, por canal. */
export const HALF_LIFE: Readonly<Record<Channel, number>> = {
  smell: 5 * 60,
  hearing: 20 * 60,
  touch: 45 * 60,
  sight: 4 * 3600,
};

/** Por debajo de esto ya no figura en el panel. */
export const NOTICEABLE = 0.25;

/** Desde cuándo se percibe cada cosa en el lugar actual: la reinicia un cambio o mirar. */
export type EnvironmentMemory = Map<string, Tick>;

interface Raw {
  readonly channel: Channel;
  readonly kind: EnvironmentKind;
}

function sensed(w: LifeWorld, day: DayWeather, now: Tick): Raw[] {
  const at = w.truth.get(LOCATION, w.player);
  const node =
    at?.space === undefined ? undefined : w.spaces.spaces.find((s) => s.key === at.space);
  const indoor = node?.indoor ?? false;
  const out: Raw[] = [];

  const sky = skyLight(w.map, w.clock, w.seed, now);
  const light = node ? spaceLight(node, sky) : sky;
  out.push({ channel: "sight", kind: light < 0.15 ? "dark" : light < 0.5 ? "dim" : "bright" });

  const temp = ambientOf(w)(w.truth, w.player)(now);
  const band: EnvironmentKind | undefined =
    temp < 0
      ? "freezing"
      : temp < 8
        ? "cold"
        : temp < 14
          ? "cool"
          : temp >= 32
            ? "hot"
            : temp >= 26
              ? "warm"
              : undefined;
  if (band) out.push({ channel: "touch", kind: band });

  if (day.precip.kind === "snow") out.push({ channel: indoor ? "hearing" : "touch", kind: "snow" });
  else if (day.precip.kind !== "none") out.push({ channel: "hearing", kind: "rain" });
  if (day.windMs >= (indoor ? 12 : 8)) out.push({ channel: "hearing", kind: "wind" });
  return out;
}

/**
 * Lo que se nota ahora. Actualiza la memoria: lo nuevo se anota con la hora, lo que dejó de estar
 * se olvida, y con `attended` (miró a propósito) todo vuelve a empezar.
 */
export function environmentPanel(
  w: LifeWorld,
  memory: EnvironmentMemory,
  options: { readonly attended?: boolean } = {},
): EnvironmentItem[] {
  const now = w.scheduler.now;
  const at = w.truth.get(LOCATION, w.player);
  const here = `${at?.hex}/${at?.space ?? ""}`;
  const day = weatherAt(w.map, w.clock, w.seed, now);
  const raw = sensed(w, day, now);
  const keys = new Set(raw.map((r) => `${here}|${r.channel}|${r.kind}`));
  for (const k of [...memory.keys()]) if (!keys.has(k)) memory.delete(k);
  const items: EnvironmentItem[] = [];
  for (const r of raw) {
    const key = `${here}|${r.channel}|${r.kind}`;
    if (options.attended || !memory.has(key)) memory.set(key, now);
    const since = memory.get(key) ?? now;
    const salience = 0.5 ** ((now - since) / HALF_LIFE[r.channel]);
    if (salience >= NOTICEABLE) items.push({ channel: r.channel, kind: r.kind, salience });
  }
  return items.sort((a, b) => b.salience - a.salience || (a.kind < b.kind ? -1 : 1));
}
