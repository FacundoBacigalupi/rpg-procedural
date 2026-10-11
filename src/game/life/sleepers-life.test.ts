import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { ASLEEP, BODY_STATE, ENTITY, hexPath, LOCATION, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { living } from "./world.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const DAY = 86_400;
const DAYS = 3;
// Tolerancia documentada: el atajo del dormido come y duerme la rutina tipo del día, no la que
// habría decidido el NPC (trabajo, desvíos): las reservas coinciden dentro del 8 % de la masa.
const TOLERANCE = 0.08;

/** Una vida corta con el personaje parado lejos de la aldea, para que los de la aldea duerman. */
function build(sleepers: boolean) {
  const all = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const life = Life.create(7, all, sleepers ? { sleepers: { near: 1, food: "grain" } } : {});
  const w = life.world;
  const place = w.truth.ids(PLACE)[0] as string;
  const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
  let far = hexes[0] as number;
  for (let i = 0; i < 6; i++) {
    far =
      (w.map.neighbors[far] ?? []).find(
        (n) => !hexes.includes(n) && hexPath(w.map, n, hexes[0] as number).length > i,
      ) ?? far;
  }
  w.truth.set(LOCATION, life.player, { hex: far });
  return life;
}

function others(life: Life): AgentId[] {
  const w = life.world;
  const mine = w.truth.get(PERSON, life.player)?.household;
  return living(w.truth).filter(
    (x) => x !== life.player && w.truth.get(PERSON, x)?.household !== mine,
  );
}

describe("tier 1 en una vida real: los dormidos", () => {
  it("al despertar el cuerpo coincide con simularlos hora a hora, y se corre mucho menos", () => {
    const base = build(false);
    const sleepy = build(true);
    const t0 = base.now;
    base.advanceTo(t0 + DAYS * DAY);
    sleepy.advanceTo(t0 + DAYS * DAY);

    const who = others(sleepy).filter((x) => sleepy.world.truth.get(ASLEEP, x));
    expect(who.length).toBeGreaterThan(3);
    // Nadie se durmió por defecto.
    expect(living(base.world.truth).some((x) => base.world.truth.get(ASLEEP, x))).toBe(false);

    // Costo: ni cuerpo, ni rutina ni decisión corrieron hora a hora para ellos.
    const slept = who.filter((x) => {
      const a = sleepy.world.truth.get(BODY_STATE, x)?.updatedAt ?? 0;
      return sleepy.now - a <= DAY;
    });
    expect(slept.length).toBe(who.length);
    const decided = (l: Life, x: AgentId) => l.world.truth.get(NPC_DECISION, x)?.at ?? 0;
    const staleDecisions = who.filter((x) => decided(sleepy, x) < sleepy.now - 2 * DAY);
    const baseFresh = who.filter((x) => decided(base, x) >= base.now - 2 * DAY);
    expect(staleDecisions.length).toBeGreaterThan(baseFresh.length / 2);
    expect(sleepy.world.log.all().length).toBeLessThan(base.world.log.all().length);

    // Despertar: se pide, y la hora siguiente los pone al día y borra el registro.
    for (const x of who) {
      const s = sleepy.world.truth.get(ASLEEP, x);
      if (s) sleepy.world.truth.set(ASLEEP, x, { ...s, wake: true });
    }
    // Para que el pedido no se cancele, el personaje vuelve a la aldea.
    const home = base.world.truth.get(LOCATION, who[0] as AgentId)?.hex as number;
    sleepy.world.truth.set(LOCATION, sleepy.player, { hex: home });
    base.world.truth.set(LOCATION, base.player, { hex: home });
    base.advanceTo(base.now + 3600);
    sleepy.advanceTo(sleepy.now + 3600);

    let compared = 0;
    for (const x of who) {
      const a = sleepy.world.truth.get(BODY_STATE, x);
      const b = base.world.truth.get(BODY_STATE, x);
      const ended = (l: Life) => l.world.truth.get(ENTITY, x)?.endedAt !== undefined;
      if (!a || !b || ended(sleepy) || ended(base)) continue;
      expect(sleepy.world.truth.get(ASLEEP, x)).toBeUndefined();
      compared++;
      const energy = (k: typeof a) => k.glycogen + k.fat;
      const scale = Math.max(1, energy(b));
      expect(Math.abs(energy(a) - energy(b)) / scale).toBeLessThan(TOLERANCE);
      expect(Math.abs(a.massKg - b.massKg) / b.massKg).toBeLessThan(TOLERANCE);
    }
    expect(compared).toBeGreaterThan(3);
  }, 600_000);

  it("sin la opción nadie duerme y el estado es el mismo de siempre", () => {
    const a = build(false);
    const b = build(false);
    a.advanceTo(a.now + DAY);
    b.advanceTo(b.now + DAY);
    expect(a.world.truth.ids(ASLEEP)).toEqual([]);
    expect(a.world.log.all().length).toBe(b.world.log.all().length);
  }, 300_000);
});
