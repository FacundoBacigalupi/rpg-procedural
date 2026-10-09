import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  EventLog,
  IdAllocator,
  loadContent,
  makeId,
  type PlaceRef,
} from "../../core/index.ts";
import { CONTENT_KINDS } from "../content.ts";
import { ENTITY, WorldTruth } from "../world/index.ts";
import { CONCEPTS, LANGUAGES } from "./defs.ts";
import { generateLanguage } from "./language.ts";
import { speakWord, tabooOf } from "./register.ts";
import {
  BORN_TABOO,
  bornTabooDefs,
  bornTabooSeverity,
  communityWord,
  declareBornTaboo,
  LAPSE_YEARS,
  LEXICALIZE_MIN_YEARS,
  LEXICALIZE_USES,
  noteCircumlocution,
  pickCircumlocution,
  settleBornTaboos,
} from "./taboo-birth.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "llm" ? [] : sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(CONTENT_KINDS, sources("content"));
const spec = content.get(LANGUAGES, "village.hills");
if (!spec) throw new Error("falta la lengua de la aldea");
const lang = generateLanguage(7, spec, content.all(CONCEPTS));

const YEAR = 365 * 86_400;
const community = makeId("settlement", 1);
const place: PlaceRef = { kind: "settlement", settlement: community };

function world() {
  const truth = new WorldTruth();
  const ids = new IdAllocator();
  const log = new EventLog();
  const genesis = ids.next("event");
  const died = ids.next("event");
  for (const [id, kind] of [
    [genesis, "genesis"],
    [died, "body.died"],
  ] as const) {
    log.append({
      id,
      tick: 0,
      kind,
      actors: [],
      place,
      data: null,
      emissions: null,
      causes: [{ kind: "seed" }],
      resolution: "local",
    });
  }
  const dead = ids.next("agent");
  truth.set(ENTITY, dead, { id: dead, originEventId: genesis, createdAt: 0 });
  const declare = () =>
    declareBornTaboo(truth, ids, log, {
      subject: dead,
      community,
      language: lang.id,
      kind: "dead",
      word: ["bright", "stone"],
      circumlocution: ["old", "mountain"],
      severity: 0.6,
      now: 100,
      place,
      causeEvent: died,
    });
  return { truth, ids, log, dead, died, declare };
}

describe("tabúes que nacen en juego", () => {
  it("nace de un evento con causa en la muerte y alimenta speakWord", () => {
    const w = world();
    const row = w.declare();
    const e = w.log.get(row.originEventId);
    expect(e?.kind).toBe("language.taboo_born");
    expect(e?.causes).toEqual([{ kind: "event", event: w.died }]);
    const defs = bornTabooDefs(w.truth, community, "village", 100);
    expect(defs).toHaveLength(1);
    expect(tabooOf(defs, "village", ["bright", "stone"])).toBeDefined();
    const said = speakWord(lang, defs, "village", ["bright", "stone"], true);
    expect(said.via).toBe("circumlocution");
    expect(said.text).toBe(lang.compound(["old", "mountain"]).text);
    expect(speakWord(lang, defs, "village", ["bright", "stone"], false).broke).toBeDefined();
  });

  it("declarar dos veces no duplica y exige ficha del sujeto", () => {
    const w = world();
    expect(w.declare()).toBe(w.declare());
    expect(w.truth.ids(BORN_TABOO)).toHaveLength(1);
    const ghost = w.ids.next("agent");
    expect(() =>
      declareBornTaboo(w.truth, w.ids, w.log, {
        subject: ghost,
        community,
        language: lang.id,
        kind: "dead",
        word: ["old"],
        circumlocution: ["high"],
        severity: 0.5,
        now: 0,
        place,
        causeEvent: w.died,
      }),
    ).toThrow();
  });

  it("la severidad se apaga con los años", () => {
    const w = world();
    const row = w.declare();
    expect(bornTabooSeverity(row, 100)).toBeCloseTo(0.6);
    expect(bornTabooSeverity(row, 100 + 30 * YEAR)).toBeLessThan(0.6);
    expect(bornTabooSeverity(row, 100 + LAPSE_YEARS * YEAR)).toBeGreaterThan(0);
  });

  it("el rodeo sostenido se vuelve la palabra normal y la vieja se pierde", () => {
    const w = world();
    w.declare();
    noteCircumlocution(w.truth, w.dead, LEXICALIZE_USES);
    const place_ = () => place;
    expect(settleBornTaboos(w.truth, w.ids, w.log, 100 + 5 * YEAR, place_)).toEqual([]);
    const at = 100 + LEXICALIZE_MIN_YEARS * YEAR;
    expect(settleBornTaboos(w.truth, w.ids, w.log, at, place_)).toEqual([w.dead]);
    const row = w.truth.get(BORN_TABOO, w.dead);
    expect(row?.status).toBe("lexicalized");
    expect(bornTabooDefs(w.truth, community, "village", at)).toHaveLength(0);
    const word = communityWord(lang, w.truth, community, ["bright", "stone"]);
    expect(word.via).toBe("lexicalized");
    expect(word.text).toBe(lang.compound(["old", "mountain"]).text);
    expect(communityWord(lang, w.truth, community, ["old"]).via).toBe("plain");
  });

  it("si casi nadie lo sostuvo, se olvida sin cambiar la lengua", () => {
    const w = world();
    w.declare();
    const at = 100 + LAPSE_YEARS * YEAR;
    expect(settleBornTaboos(w.truth, w.ids, w.log, at, () => place)).toEqual([w.dead]);
    expect(w.truth.get(BORN_TABOO, w.dead)?.status).toBe("lapsed");
    expect(communityWord(lang, w.truth, community, ["bright", "stone"]).via).toBe("plain");
  });

  it("elige el primer rodeo que la lengua puede decir", () => {
    expect(pickCircumlocution(lang, [["no_existe"], ["old", "mountain"]])).toEqual([
      "old",
      "mountain",
    ]);
    expect(pickCircumlocution(lang, [["no_existe"]])).toBeUndefined();
  });
});
