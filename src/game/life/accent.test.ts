import { describe, expect, it } from "vitest";
import { type AgentId, type Event, Rng } from "../../core/index.ts";
import {
  ACCENT_FEATURES,
  type Accent,
  COMMUNITY_ACCENT,
  type CommunityAccent,
  WorldTruth,
} from "../../sim/index.ts";
import { ACCENT_PROCESS, accentProcess, KNOWN_ACCENTS } from "./accent.ts";
import { ASCRIBED_GROUPS } from "./identity.ts";

const flat = (x: number): Accent =>
  Object.fromEntries(ACCENT_FEATURES.map((f) => [f, x])) as unknown as Accent;
const player = "agent:1" as AgentId;
const stranger = "agent:2" as AgentId;
const here = "settlement:1";
const there = "settlement:2";

function setup() {
  const t = new WorldTruth();
  for (const [id, x] of [
    [here, 0.2],
    [there, 0.8],
  ] as const) {
    t.set(
      COMMUNITY_ACCENT,
      id as never,
      {
        language: "l",
        accent: flat(x),
        parent: flat(0.5),
        generations: 3,
        originEventId: "event:0",
      } as unknown as CommunityAccent,
    );
  }
  t.set(KNOWN_ACCENTS, player, { known: [{ community: here, accent: flat(0.2) }] });
  return t;
}
const speak = {
  id: "event:5",
  tick: 1,
  kind: "action.speak",
  actors: [player, stranger],
} as unknown as Event;
const run = (t: WorldTruth, nativeOf: (t: unknown, w: AgentId) => Accent) =>
  accentProcess({ player, nativeOf: nativeOf as never }).run({
    now: 1,
    recent: [speak],
    truth: t,
    rng: Rng.root(7),
  } as never);

describe("el acento en la charla", () => {
  it("el proceso tiene su id", () => {
    expect(ACCENT_PROCESS).toBe("life.accent");
  });

  it("el de la misma aldea se reconoce y queda como creencia de origen del personaje", () => {
    const out = run(setup(), () => flat(0.2));
    const ch = (out.changes ?? []) as unknown as { table: string; value: any }[];
    const belief = ch.find((c) => c.table === ASCRIBED_GROUPS.name)?.value.about[stranger];
    expect(belief?.group).toBe(here);
    expect(belief?.basis).toEqual(["speech"]);
  });

  it("uno de otro lado no se ubica: no hay creencia de origen y su voz pasa a conocida", () => {
    const out = run(setup(), (_t, w) => (w === stranger ? flat(0.8) : flat(0.2)));
    const ch = (out.changes ?? []) as unknown as { table: string; id: string; value: any }[];
    expect(ch.some((c) => c.table === ASCRIBED_GROUPS.name)).toBe(false);
    const mine = ch.find((c) => c.table === KNOWN_ACCENTS.name && c.id === player);
    expect(
      mine?.value.known.some((k: { community: string }) => k.community === `heard:${stranger}`),
    ).toBe(true);
  });

  it("es determinista", () => {
    const a = JSON.stringify(run(setup(), () => flat(0.8)).changes);
    const b = JSON.stringify(run(setup(), () => flat(0.8)).changes);
    expect(a).toBe(b);
  });
});
