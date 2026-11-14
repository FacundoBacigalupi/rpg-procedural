// Lanzar la técnica de ataque (novel3-technique-act): «uso la técnica contra X» saca el qi del
// recipiente, lo devuelve a la reserva, hiere a distancia sin pelea y queda como agresión.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  ART_KNOWN,
  BODY_STATE,
  CULTIVATION_STATE,
  checkInvariants,
  LOCATION,
  PERSON,
  PLACE_QI,
  QI_TAKEN,
  SECT_SCHOOL,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { ART_EVENT } from "./art.ts";
import { offenseOf } from "./deeds.ts";
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

const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

const artPlan = (actor: AgentId, target: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "strike", args: [{ role: "target", entity: target }], manner: ["art"] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

type ArtData = { spent: number; backlash: number; outcome: string; hits: { to: string }[] };

describe("lanzar la técnica de ataque (novel3-technique-act)", () => {
  /** El personaje con la técnica de una escuela, `qi` en el recipiente y alguien de su casa al lado. */
  function setUp(seed: number, qi: number, learn = true) {
    const life = Life.create(seed, content, { cultivation: true });
    const w = life.world;
    const me = life.player;
    const org = [...w.truth.ids(SECT_SCHOOL)].find((id) => w.truth.get(SECT_SCHOOL, id)?.art) as
      | EntityRef
      | undefined;
    if (!org) throw new Error("ninguna escuela con técnica");
    const art = w.truth.get(SECT_SCHOOL, org)?.art;
    if (learn && art) {
      w.truth.set(ART_KNOWN, me, {
        org,
        name: art.name,
        learnedAt: life.now,
        event: w.log.all()[0]?.id as never,
      });
    }
    const cs = w.truth.get(CULTIVATION_STATE, me) ?? { sensitivity: 1, hours: 0 };
    w.truth.set(CULTIVATION_STATE, me, { ...cs, qi });
    // Ese qi salió de las reservas: cada una lo tiene anotado como sacado.
    for (const id of [...w.truth.ids(PLACE_QI)].sort()) {
      const row = w.truth.get(QI_TAKEN, id);
      w.truth.set(QI_TAKEN, id, {
        taken: (row?.taken ?? 0) + qi,
        drawn: (row?.drawn ?? 0) + qi,
        at: row?.at ?? life.now,
      });
    }
    const house = w.truth.get(PERSON, me)?.household;
    const other = living(w.truth).find(
      (id) => id !== me && w.truth.get(PERSON, id)?.household === house,
    ) as AgentId;
    const here = w.truth.get(LOCATION, me);
    if (here) w.truth.set(LOCATION, other, here);
    return { life, w, me, other, art };
  }

  it("con qi sale: lo gastado deja el recipiente y vuelve a la reserva; es agresión; determinista", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { life, w, me, other, art } = setUp(seed, 40);
      const pools = [...w.truth.ids(QI_TAKEN)].sort();
      const takenBefore = pools.map((id) => w.truth.get(QI_TAKEN, id)?.taken ?? 0);
      const woundsBefore = w.truth.get(BODY_STATE, other)?.wounds.length ?? 0;
      const report = life.turn(artPlan(me, other), 1);
      const cast = report.events.find((e) => e.kind === ART_EVENT);
      // Dudó (el nervio frena el golpe): no salió en este seed.
      if (!cast) continue;
      const d = cast.data as ArtData;
      expect(cast.actors).toEqual([me, other]);
      expect(d.spent).toBe(art?.cost);
      expect(report.events.some((e) => e.kind === "combat.fight")).toBe(false);
      expect(w.truth.get(CULTIVATION_STATE, me)?.qi).toBeCloseTo(40 - d.spent, 4);
      const takenAfter = pools.map((id) => w.truth.get(QI_TAKEN, id)?.taken ?? 0);
      const returned =
        takenBefore.reduce((a, b) => a + b, 0) - takenAfter.reduce((a, b) => a + b, 0);
      // Vuelve a la reserva (y la reserva además se repone con el tiempo que pasó).
      expect(returned).toBeGreaterThanOrEqual(d.spent - 1e-6);
      if (d.outcome === "hit") {
        expect(d.hits.map((h) => h.to)).toEqual([other]);
        expect(w.truth.get(BODY_STATE, other)?.wounds.length).toBe(woundsBefore + 1);
      }
      if (d.backlash > 0) {
        expect(w.truth.get(CULTIVATION_STATE, me)?.meridianDamage).toBeGreaterThan(0);
      }
      expect(offenseOf(cast)?.kind).toBe("assault");
      const step = report.steps.find((s) => s.verb === "strike");
      expect(step?.self.effect).toMatchObject({ art: { name: art?.name, outcome: d.outcome } });
      expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
      const twin = setUp(seed, 40);
      twin.life.turn(artPlan(twin.me, twin.other), 1);
      expect(twin.life.hash().total).toBe(life.hash().total);
      return;
    }
    throw new Error("en ningún seed salió la técnica");
  }, 240_000);

  it("sin qi o sin técnica no sale nada: ni evento ni herida", () => {
    for (const [qi, learn, outcome] of [
      [0, true, "no_qi"],
      [40, false, "unknown"],
    ] as const) {
      const { life, w, me, other } = setUp(1, qi, learn);
      const before = w.truth.get(BODY_STATE, other)?.wounds.length ?? 0;
      const report = life.turn(artPlan(me, other), 1);
      expect(report.events.some((e) => e.kind === ART_EVENT)).toBe(false);
      expect(w.truth.get(BODY_STATE, other)?.wounds.length ?? 0).toBe(before);
      expect(w.truth.get(CULTIVATION_STATE, me)?.qi).toBe(qi);
      const step = report.steps.find((s) => s.verb === "strike");
      if (step?.self.effect.kind === "strike" && step.self.effect.committed) {
        expect(step.self.effect.art?.outcome).toBe(outcome);
      }
    }
  }, 240_000);
});
