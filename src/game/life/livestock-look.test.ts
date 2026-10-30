import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  ANIMAL,
  ANIMAL_HUNGER,
  BUILDING,
  DRAFT_FATIGUE,
  type IntentDraft,
  LACTATING,
  LOCATION,
  planFromDraft,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import {
  ANIMAL_WORDS,
  animalsInSight,
  OLD_LOOK_SHARE,
  STARVING_LOOK_LEVEL,
  THIN_LOOK_LEVEL,
  TIRED_LOOK_LEVEL,
} from "./animals.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { itemsSeen, playerView } from "./view.ts";
import type { LifeWorld } from "./world.ts";

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
const HOUR = 3600;

function look(w: LifeWorld, text: string) {
  return planFromDraft(
    {
      kind: "act",
      plan: { kind: "do", verb: "look", args: [{ role: "target", ref: { text, features: [] } }] },
    } as IntentDraft,
    {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known: knownEntities(w, [], itemsSeen(w)),
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      here: w.truth.get(LOCATION, w.player)?.hex,
    },
  );
}

/** En el patio de la casa de un buey, de día, con el buey cansado a la vista: lo devuelve. */
function oxInSight(l: Life): EntityRef {
  const w = l.world;
  const ox = [...w.truth.ids(ANIMAL)]
    .sort()
    .find((id) => w.truth.get(ANIMAL, id)?.species === "ox");
  const home = ox === undefined ? undefined : w.truth.get(ANIMAL, ox)?.home;
  const house = home === undefined ? undefined : w.truth.get(BUILDING, home);
  const yard = house?.graph.spaces.find(
    (s) => w.spaces.spaces.find((n) => n.key === s.key)?.indoor === false,
  );
  const hex = ox === undefined ? undefined : w.truth.get(LOCATION, ox)?.hex;
  if (yard === undefined || hex === undefined) throw new Error("sin patio");
  for (let i = 0; i < 30; i++) {
    w.truth.set(LOCATION, w.player, { hex, space: yard.key });
    // Cansado a mano: si se le nota lo dicen la luz y la distancia.
    tire(w);
    const seen = animalsInSight(w).find((a) => a.species === "ox" && a.tired === true);
    if (seen) return seen.ref;
    l.advanceTo(l.now + HOUR);
  }
  throw new Error("ningún buey cansado a la vista");
}

function tire(w: LifeWorld): void {
  for (const id of w.truth.ids(ANIMAL)) {
    if (w.truth.get(ANIMAL, id)?.species === "ox") {
      w.truth.set(DRAFT_FATIGUE, id, { hours: 0, level: TIRED_LOOK_LEVEL + 0.4 });
    }
  }
}

describe("mirar al animal (livestock-draft-rest-say)", () => {
  it("sin ganado no hay animales que nombrar; adentro tampoco", () => {
    const w = Life.create(7, content, { frequency: 8 }).world;
    expect(animalsInSight(w)).toEqual([]);
    expect(Object.keys(ANIMAL_WORDS).sort()).toEqual(["dog", "goat", "hen", "ox", "sheep"]);
  });

  it("«miro el buey» lo mira a él y la vista y las plantillas dicen que está cansado", () => {
    const l = Life.create(7, content, {
      frequency: 8,
      villageLivestock: true,
      livestockDraft: true,
      livestockDraftFatigue: true,
    });
    const w = l.world;
    const ox = oxInSight(l);
    const known = knownEntities(w, [], itemsSeen(w)).find((k) => k.ref === ox);
    expect(known).toMatchObject({ kind: "object", shape: "ox", features: ["cansado"] });
    const made = look(w, "el buey");
    expect(made.kind).toBe("plan");
    if (made.kind !== "plan") return;
    const target = (made.plan.root as unknown as { args: { entity?: string }[] }).args[0]?.entity;
    expect(w.truth.get(ANIMAL, target as never)?.species).toBe("ox");
    // El turno puede durar: el cansancio se vuelve a poner por si pasó el día.
    const report = l.turn(made.plan, 1);
    tire(w);
    const looked = report.steps.findLast((s) => s.verb === "look");
    expect(looked?.self.effect).toMatchObject({ kind: "observe", target });
    const view = playerView(w, report.steps, { heardSince: report.from });
    const thing = view.things?.find((t) => t.shape === "ox");
    expect(thing).toMatchObject({ shape: "ox", size: "large", looked: true });
    const tiredNow = animalsInSight(w).some((a) => a.ref === target && a.tired === true);
    expect(thing?.state === "tired").toBe(tiredNow);
  }, 300_000);
});

describe("lo demás que se le nota al animal (livestock-look-more)", () => {
  it("de cerca se le ven los años, el hambre y la cría; la vista lo lleva al mirarlo", () => {
    const l = Life.create(7, content, {
      frequency: 8,
      villageLivestock: true,
      livestockLife: true,
      livestockDraft: true,
      livestockDraftFatigue: true,
    });
    const w = l.world;
    const ox = oxInSight(l);
    const lifespan = w.livestockLife?.find((d) => d.id === "ox")?.lifespanYears ?? 0;
    expect(lifespan).toBeGreaterThan(0);
    const mark = (hunger: number) => {
      const a = w.truth.get(ANIMAL, ox);
      if (!a) throw new Error("sin buey");
      const bornAt = w.scheduler.now - Math.ceil((OLD_LOOK_SHARE * lifespan + 0.5) * w.clock.year);
      w.truth.set(ANIMAL, ox, { ...a, bornAt });
      w.truth.set(ANIMAL_HUNGER, ox, { level: hunger });
      w.truth.set(LACTATING, ox, { since: w.scheduler.now });
    };
    mark(THIN_LOOK_LEVEL + 0.1);
    expect(animalsInSight(w).find((a) => a.ref === ox)?.marks).toEqual(["old", "thin", "nursing"]);
    mark(STARVING_LOOK_LEVEL + 0.1);
    expect(animalsInSight(w).find((a) => a.ref === ox)?.marks).toEqual([
      "old",
      "starving",
      "nursing",
    ]);
    // Recién nacido y comido: solo cría.
    const a = w.truth.get(ANIMAL, ox);
    if (!a) throw new Error("sin buey");
    w.truth.set(ANIMAL, ox, { ...a, bornAt: w.scheduler.now });
    w.truth.deleteRaw(ANIMAL_HUNGER.name, ox);
    w.truth.deleteRaw(LACTATING.name, ox);
    expect(animalsInSight(w).find((a) => a.ref === ox)?.marks).toEqual(["young"]);

    mark(STARVING_LOOK_LEVEL + 0.1);
    const made = look(w, "el buey");
    expect(made.kind).toBe("plan");
    if (made.kind !== "plan") return;
    const report = l.turn(made.plan, 1);
    tire(w);
    if (w.truth.get(ANIMAL, ox) !== undefined) mark(STARVING_LOOK_LEVEL + 0.1);
    const view = playerView(w, report.steps, { heardSince: report.from });
    const thing = view.things?.find((t) => t.shape === "ox" && t.looked === true);
    const seen = animalsInSight(w).find((s) => s.ref === ox);
    expect(thing?.marks ?? []).toEqual(seen?.marks ?? []);
  }, 300_000);
});
