// La sede en su celda (novel-sect-seat-switch): con `sectSeatRegion`, el mapa de la vida es la
// región por tierra hasta la sede, y la sede es un lugar al que se llega caminando.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  checkInvariants,
  hexPath,
  LOCATION,
  PLACE,
  patchesOf,
  patchOf,
  SECT,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("la sede en su celda (novel-sect-seat-switch)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const options = { cultivation: true, sectSeatRegion: true } as const;
  const life = Life.create(3, content, options);
  const w = life.world;
  const org = w.truth.ids(SECT)[0];
  const sect = org ? w.truth.get(SECT, org) : undefined;
  if (!sect) throw new Error("sin secta");
  const seatCell = patchesOf(w.map).at(-1)?.cell;

  it("la sede es un lugar con un hex en el parche de su celda, al que se llega caminando", () => {
    const place = w.truth.get(PLACE, sect.seatPlace);
    expect(place?.kind).toBe("sect");
    const hex = place?.hexes[0] as number;
    expect(patchOf(w.map, hex).cell).toBe(seatCell);
    const from = w.truth.get(LOCATION, life.player);
    const start = from?.hex ?? 0;
    expect(hexPath(w.map, start, hex).length).toBeGreaterThan(0);
    // El ancla del guardado lleva la región entera.
    expect(patchesOf(life.anchor.map).length).toBe(patchesOf(w.map).length);
  });

  it("si la sede está en otra celda, el mapa tiene más de un parche y la aldea queda primero", () => {
    const patches = patchesOf(w.map);
    if (sect.seat.hops === 0) {
      expect(patches.length).toBe(1);
      return;
    }
    expect(patches.length).toBeGreaterThan(1);
    expect(patches[0]?.base).toBe(0);
    expect(patches[0]?.cell).toBe(w.map.cell);
  });

  it("unos días después: determinista y con invariantes limpios", () => {
    const a = Life.create(3, content, options);
    const b = Life.create(3, content, options);
    const t = a.now + 3 * a.world.clock.day;
    a.advanceTo(t);
    b.advanceTo(t);
    expect(a.hash().total).toBe(b.hash().total);
    const { truth, log, ledger } = a.world;
    expect(ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth, log })).toEqual([]);
  });

  it("con `move` a la sede, turno a turno, se cruza de parche y se llega", () => {
    // El viaje de varios días (acampar, comer, beber) es novel-sect-seat-trek: acá se sale a
    // menos de un día de la sede, del lado de la aldea, y se camina como el jugador, turno a turno.
    const walker = Life.create(3, content, options);
    const ww = walker.world;
    const me = walker.player;
    const s = ww.truth.get(SECT, ww.truth.ids(SECT)[0] as EntityRef);
    const target = s?.seatPlace as EntityRef;
    const goal = ww.truth.get(PLACE, target)?.hexes[0] as number;
    const home = ww.truth.get(LOCATION, me)?.hex as number;
    const path = [home, ...hexPath(ww.map, home, goal)];
    const left = (i: number) =>
      path.slice(i + 1).reduce((t, h) => t + (ww.map.crossSeconds[h] ?? 0), 0);
    const start = path.findIndex((_, i) => left(i) <= 0.6 * ww.clock.day);
    const from = path[start] as number;
    expect(patchOf(ww.map, from).cell).not.toBe(seatCell);
    ww.truth.set(LOCATION, me, { hex: from });
    const plan: ActionPlan = {
      actor: me,
      source: "player",
      root: { kind: "do", verb: "move", args: [{ role: "to", entity: target }], manner: [] },
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    };
    let turns = 0;
    while (walker.alive && ww.truth.get(LOCATION, me)?.hex !== goal && turns < 40) {
      walker.turn(plan, ++turns);
    }
    expect({ alive: walker.alive, at: ww.truth.get(LOCATION, me)?.hex }).toEqual({
      alive: true,
      at: goal,
    });
  });

  it("apagado, el mapa es solo el parche de la aldea", () => {
    const off = Life.create(3, content, { cultivation: true });
    expect(patchesOf(off.world.map).length).toBe(1);
    const s = off.world.truth.ids(SECT)[0];
    const seat = s ? off.world.truth.get(SECT, s)?.seatPlace : undefined;
    expect(seat === undefined ? undefined : off.world.truth.get(PLACE, seat)).toBeUndefined();
  });
});
