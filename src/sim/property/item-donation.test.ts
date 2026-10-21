import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { itemDonationFor } from "./item-donation.ts";
import { type ItemRight, type ItemTransferSnapshot, transferItem } from "./item-transfer.ts";

const giver = makeId("agent", 1);
const to = makeId("agent", 2);
const other = makeId("agent", 3);
const sword = makeId("item", 1);
const origin = makeId("event", 1);
const cause = makeId("event", 2);
const right: ItemRight = {
  key: "ownership",
  holder: giver,
  incidents: ["possess", "use", "alienate"],
  tenure: "personal",
  record: { kind: "custom", witnesses: [], event: origin },
  norm: "village",
  originEventId: origin,
  share: 0.5,
  encumbrances: [{ key: "pledge", originEventId: origin, preventsAlienation: false }],
};
const run = (rights: ItemRight[]) => {
  const snapshot: ItemTransferSnapshot = {
    entity: { id: sword, originEventId: origin, createdAt: 0 },
    possession: giver,
    rights,
  };
  const donation = itemDonationFor({ rights, giver, recipient: to, cause });
  return transferItem({
    item: sword,
    snapshot,
    from: { holder: giver, exists: true, reachable: true },
    to: { holder: to, exists: true, reachable: true },
    operation: "give",
    cause,
    ...(donation ? { donation } : {}),
  });
};

describe("itemDonationFor", () => {
  it("dona el haz del que da conservando cuota y cargas; los ajenos quedan", () => {
    const r = run([right, { ...right, key: "coowner", holder: other }]);
    expect(r).toMatchObject({ accepted: true, donation: { transferred: true } });
    if (!r.accepted) return;
    expect(r.rights[0]).toMatchObject({
      holder: to,
      share: 0.5,
      encumbrances: right.encumbrances,
      record: { event: cause },
    });
    expect(r.rights[1]?.holder).toBe(other);
  });
  it("una carga que impide enajenar: entrega física sí, donación no", () => {
    const r = run([{ ...right, encumbrances: [{ key: "lien", originEventId: origin }] }]);
    expect(r).toMatchObject({
      accepted: true,
      possession: to,
      donation: { transferred: false, reason: "encumbered" },
    });
    if (r.accepted) expect(r.rights[0]?.holder).toBe(giver);
  });
  it("sin alienate no dona", () => {
    const r = run([{ ...right, incidents: ["possess", "use"] }]);
    expect(r).toMatchObject({ accepted: true, donation: { reason: "not_alienable" } });
  });
  it("constancia con testigos: el receptor la presencia", () => {
    const d = itemDonationFor({
      rights: [{ ...right, record: { kind: "witnesses", witnesses: [other], event: origin } }],
      giver,
      recipient: to,
      cause,
    });
    expect(d).toMatchObject({
      formalitiesSatisfied: true,
      record: { kind: "witnesses", witnesses: [giver, to], event: cause },
    });
  });
  it("sin haces del que da o receptor no agente: no hay donación", () => {
    expect(itemDonationFor({ rights: [], giver, recipient: to, cause })).toBeUndefined();
    expect(
      itemDonationFor({ rights: [{ ...right, holder: other }], giver, recipient: to, cause }),
    ).toBeUndefined();
    expect(
      itemDonationFor({ rights: [right], giver, recipient: makeId("household", 1), cause }),
    ).toBeUndefined();
  });
  it("es determinista", () => {
    const a = itemDonationFor({ rights: [right], giver, recipient: to, cause });
    expect(a).toEqual(itemDonationFor({ rights: [right], giver, recipient: to, cause }));
  });
});
