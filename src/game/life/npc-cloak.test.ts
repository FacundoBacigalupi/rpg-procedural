import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { checkInvariants, LOCATION, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import {
  CLOAK,
  CLOAK_CLO,
  CLOAK_LOST,
  CLOAK_ROAD_DAYS,
  cloakClo,
  cloakWearAfter,
  roadClothing,
} from "./cloak.ts";
import { optInParts } from "./create.ts";
import { NPC_DECISION } from "./decide.ts";
import { engineOptions, Life } from "./life.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import { FULL_PROFILE, validateLifeDependencies } from "./profile.ts";
import { seasonalClothing } from "./thermal.ts";
import { WARDROBE } from "./wardrobe.ts";
import { living } from "./world.ts";

describe("abrigo del viajero (puro)", () => {
  it("apagado por defecto y pide el viaje", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcCloak: true })).toEqual({ npcCloak: true });
    expect(
      validateLifeDependencies({ npcCloak: true }).some((i) => i.requires === "npcJourneyDays"),
    ).toBe(true);
  });

  it("el perfil completo lo enciende desde life-16 y el replay anterior lo apaga", () => {
    expect(FULL_PROFILE.npcCloak).toBe(true);
    expect(optInParts({ npcCloak: true, legacyNoCloak: true })).toEqual({});
    expect(engineOptions("life-15", FULL_PROFILE).legacyNoCloak).toBe(true);
    expect(engineOptions("life-16", FULL_PROFILE).legacyNoCloak).toBeUndefined();
  });

  it("la capa abriga entera y se gasta con los días de camino hasta perderse", () => {
    expect(cloakClo(undefined)).toBe(CLOAK_CLO);
    expect(cloakClo(1)).toBe(0);
    expect(cloakClo(0.5)).toBe(CLOAK_CLO / 2);
    expect(cloakWearAfter(0, CLOAK_ROAD_DAYS / 2)).toBe(0.5);
    expect(cloakWearAfter(0.9, 1000)).toBe(1);
    expect(cloakWearAfter(0.3, 0)).toBe(0.3);
    expect(cloakWearAfter(0.3, Number.NaN)).toBe(0.3);
  });

  it("más cálido que a la salida se viste para el aire de ahora, con o sin capa", () => {
    expect(roadClothing(20, 10, 0)).toEqual(seasonalClothing(20));
    expect(roadClothing(10, 10, 1)).toEqual(seasonalClothing(10));
  });

  it("más frío que a la salida, sin capa queda con la ropa de la salida y con capa se cubre", () => {
    const left = seasonalClothing(15).clo;
    const need = seasonalClothing(-5).clo;
    expect(need).toBeGreaterThan(left + 1);
    expect(roadClothing(-5, 15, 0).clo).toBe(left);
    expect(roadClothing(-5, 15, 1).clo).toBeCloseTo(left + 1, 6);
    // La capa no pasa de lo que hace falta.
    expect(roadClothing(12, 15, 5).clo).toBe(seasonalClothing(12).clo);
    expect(roadClothing(-5, 15, 1).clo).toBeGreaterThan(roadClothing(-5, 15, 0).clo);
  });
});

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

describe("la capa del viajero en la vida (opt-in)", () => {
  function run(cloak: boolean, startWear: number, wardrobe = false) {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      ...(cloak ? { npcCloak: true } : {}),
      ...(wardrobe ? { wardrobe: true } : {}),
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    );
    const walkers = adults.slice(0, 3) as AgentId[];
    const place = w.truth.ids(PLACE)[0] as string;
    const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
    let from = hexes[0] as number;
    for (let i = 0; i < 4; i++) {
      from = (w.map.neighbors[from] ?? []).find((n) => !hexes.includes(n)) ?? from;
    }
    for (const who of walkers) {
      w.truth.set(LOCATION, who, { hex: from });
      w.truth.set(NPC_DECISION, who, {
        at: life.now,
        id: `move:${place}+toward:agent:99`,
        verb: "move",
        target: place,
        utility: 1,
        options: 2,
      } as never);
      if (startWear > 0) w.truth.set(CLOAK, who, { wear: startWear });
    }
    const before = new Map(
      living(w.truth).map((x) => [x, w.truth.get(WARDROBE, x as AgentId)] as const),
    );
    life.advanceTo(life.now + 3 * 86_400);
    return { w, walkers, before };
  }

  it("el viajero gasta la capa por día de camino; sin la opción nadie la lleva; se pierde al acabarse", () => {
    const on = run(true, 0);
    const traveled = on.walkers.filter((x) => on.w.truth.get(CLOAK, x) !== undefined);
    expect(traveled.length).toBeGreaterThan(0);
    for (const x of traveled) expect(on.w.truth.get(CLOAK, x)?.wear).toBeGreaterThan(0);
    for (const x of on.walkers) {
      if (on.w.truth.get(NPC_JOURNEY, x)) {
        expect(on.w.truth.get(CLOAK, x)?.wear ?? 0).toBeGreaterThan(0);
      }
    }
    expect(on.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: on.w.truth, log: on.w.log, ledger: on.w.ledger })).toEqual([]);
    const off = run(false, 0);
    expect(off.walkers.every((x) => off.w.truth.get(CLOAK, x) === undefined)).toBe(true);
    expect(off.w.log.all().some((e) => e.kind === CLOAK_LOST)).toBe(false);

    const worn = run(true, 0.99);
    const lost = worn.w.log.all().filter((e) => e.kind === CLOAK_LOST);
    expect(lost.length).toBeGreaterThan(0);
    for (const e of lost) expect(e.causes.length).toBeGreaterThan(0);
  }, 300_000);

  it("con guardarropa la capa es su prenda de abrigo y se gasta más en camino (clothing-wear-cloak)", () => {
    const r = run(true, 0, true);
    const coatIn = (row: { items: readonly { garment: string; wear: number }[] } | undefined) =>
      row?.items.find((i) => i.garment === "quilted-coat")?.wear ?? 0;
    // Lo que se gastó en estos días (cada uno arranca con el uso que traía).
    const coat = (x: AgentId) => coatIn(r.w.truth.get(WARDROBE, x)) - coatIn(r.before.get(x));
    const travelers = r.walkers.filter((x) => r.w.truth.get(NPC_JOURNEY, x));
    expect(travelers.length).toBeGreaterThan(0);
    expect(r.walkers.every((x) => r.w.truth.get(CLOAK, x) === undefined)).toBe(true);
    const home = living(r.w.truth).find(
      (x) => !r.walkers.includes(x as AgentId) && r.w.truth.get(WARDROBE, x as AgentId),
    ) as AgentId | undefined;
    if (home === undefined) throw new Error("nadie en casa");
    for (const x of travelers) expect(coat(x)).toBeGreaterThan(coat(home));
    expect(r.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: r.w.truth, log: r.w.log, ledger: r.w.ledger })).toEqual([]);
  }, 300_000);

  it("es determinista", () => {
    const key = (r: ReturnType<typeof run>) =>
      JSON.stringify(r.walkers.map((x) => [r.w.truth.get(CLOAK, x), r.w.truth.get(LOCATION, x)]));
    expect(key(run(true, 0))).toBe(key(run(true, 0)));
  }, 300_000);
});
