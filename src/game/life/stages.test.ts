import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  DEVELOPMENT,
  ENTITY,
  LIFE_STAGES,
  noPlaceDeficit,
  PERSON,
  riteStep,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import {
  RITE_HELD_EVENT,
  RITE_MISSED_EVENT,
  STAGE_ENTERED_EVENT,
  STAGES_SEEDED_EVENT,
  stageBoldness,
} from "./stages.ts";

const DAY = 86400;

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

// Hash de develop (el mismo de techknow.test.ts): apagado no debe moverlo.
const BASE_HASH = "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f";

describe("etapas de vida (lifeStages)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (lifeStages: boolean, days: number) => {
    const l = Life.create(3, content, lifeStages ? { lifeStages: true } : {});
    l.advanceTo(l.now + DAY * days);
    return l;
  };
  const rows = (l: Life) => l.world.truth.ids(DEVELOPMENT);

  it("apagado deja el hash de develop, sin filas ni eventos", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
    expect(rows(off)).toEqual([]);
    expect(off.world.log.all().some((e) => e.kind === STAGES_SEEDED_EVENT)).toBe(false);
  });

  it("encendido guarda una fila por persona viva con la etapa de su edad, hijo de la fundación", () => {
    const on = Life.create(3, content, { lifeStages: true });
    expect(on.hash().total).not.toBe(BASE_HASH);
    expect(rows(on).length).toBeGreaterThan(0);
    const seeded = on.world.log.all().filter((e) => e.kind === STAGES_SEEDED_EVENT);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.causes.length).toBeGreaterThan(0);
    const ids = new Set(content.all(LIFE_STAGES).map((s) => s.id));
    for (const id of rows(on)) {
      const d = on.world.truth.get(DEVELOPMENT, id);
      expect(ids.has(d?.stage ?? "")).toBe(true);
      expect(d?.originEventId).toBe(seeded[0]?.id);
    }
  });

  it("determinista y las etapas avanzan con evento y causa (cumpleaños)", () => {
    const a = run(true, 120);
    const b = run(true, 120);
    expect(a.hash().total).toBe(b.hash().total);
    const entered = a.world.log.all().filter((x) => x.kind === STAGE_ENTERED_EVENT);
    expect(entered.length).toBeGreaterThan(0);
    for (const e of entered) {
      expect(e.causes.length).toBeGreaterThan(0);
      expect(e.actors).toHaveLength(1);
    }
  });

  it("el sesgo de riesgo de la etapa mueve la audacia, acotada", () => {
    expect(stageBoldness(0.5, "adolescence")).toBeGreaterThan(stageBoldness(0.5, "elder"));
    expect(stageBoldness(1, "adolescence")).toBe(1);
    expect(stageBoldness(0, "elder")).toBe(0);
    expect(stageBoldness(0.5, "desconocida")).toBe(0.5);
  });

  it("riteStep: ventana, padrino y nada hacia atrás", () => {
    const rite = { ageYears: 15, graceYears: 2 };
    expect(riteStep({}, rite, 14.9, true, 0.1)).toBe("none");
    expect(riteStep({}, rite, 15, true, 0.1)).toBe("hold");
    expect(riteStep({}, rite, 16, false, 0.1)).toBe("none");
    expect(riteStep({}, rite, 17.05, false, 0.1)).toBe("miss");
    expect(riteStep({}, rite, 30, false, 0.1)).toBe("none");
    expect(riteStep({ riteMissed: true }, rite, 17.05, true, 0.1)).toBe("none");
  });
});

describe("ritos de paso (stageRites)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  /** Una vida con dos chicos vivos a edades fijadas (la aldea casi no tiene chicos a punto del rito). */
  const staged = (opts: object, ageA: number, ageB: number) => {
    const l = Life.create(3, content, opts);
    const kids = l.world.truth
      .ids(PERSON)
      .filter((p) => l.world.truth.get(ENTITY, p)?.endedAt === undefined)
      .filter((p) => {
        const age = (l.now - (l.world.truth.get(PERSON, p)?.born ?? 0)) / l.world.clock.year;
        return age > 3 && age < 15;
      });
    const [a, b] = kids;
    expect(a && b).toBeTruthy();
    for (const [id, age] of [
      [a, ageA],
      [b, ageB],
    ] as const) {
      const person = l.world.truth.get(PERSON, id as never);
      l.world.truth.set(PERSON, id as never, {
        ...(person as NonNullable<typeof person>),
        born: l.now - age * l.world.clock.year,
      });
    }
    l.advanceTo(l.now + DAY * 3);
    return { l, a: a as AgentId, b: b as AgentId };
  };

  it("sin stageRites (o sin lifeStages) no hay ritos ni cambia el hash", () => {
    const { l } = staged({ lifeStages: true }, 14.1, 16.01);
    expect(l.world.log.all().some((e) => e.kind === RITE_HELD_EVENT)).toBe(false);
    expect(l.world.log.all().some((e) => e.kind === RITE_MISSED_EVENT)).toBe(false);
    expect(Life.create(3, content, { stageRites: true }).hash().total).toBe(BASE_HASH);
  }, 600_000);

  it("se hace el rito con padrino adulto (con causa, una vez) y el que deja vencer la ventana queda sin lugar", () => {
    const { l, a, b } = staged({ lifeStages: true, stageRites: true }, 14.1, 16.01);
    const again = staged({ lifeStages: true, stageRites: true }, 14.1, 16.01);
    expect(l.hash().total).toBe(again.l.hash().total);
    const held = l.world.log.all().filter((e) => e.kind === RITE_HELD_EVENT);
    expect(held).toHaveLength(1);
    const [rite] = held;
    expect(rite?.causes.length).toBeGreaterThan(0);
    const [kid, sponsor] = rite?.actors ?? [];
    expect(kid).toBe(a);
    expect(sponsor).not.toBe(kid);
    const born = l.world.truth.get(PERSON, sponsor as never)?.born ?? 0;
    expect(((rite?.tick ?? 0) - born) / l.world.clock.year).toBeGreaterThanOrEqual(30);
    expect(l.world.truth.get(DEVELOPMENT, a)?.riteOfPassage).toBe(rite?.id);
    // El otro pasó la ventana: una sola marca y un solo evento, y cuenta como sin lugar.
    const missed = l.world.log.all().filter((e) => e.kind === RITE_MISSED_EVENT);
    expect(missed).toHaveLength(1);
    expect(missed[0]?.actors).toEqual([b]);
    const db = l.world.truth.get(DEVELOPMENT, b);
    expect(db?.riteMissed).toBe(true);
    expect(db?.riteOfPassage).toBeUndefined();
    expect(noPlaceDeficit(db as NonNullable<typeof db>, new Set())).toBe(1);
  }, 600_000);
});
