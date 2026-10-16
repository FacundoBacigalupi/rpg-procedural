import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { checkInvariants, ORG_LOYALTY } from "../../sim/index.ts";
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
const DAY = 86400;

const council = {
  issues: { famineDays: 100000 },
  treasury: {
    everyDays: 5,
    contribute: [{ good: "grain", amount: 2000, keep: 0 }],
    orders: {},
    loyalty: {},
  },
};

describe("LifeOptions.patientDecides.councilAuthority (5c)", () => {
  it("sin la opción la vida es idéntica a la de siempre (creación y 5 días)", () => {
    // `patientDecides` sin `healers` ni consejo no toca nada: mismo hash que `{}`.
    const run = (o: object) => {
      const life = Life.create(3, content, o);
      const born = life.hash().total;
      life.advanceTo(life.now + DAY * 5);
      return [born, life.hash().total];
    };
    expect(run({ patientDecides: { realBonds: true } })).toEqual(run({}));
  });

  it("encendido con consejo y lealtad: determinista, invariantes limpios y la lealtad existe", () => {
    const make = () => {
      const life = Life.create(3, content, {
        council,
        healthCulture: true,
        patientDecides: { realBonds: true, councilAuthority: {} },
      });
      life.advanceTo(life.now + DAY * 30);
      return life;
    };
    const a = make();
    expect(a.hash().total).toBe(make().hash().total);
    expect(checkInvariants({ truth: a.world.truth, log: a.world.log })).toEqual([]);
    expect(a.world.truth.ids(ORG_LOYALTY).length).toBeGreaterThan(0);
  });

  it("sin healers no cambia la vida respecto de tener solo el consejo", () => {
    const run = (extra: object) => {
      const life = Life.create(3, content, { council, ...extra });
      life.advanceTo(life.now + DAY * 20);
      return life.hash().total;
    };
    expect(run({ patientDecides: { realBonds: true, councilAuthority: {} } })).toBe(run({}));
  });

  it("councilAuthority sin realBonds o sin council se rechaza", () => {
    expect(() =>
      Life.create(3, content, { council, patientDecides: { councilAuthority: {} } }),
    ).toThrow(/realBonds/);
    expect(() =>
      Life.create(3, content, { patientDecides: { realBonds: true, councilAuthority: {} } }),
    ).toThrow(/council/);
  });
});
