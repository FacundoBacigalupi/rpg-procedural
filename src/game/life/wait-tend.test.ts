import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, HOUR, loadContent } from "../../core/index.ts";
import { type ActionPlan, BODY_STATE, LOCATION, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { engineOptions, LIFE_ENGINE, Life } from "./life.ts";
import { onlyWaits, SKIN_CAPACITY_L, WATER_SKIN } from "./routine.ts";

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

const DAY = 24 * HOUR;
const waitPlan = (me: Life["player"], days: number): ActionPlan => ({
  actor: me,
  source: "player",
  root: { kind: "do", verb: "wait", args: [{ role: "for", seconds: days * DAY }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: me, key: "intent" }],
});

describe("esperar días: la rutina mínima atiende lo chico (perfil5-wait-drink)", () => {
  /** El personaje espera 4 días desde el inicio de la vida: cuándo termina el turno y por qué. */
  function waitFourDays(engine: string, away = false) {
    const life = Life.create(7, content, engineOptions(engine, { frequency: 8 }));
    const w = life.world;
    if (away) {
      // Lejos de la aldea y del agua: un hex que no es de ningún lugar de esos tipos.
      const wet = new Set<number>();
      for (const id of w.truth.ids(PLACE)) {
        const p = w.truth.get(PLACE, id);
        if (p?.kind === "village" || p?.kind === "water") for (const h of p.hexes) wet.add(h);
      }
      const dry = w.map.forest.findIndex((_, i) => !wet.has(i));
      w.truth.set(LOCATION, life.player, { hex: dry });
    }
    const start = life.now;
    const report = life.turn(waitPlan(life.player, 4), 1);
    const kinds = report.events.map((e) => e.kind);
    return {
      days: (report.to - start) / DAY,
      interrupt: report.interrupt,
      drank: kinds.filter((k) => k === "routine.drank").length,
      ate: kinds.filter((k) => k === "routine.ate").length,
      water: w.truth.get(BODY_STATE, life.player)?.water ?? Number.NaN,
      alive: life.alive,
      skin: w.truth.get(WATER_SKIN, life.player)?.liters ?? SKIN_CAPACITY_L,
    };
  }

  it("con life-6 en adelante la espera de 4 días se completa; antes la cortaba la sed", () => {
    const old = waitFourDays("life-5");
    expect(old.interrupt?.kind).toBe("body_alarm");
    expect(old.days).toBeLessThan(2);
    expect(old.drank).toBe(0);
    const now = waitFourDays("life-6");
    expect(now.interrupt).toBeNull();
    expect(now.days).toBeGreaterThanOrEqual(4);
    expect(now.drank).toBeGreaterThanOrEqual(3);
    expect(now.ate).toBeGreaterThanOrEqual(9);
    expect(now.alive).toBe(true);
  }, 240_000);

  it("es determinista", () => {
    expect(waitFourDays(LIFE_ENGINE)).toEqual(waitFourDays(LIFE_ENGINE));
  }, 240_000);

  it("lejos del agua, sin odre (life-6) nadie bebe por él: la alarma del cuerpo corta la espera", () => {
    const r = waitFourDays("life-6", true);
    expect(r.drank).toBe(0);
    expect(r.interrupt?.kind).toBe("body_alarm");
    expect(r.days).toBeLessThan(4);
  }, 240_000);

  it("lejos del agua, con life-7 bebe del odre: dura más, se vacía y es determinista (perfil5-wait-afield)", () => {
    const old = waitFourDays("life-6", true);
    const now = waitFourDays(LIFE_ENGINE, true);
    expect(now.drank).toBeGreaterThanOrEqual(2);
    expect(now.days).toBeGreaterThan(old.days + 0.5);
    expect(now.skin).toBeLessThan(SKIN_CAPACITY_L);
    // El odre vacío: la sed vuelve a cortar la espera, como siempre.
    expect(now.interrupt?.kind).toBe("body_alarm");
    expect(waitFourDays(LIFE_ENGINE, true)).toEqual(now);
  }, 360_000);

  it("en la aldea el odre sigue lleno: bebe de la fuente", () => {
    expect(waitFourDays(LIFE_ENGINE).skin).toBe(SKIN_CAPACITY_L);
  }, 240_000);
});

describe("onlyWaits", () => {
  it("solo los planes de puras esperas se atienden", () => {
    const wait = { kind: "do", verb: "wait", args: [], manner: [] } as const;
    const eat = { kind: "do", verb: "eat", args: [], manner: [] } as const;
    expect(onlyWaits({ root: wait })).toBe(true);
    expect(onlyWaits({ root: { kind: "seq", steps: [wait, wait] } })).toBe(true);
    expect(onlyWaits({ root: { kind: "seq", steps: [wait, eat] } })).toBe(false);
    expect(onlyWaits({ root: eat })).toBe(false);
  });
});
