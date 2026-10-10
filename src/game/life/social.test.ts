import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EventId, holderAccount, loadContent } from "../../core/index.ts";
import { COPPER, checkInvariants, PERSON, STATUS } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { characterPanel } from "./panels.ts";
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

describe("el estatus en la aldea inicial", () => {
  const life = Life.create(7, content);
  const w = life.world;

  it("todo vivo tiene estatus, con su causa en el registro, y toda la casa el mismo", () => {
    const byHouse = new Map<string, Set<string>>();
    for (const id of living(w.truth)) {
      const s = w.truth.get(STATUS, id);
      expect(s, id).toBeDefined();
      expect(w.log.get(s?.originEventId as EventId)?.kind).toBe("social.status_set");
      const house = w.truth.get(PERSON, id)?.household as string;
      byHouse.set(house, (byHouse.get(house) ?? new Set()).add(s?.status as string));
    }
    for (const set of byHouse.values()) expect(set.size).toBe(1);
  });

  it("hay un terrateniente más rico que la casa común, y los invariantes siguen", () => {
    const rows = living(w.truth).map((id) => ({
      status: w.truth.get(STATUS, id)?.status,
      coins: w.ledger.balance(holderAccount(id as never), COPPER),
    }));
    const top = rows.filter((r) => r.status === "landholder");
    const common = rows.filter((r) => r.status === "peasant");
    if (top.length > 0 && common.length > 0) {
      expect(top[0]?.coins).toBeGreaterThan(common[0]?.coins as number);
    }
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  });

  it("el personaje sabe cuál es su lugar", () => {
    const mine = w.statuses.find((d) => d.id === w.truth.get(STATUS, w.player)?.status);
    expect(characterPanel(w).status).toBe(mine?.name);
  });

  it("la reputación del panel es opt-in y sin fama no aparece", () => {
    expect(characterPanel(w).reputation).toBeUndefined();
    expect(characterPanel(w, { reputation: true }).reputation).toBeUndefined();
  });

  it("es determinista", () => {
    const a = Life.create(7, content).world;
    const pick = (x: typeof a) => living(x.truth).map((id) => x.truth.get(STATUS, id)?.status);
    expect(pick(a)).toEqual(pick(w));
  }, 60_000);
});
