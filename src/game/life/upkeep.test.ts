import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  BUILDING,
  checkInvariants,
  ENTITY,
  LOCATION,
  MATERIALS,
  PERSON,
  VILLAGE_SQUARE,
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
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

describe("mantenimiento de la aldea", () => {
  it("los edificios se gastan, un techo caído se repara por el ledger y todo cierra", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const { truth, log, ledger, clock } = life.world;
    const homes = truth.ids(BUILDING).filter((id) => truth.get(BUILDING, id)?.household);
    const home = homes[0];
    const record = home && truth.get(BUILDING, home);
    if (!home || !record) throw new Error("sin casas");
    // Un techo muy gastado: el hogar tiene que arreglarlo.
    truth.set(BUILDING, home, {
      ...record,
      components: record.components.map((c) => (c.part === "roof" ? { ...c, condition: 0.2 } : c)),
    });
    const others = new Map(homes.slice(1).map((id) => [id, truth.get(BUILDING, id)]));
    life.advanceTo(life.now + 120 * clock.day);

    const repairs = log.all().filter((e) => e.kind === "settlement.repaired");
    expect(repairs.length).toBeGreaterThan(0);
    for (const e of repairs) expect(e.causes.length).toBeGreaterThan(0);
    const roof = truth.get(BUILDING, home)?.components.find((c) => c.part === "roof");
    expect(roof?.condition).toBeGreaterThan(0.3);
    expect(roof?.materials.length).toBeGreaterThan(1); // lo cambiado tiene otro origen
    const worn = [...others].some(([id, b]) =>
      truth
        .get(BUILDING, id)
        ?.components.some((c, i) => c.condition < (b?.components[i]?.condition ?? 0)),
    );
    expect(worn).toBe(true);
    expect(ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth, log, ledger })).toEqual([]);
  }, 240_000);
});

describe("reconstrucción de la aldea", () => {
  it("el hogar sin casa levanta una nueva con su trabajo, citando la caída, y todo cierra", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const { truth, log, ledger, clock } = life.world;
    const home = truth.ids(BUILDING).find((id) => truth.get(BUILDING, id)?.household);
    const record = home && truth.get(BUILDING, home);
    const base = home && truth.get(ENTITY, home);
    if (!home || !record || !base) throw new Error("sin casas");
    const cutoff = life.now - 20 * clock.day;
    const fall = log
      .all()
      .filter((e) => e.tick <= cutoff)
      .at(-1);
    if (!fall) throw new Error("sin eventos");
    // La casa cayó hace tiempo: una ruina chica (poca materia) que su hogar quiere rehacer igual.
    truth.set(ENTITY, home, { ...base, endedAt: fall.tick, endEventId: fall.id });
    truth.set(BUILDING, home, {
      ...record,
      components: record.components.map((c) => ({ ...c, area: 1 })),
      ruin: { cause: "rain", rebuild: "same" },
    });
    for (const id of truth.ids(PERSON)) {
      const at = truth.get(LOCATION, id);
      if (at && at.space === record.graph.spaces[0]?.key)
        truth.set(LOCATION, id, { hex: at.hex, space: VILLAGE_SQUARE });
    }
    life.advanceTo(life.now + 5 * clock.day);

    const rebuilt = log.all().filter((e) => e.kind === "settlement.rebuilt");
    expect(rebuilt.length).toBe(1);
    expect(rebuilt[0]?.causes).toEqual([{ kind: "event", event: fall.id }]);
    const fresh = truth.ids(BUILDING).find((id) => truth.get(BUILDING, id)?.replaces === home);
    const built = fresh && truth.get(BUILDING, fresh);
    expect(built?.household).toBe(record.household);
    expect(truth.get(ENTITY, fresh as never)?.endedAt).toBeUndefined();
    expect(ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth, log, ledger })).toEqual([]);
  }, 240_000);

  it("con swapMaterials, «distinto» reconstruye sin poner un material donde no sirve, y todo cierra", () => {
    const life = Life.create(7, content, { frequency: 8, swapMaterials: true });
    const { truth, log, ledger, clock } = life.world;
    const home = truth.ids(BUILDING).find((id) => truth.get(BUILDING, id)?.household);
    const record = home && truth.get(BUILDING, home);
    const base = home && truth.get(ENTITY, home);
    if (!home || !record || !base) throw new Error("sin casas");
    const fall = log
      .all()
      .filter((e) => e.tick <= life.now - 20 * clock.day)
      .at(-1);
    if (!fall) throw new Error("sin eventos");
    truth.set(ENTITY, home, { ...base, endedAt: fall.tick, endEventId: fall.id });
    truth.set(BUILDING, home, {
      ...record,
      components: record.components.map((c) => ({ ...c, area: 1 })),
      ruin: { cause: "rain", rebuild: "different" },
    });
    for (const id of truth.ids(PERSON)) {
      const at = truth.get(LOCATION, id);
      if (at && at.space === record.graph.spaces[0]?.key)
        truth.set(LOCATION, id, { hex: at.hex, space: VILLAGE_SQUARE });
    }
    life.advanceTo(life.now + 5 * clock.day);

    expect(log.all().filter((e) => e.kind === "settlement.rebuilt").length).toBe(1);
    const fresh = truth.ids(BUILDING).find((id) => truth.get(BUILDING, id)?.replaces === home);
    const built = fresh && truth.get(BUILDING, fresh);
    if (!built) throw new Error("no se reconstruyó");
    const allowed = new Map(content.all(MATERIALS).map((m) => [m.id, m.parts] as const));
    for (const c of built.components) {
      for (const line of c.materials) {
        const parts = allowed.get(line.material);
        expect(parts === undefined || parts.includes(c.part)).toBe(true);
      }
    }
    expect(ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth, log, ledger })).toEqual([]);
  }, 240_000);
});
