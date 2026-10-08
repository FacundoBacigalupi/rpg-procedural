import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent, type ParcelId } from "../../core/index.ts";
import {
  BUILDING,
  canDo,
  checkInvariants,
  ENTITY,
  mistaken,
  ownerOf,
  PARCEL,
  PARCEL_BELIEFS,
  type Parcel,
  type ParcelBeliefs,
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

describe("las parcelas de la aldea inicial", () => {
  const w = Life.create(7, content).world;
  const parcels = w.truth.ids(PARCEL) as ParcelId[];
  const get = (id: ParcelId) => w.truth.get(PARCEL, id) as Parcel;

  it("hay una casa por hogar vivo y cada parcela sale de un evento con causa", () => {
    const houses = parcels.filter((p) => get(p).landUse === "house_plot");
    const homes = new Set(
      w.truth.ids(BUILDING).flatMap((b) => w.truth.get(BUILDING, b)?.household ?? []),
    );
    expect(houses.length).toBe(homes.size);
    for (const id of parcels) {
      const origin = w.truth.get(ENTITY, id)?.originEventId;
      const e = origin ? w.log.get(origin) : undefined;
      expect(e?.kind).toBe("property.parcel_set");
      expect(e?.causes.length).toBeGreaterThan(0);
    }
  });

  it("toda parcela tiene dueño y los invariantes siguen", () => {
    for (const id of parcels) expect(ownerOf(get(id)), id).not.toBeNull();
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  });

  it("quien usa tierra ajena no puede venderla, y los que no presenciaron se equivocan", () => {
    const shared = parcels.filter((p) => get(p).rights.length > 1);
    const beliefs = new Map(
      living(w.truth).map((a) => [a as AgentId, w.truth.get(PARCEL_BELIEFS, a) as ParcelBeliefs]),
    );
    for (const id of shared) {
      const user = get(id).rights.find((r) => !r.incidents.includes("alienate"));
      expect(user && canDo(get(id), user.holder, "alienate")).toBe(false);
    }
    const wrong = shared.flatMap((id) => mistaken(get(id), id, beliefs));
    if (shared.length > 0) expect(wrong.length).toBeGreaterThan(0);
  });

  it("cada uno sabe lo suyo", () => {
    for (const a of living(w.truth)) {
      const b = w.truth.get(PARCEL_BELIEFS, a);
      expect(b?.beliefs.length).toBe(parcels.length);
      const home = w.truth.get(PERSON, a)?.household;
      for (const x of b?.beliefs ?? []) {
        if (get(x.parcel).rights.some((r) => r.holder === home)) {
          expect(x.holder).toBe(ownerOf(get(x.parcel)));
        }
      }
    }
  });

  it("es determinista", () => {
    const again = Life.create(7, content).world;
    const dump = (x: typeof w) => parcels.map((p) => JSON.stringify(x.truth.get(PARCEL, p)));
    expect(dump(again)).toEqual(dump(w));
  }, 60_000);
});
