import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  BELIEFS,
  beliefConfidenceAt,
  believed,
  checkInvariants,
  ENTITY,
  isMistaken,
  LOCATION,
  PERSON,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
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

describe("lo que los vecinos creen del personaje", () => {
  /** Alguien de la casa del personaje: comparten el techo, así que lo reconoce. */
  function housemate(life: Life): AgentId {
    const t = life.world.truth;
    const home = t.get(PERSON, life.player)?.household;
    const id = living(t).find((x) => x !== life.player && t.get(PERSON, x)?.household === home);
    if (!id) throw new Error("sin compañero de casa");
    return id;
  }

  it("quien convive con el personaje sabe dónde está y que vive, con la hora de lo que vio", () => {
    const life = Life.create(7, content);
    const other = housemate(life);
    life.advanceTo(life.now + life.world.clock.day);
    const b = life.world.truth.get(BELIEFS, other);
    const at = believed(b, life.player, "at");
    expect(at).toBeDefined();
    expect(believed(b, life.player, "alive")?.value).toBe(true);
    expect(at?.sources[0]?.kind).toBe("percept");
    expect(at?.asOf).toBeLessThanOrEqual(life.now);
    expect(at?.asOf).toBeGreaterThan(0);
  }, 180_000);

  it("al irse el personaje, lo que creen se queda en lo que vieron: puede ser falso y envejece", () => {
    const life = Life.create(7, content);
    const t = life.world.truth;
    const other = housemate(life);
    // Un día de convivencia: lo ve.
    life.advanceTo(life.now + life.world.clock.day);
    const here = t.get(LOCATION, other);
    if (!here) throw new Error("sin lugar");
    const seen = believed(t.get(BELIEFS, other), life.player, "at");
    expect(seen).toBeDefined();
    // El personaje se va a otro hex; el otro se queda. Nadie le avisa.
    const far = here.hex + 1;
    t.set(LOCATION, life.player, { hex: far });
    const before = life.now;
    life.advanceTo(before + life.world.clock.day / 24);
    const still = believed(t.get(BELIEFS, other), life.player, "at");
    expect(still?.value).toEqual(seen?.value);
    expect(still && isMistaken(t, still)).toBe(true);
    if (!still) return;
    expect(beliefConfidenceAt(still, life.now + 24 * 3600)).toBeLessThan(
      beliefConfidenceAt(still, life.now),
    );
  }, 180_000);

  it("los vecinos también se perciben entre sí: cada uno cree dónde está el otro", () => {
    const life = Life.create(7, content);
    const t = life.world.truth;
    life.advanceTo(life.now + life.world.clock.day);
    const home = t.get(PERSON, life.player)?.household;
    const mates = living(t).filter(
      (x) => x !== life.player && t.get(PERSON, x)?.household === home,
    );
    const pairs = mates.flatMap((a) => mates.filter((b) => b !== a).map((b) => [a, b] as const));
    if (pairs.length === 0) return;
    const known = pairs.filter(([a, b]) => believed(t.get(BELIEFS, a), b, "at") !== undefined);
    expect(known.length).toBeGreaterThan(0);
    for (const [a, b] of known) {
      const bel = believed(t.get(BELIEFS, a), b, "at");
      expect(bel?.sources[0]?.kind).toBe("percept");
      expect(bel?.asOf).toBeLessThanOrEqual(life.now);
    }
  }, 180_000);

  it("las creencias son de gente viva con ficha y el mundo sigue consistente", () => {
    const life = Life.create(7, content);
    life.advanceTo(life.now + life.world.clock.day * 3);
    const t = life.world.truth;
    for (const id of t.ids(BELIEFS)) expect(t.get(ENTITY, id)).toBeDefined();
    expect(checkInvariants({ truth: t, log: life.world.log, ledger: life.world.ledger })).toEqual(
      [],
    );
  }, 180_000);

  it("es determinista", () => {
    const run = () => {
      const life = Life.create(7, content);
      life.advanceTo(life.now + life.world.clock.day * 2);
      return life.hash();
    };
    expect(run()).toEqual(run());
  }, 240_000);
});
