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
import { PLAYER_TREK } from "./trek.ts";
import { playerView } from "./view.ts";

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

  it("con la marcha, un `move` a la sede va de la aldea a la sede en días, vivo", () => {
    const walker = Life.create(3, content, { ...options, playerTrek: true });
    const ww = walker.world;
    const me = walker.player;
    const s = ww.truth.get(SECT, ww.truth.ids(SECT)[0] as EntityRef);
    const target = s?.seatPlace as EntityRef;
    const goal = ww.truth.get(PLACE, target)?.hexes[0] as number;
    const plan: ActionPlan = {
      actor: me,
      source: "player",
      root: { kind: "do", verb: "move", args: [{ role: "to", entity: target }], manner: [] },
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    };
    const from = walker.now;
    let turns = 0;
    while (walker.alive && ww.truth.get(LOCATION, me)?.hex !== goal && turns < 20) {
      walker.turn(plan, ++turns);
    }
    const trek = ww.log.all().filter((e) => e.kind === "life.trek" && e.actors.includes(me));
    const what = trek.map((e) => (e.data as { what: string }).what);
    expect({ alive: walker.alive, at: ww.truth.get(LOCATION, me)?.hex }).toEqual({
      alive: true,
      at: goal,
    });
    expect(what[0]).toBe("started");
    expect(what.at(-1)).toBe("arrived");
    expect(turns).toBeLessThan(5);
    // Más de una noche de camino: paró a dormir.
    expect((walker.now - from) / ww.clock.day).toBeGreaterThan(4);
    expect(ww.truth.has(PLAYER_TREK, me)).toBe(false);
    expect(ww.ledger.audit()).toEqual([]);
    // El turno en que llega, el narrador lo sabe.
    const last = trek.at(-1)?.tick ?? walker.now;
    expect(playerView(ww, [], { heardSince: last }).self.cues).toContain("trek_arrived");
  });

  it("apagado, el mapa es solo el parche de la aldea", () => {
    const off = Life.create(3, content, { cultivation: true });
    expect(patchesOf(off.world.map).length).toBe(1);
    const s = off.world.truth.ids(SECT)[0];
    const seat = s ? off.world.truth.get(SECT, s)?.seatPlace : undefined;
    expect(seat === undefined ? undefined : off.world.truth.get(PLACE, seat)).toBeUndefined();
  });
});
