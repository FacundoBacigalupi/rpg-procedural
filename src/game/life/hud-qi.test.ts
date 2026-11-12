// El cultivo en la barra (play-hud-qi): nada hasta sentir el qi; después el recipiente en bandas,
// el nombre del tramo si su escuela se lo dio y el aviso de meridianos dañados.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, type EventId, loadContent } from "../../core/index.ts";
import {
  CULTIVATION_LAW,
  CULTIVATION_STATE,
  realmOf,
  SECT,
  SECT_MEMBER,
  SECT_SCHOOL,
  vesselCapacity,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { cultivationOf, hudPanel, MERIDIAN_HURT } from "./hud.ts";
import { Life } from "./life.ts";
import { characterPanel } from "./panels.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("el cultivo en la barra", () => {
  it("sin sentir el qi no hay nada; después, recipiente, tramo de la escuela y meridianos", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true });
    const w = life.world;
    const me = life.player;
    expect(cultivationOf(w)).toBeUndefined();
    expect(hudPanel(w, characterPanel(w), 0, []).cultivation).toBeUndefined();

    const plane = w.truth.ids(CULTIVATION_LAW)[0];
    const law = plane === undefined ? undefined : w.truth.get(CULTIVATION_LAW, plane);
    if (!law) throw new Error("sin ley de cultivo");
    const cap = vesselCapacity(law, 0);
    const sensed = { at: life.now, event: "event:1" as EventId };
    // Meditó sin llegar a sentirlo: tampoco.
    w.truth.set(CULTIVATION_STATE, me, { sensitivity: 0.5, hours: 10 });
    expect(cultivationOf(w)).toBeUndefined();

    w.truth.set(CULTIVATION_STATE, me, { sensitivity: 1, hours: 20, sensed, qi: 0 });
    expect(cultivationOf(w)).toEqual({ fill: 0, hurt: false });
    w.truth.set(CULTIVATION_STATE, me, { sensitivity: 1, hours: 20, sensed, qi: cap * 0.7 });
    expect(cultivationOf(w)?.fill).toBe(2);
    w.truth.set(CULTIVATION_STATE, me, { sensitivity: 1, hours: 20, sensed, qi: cap });
    expect(hudPanel(w, characterPanel(w), 0, []).cultivation).toEqual({ fill: 3, hurt: false });

    // De una secta con escuela: el tramo con su nombre.
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const school = w.truth.get(SECT_SCHOOL, org);
    if (!school) throw new Error("sin escuela");
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    const stage1 = vesselCapacity(law, 1);
    w.truth.set(CULTIVATION_STATE, me, {
      sensitivity: 1,
      hours: 90,
      sensed,
      qi: stage1 * 0.3,
      stage: 1,
      meridianDamage: MERIDIAN_HURT,
    });
    const named = realmOf(school, 1);
    expect(cultivationOf(w)).toEqual({
      fill: 1,
      realm: { ...named, ...(named?.layer !== undefined ? { word: school.layer } : {}) },
      hurt: true,
    });
  }, 300_000);
});
