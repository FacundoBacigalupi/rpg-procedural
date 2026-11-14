// Las bestias que bajan del monte de la sede (novel3-beasts-materialize): con hambre, un lobo sale
// de la población del monte como individuo con cuerpo cerca de la sede; si sigue vivo vuelve al
// cabo de unos días (la población lo recupera) y si muere queda su cuerpo.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  BEAST,
  BEAST_DESCENDED_EVENT,
  BEAST_RETURNED_EVENT,
  BEAST_STAY_DAYS,
  BODY_STATE,
  checkInvariants,
  descentChance,
  ENTITY,
  LOCATION,
  PLACE,
  SECT,
  WILDS,
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

const DAY = 86400;

describe("las bestias que bajan (novel3-beasts-materialize)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("la chance crece con la cuenta y el hambre, y sin un individuo entero no baja", () => {
    expect(descentChance(0.5, 0.01, 1, 1)).toBe(0);
    expect(descentChance(10, 0.01, 0, 1)).toBe(0);
    expect(descentChance(10, 0.01, 0.5, 1)).toBeCloseTo(0.05);
    expect(descentChance(10, 0.01, 1, 1)).toBeGreaterThan(descentChance(5, 0.01, 1, 1));
    expect(descentChance(1000, 0.01, 1, 1)).toBe(1);
  });

  const setup = () => {
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const seat = w.truth.get(SECT, org)?.seatPlace as EntityRef;
    const wilds = w.truth.get(WILDS, seat);
    if (!wilds) throw new Error("sin monte en la sede");
    // Solo lobos, muchos y sin presas: hambre plena, baja uno seguro.
    w.truth.set(WILDS, seat, { ...wilds, populations: [{ lineage: "wolf", count: 200 }] });
    return { life, w, seat, hex: w.truth.get(PLACE, seat)?.hexes[0] };
  };
  const wolves = (w: ReturnType<typeof setup>["w"], seat: EntityRef) =>
    w.truth.get(WILDS, seat)?.populations.find((p) => p.lineage === "wolf")?.count;

  it("baja un lobo con cuerpo cerca de la sede y vuelve al monte si sigue vivo", () => {
    const { life, w, seat, hex } = setup();
    life.advanceTo(life.now + DAY + 60);
    const down = w.log.all().filter((e) => e.kind === BEAST_DESCENDED_EVENT);
    expect(down).toHaveLength(1);
    const id = (down[0]?.data as { beast?: EntityRef } | undefined)?.beast as EntityRef;
    expect(down[0]?.causes).toEqual([{ kind: "state", entity: seat, key: WILDS.name }]);
    expect(w.truth.get(BEAST, id)).toMatchObject({ lineage: "wolf", home: seat });
    expect(w.truth.get(BODY_STATE, id)?.plan).toBe("wolf");
    expect(w.truth.get(LOCATION, id)).toEqual({ hex });
    expect(wolves(w, seat)).toBe(199);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);

    life.advanceTo(life.now + (BEAST_STAY_DAYS + 1) * DAY);
    const back = w.log.all().find((e) => e.kind === BEAST_RETURNED_EVENT);
    expect((back?.data as { beast?: EntityRef } | undefined)?.beast).toBe(id);
    expect(w.truth.get(ENTITY, id)?.endedAt).toBeDefined();
    expect(w.truth.get(LOCATION, id)).toBeUndefined();
    // Volvió uno; después puede haber bajado otro (siguen con hambre), nunca más de uno a la vez.
    const out = [...w.truth.ids(BEAST)].filter(
      (b) => w.truth.get(ENTITY, b as EntityRef)?.endedAt === undefined,
    );
    expect(out.length).toBeLessThanOrEqual(1);
    expect(wolves(w, seat)).toBe(200 - out.length);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);

  it("muerto no vuelve: queda su cuerpo y la población no lo recupera; determinista", () => {
    const run = () => {
      const { life, w, seat } = setup();
      life.advanceTo(life.now + DAY + 60);
      const id = [...w.truth.ids(BEAST)][0] as EntityRef;
      const body = w.truth.get(BODY_STATE, id);
      if (!body) throw new Error("sin lobo");
      w.truth.set(BODY_STATE, id, { ...body, death: { at: life.now, cause: "test" } as never });
      life.advanceTo(life.now + (BEAST_STAY_DAYS + 1) * DAY);
      return {
        id,
        returned: w.log
          .all()
          .some(
            (e) => e.kind === BEAST_RETURNED_EVENT && (e.data as { beast: EntityRef }).beast === id,
          ),
        ended: w.truth.get(ENTITY, id)?.endedAt,
        at: w.truth.get(LOCATION, id),
        wolves: wolves(w, seat),
        down: w.log.all().filter((e) => e.kind === BEAST_DESCENDED_EVENT).length,
        out: [...w.truth.ids(BEAST)].filter(
          (b) => b !== id && w.truth.get(ENTITY, b as EntityRef)?.endedAt === undefined,
        ).length,
      };
    };
    const a = run();
    expect(a.returned).toBe(false);
    expect(a.ended).toBeUndefined();
    expect(a.at).toBeDefined();
    // Ese no vuelve; el monte, con hambre, manda otros (que vuelven o siguen abajo).
    expect(a.down).toBeGreaterThan(1);
    expect(a.wolves).toBe(200 - 1 - a.out);
    expect(run()).toEqual(a);
  }, 600_000);
});
