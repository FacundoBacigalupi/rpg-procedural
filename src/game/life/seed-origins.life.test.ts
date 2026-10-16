import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, canonicalHash, loadContent } from "../../core/index.ts";
import { COMMUNITY_ACCENT, ENTITY } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { originOf, PERSON_ORIGIN } from "./person-origin.ts";
import { villageOf } from "./taboos.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const rows = (l: Life) => canonicalHash(l.world.truth.rows());

describe("vida con comunidades vecinas", () => {
  it("apagado, la misma verdad que sin la opción; encendido es determinista y siembra", () => {
    const off = Life.create(7, content, {});
    expect(rows(Life.create(7, content, { neighborCommunities: 0 }))).toBe(rows(off));

    const a = Life.create(7, content, { neighborCommunities: 2 });
    const b = Life.create(7, content, { neighborCommunities: 2 });
    expect(rows(a)).toBe(rows(b));
    expect(rows(a)).not.toBe(rows(off));
    const truth = a.world.truth;
    const village = villageOf(truth);
    const others = truth.ids(COMMUNITY_ACCENT).filter((id) => id !== village);
    expect(others).toHaveLength(2);
    for (const o of others) expect(truth.has(ENTITY, o)).toBe(true);
    expect(truth.ids(PERSON_ORIGIN)).toEqual([]);
  });

  it("el personaje que llega de afuera tiene el origen de una vecina", () => {
    const life = Life.create(7, content, {
      neighborCommunities: 1,
      playerEntry: { kind: "arrived", from: 0, yearsHere: 2 },
    });
    const truth = life.world.truth;
    const me = life.world.player;
    expect(originOf(truth, me)).not.toBe(villageOf(truth));
    expect(truth.has(PERSON_ORIGIN, me)).toBe(true);
  });
});
