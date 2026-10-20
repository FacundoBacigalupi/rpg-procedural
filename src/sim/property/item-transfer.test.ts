import { describe, expect, it } from "vitest";
import { type HolderRef, makeId } from "../../core/index.ts";
import {
  type ItemRight,
  type ItemTransferInput,
  type ItemTransferSnapshot,
  transferItem,
} from "./item-transfer.ts";

const owner = makeId("agent", 1);
const recipient = makeId("agent", 2);
const coowner = makeId("agent", 3);
const sword = makeId("item", 1);
const origin = makeId("event", 1);
const cause = makeId("event", 2);
const right: ItemRight = {
  key: "ownership",
  holder: owner,
  incidents: ["possess", "use", "alienate"],
  tenure: "personal",
  record: { kind: "custom", witnesses: [], event: origin },
  norm: "village",
  originEventId: origin,
  share: 0.5,
  encumbrances: [],
};
const snapshot: ItemTransferSnapshot = {
  entity: { id: sword, originEventId: origin, createdAt: 0 },
  possession: owner,
  rights: [
    right,
    { ...right, key: "coowner", holder: coowner },
    { ...right, key: "other-norm", norm: "clan", share: 1 },
  ],
};
function input(extra: Partial<ItemTransferInput> = {}): ItemTransferInput {
  return {
    item: sword,
    snapshot,
    from: { holder: owner, exists: true, reachable: true },
    to: { holder: recipient, exists: true, reachable: true },
    operation: "take",
    cause,
    ...extra,
  };
}
const donation = {
  norm: "village",
  rightKeys: ["ownership"],
  formalitiesSatisfied: true,
  record: { kind: "witnesses" as const, witnesses: [coowner], event: cause },
};

function freezeDeep(value: unknown): void {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
}

describe("transferencia pura de objetos con identidad", () => {
  it.each([makeId("household", 1), makeId("org", 1)])(
    "dona el haz a un titular colectivo %s sin alterar la otra cuota",
    (holder) => {
      const result = transferItem(
        input({
          operation: "give",
          donation,
          to: { holder, exists: true, reachable: true },
        }),
      );
      expect(result).toMatchObject({
        accepted: true,
        possession: holder,
        donation: { transferred: true },
      });
      if (!result.accepted) throw new Error("entrega rechazada");
      expect(result.rights[0]?.holder).toBe(holder);
      expect(result.rights.slice(1)).toEqual(snapshot.rights.slice(1));
    },
  );
  it.each(["take", "give"] as const)("%s cambia posesión sin regalar derechos", (operation) => {
    const result = transferItem(input({ operation }));
    expect(result).toMatchObject({
      accepted: true,
      item: sword,
      originEventId: origin,
      cause,
      previousPossession: owner,
      possession: recipient,
      donation: { transferred: false },
    });
    if (result.accepted) expect(result.rights).toEqual(snapshot.rights);
  });

  it("dona solo el haz elegido, conserva cuotas, otras normas y origen", () => {
    const result = transferItem(input({ operation: "give", donation }));
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("entrega rechazada");
    expect(result.donation).toEqual({ transferred: true, rightKeys: ["ownership"] });
    expect(result.rights[0]).toEqual({ ...right, holder: recipient, record: donation.record });
    expect(result.rights.slice(1)).toEqual(snapshot.rights.slice(1));
    expect(result.rights).toHaveLength(snapshot.rights.length);
  });

  it.each([undefined, true, false])("carga con prohibición %s conserva regla y carga", (block) => {
    const encumbrances = [
      {
        key: "pledge",
        originEventId: origin,
        ...(block === undefined ? {} : { preventsAlienation: block }),
      },
    ];
    const rights = [{ ...right, encumbrances }];
    const result = transferItem(
      input({
        snapshot: { ...snapshot, rights },
        operation: "give",
        donation,
      }),
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("entrega rechazada");
    expect(result.possession).toBe(recipient);
    expect(result.rights[0]?.encumbrances).toEqual(encumbrances);
    expect(result.donation).toEqual(
      block === false
        ? { transferred: true, rightKeys: ["ownership"] }
        : { transferred: false, reason: "encumbered" },
    );
    if (block !== false) expect(result.rights).toEqual(rights);
  });

  it.each([
    { ...donation, formalitiesSatisfied: false },
    { ...donation, record: { ...donation.record, event: origin } },
    { ...donation, norm: "foreign" },
    { ...donation, rightKeys: ["coowner"] },
    { ...donation, rightKeys: ["missing"] },
    { ...donation, rightKeys: ["ownership", "ownership"] },
    { ...donation, rightKeys: [] },
  ])("donación inválida conserva derechos y permite entrega", (gift) => {
    const result = transferItem(input({ operation: "give", donation: gift }));
    expect(result).toMatchObject({ accepted: true, donation: { transferred: false } });
    if (result.accepted) expect(result.rights).toEqual(snapshot.rights);
  });

  it("sin enajenación no dona; una toma tampoco se convierte en donación", () => {
    const result = transferItem(
      input({
        operation: "give",
        donation,
        snapshot: { ...snapshot, rights: [{ ...right, incidents: ["use"] }] },
      }),
    );
    expect(result).toMatchObject({
      accepted: true,
      donation: { transferred: false, reason: "not_alienable" },
    });
    expect(transferItem(input({ donation }))).toMatchObject({
      accepted: true,
      donation: { transferred: false, reason: "not_a_gift" },
    });
  });

  it.each<HolderRef | null>([null, owner, { kind: "place", place: makeId("place", 1) }])(
    "toma del suelo, cadáver o lugar existente sin extinguir derechos",
    (holder) => {
      const result = transferItem(
        input({
          snapshot: { ...snapshot, possession: holder },
          from: { holder, exists: true, reachable: true, endedAt: 0 },
        }),
      );
      expect(result).toMatchObject({
        accepted: true,
        possession: recipient,
        rights: snapshot.rights,
      });
    },
  );

  it("entrega a un lugar no exige que sea un agente vivo", () => {
    const holder = { kind: "building", building: makeId("building", 1), space: "store" } as const;
    expect(transferItem(input({ to: { holder, exists: true, reachable: true } }))).toMatchObject({
      accepted: true,
      possession: holder,
    });
  });

  it.each([
    { snapshot: undefined, reason: "missing_item" },
    { item: makeId("item", 2), reason: "missing_item" },
    { snapshot: { ...snapshot, entity: { ...snapshot.entity, endedAt: 0 } }, reason: "ended_item" },
    { from: { holder: coowner, exists: true, reachable: true }, reason: "stale_possession" },
    { from: { holder: owner, exists: false, reachable: true }, reason: "unavailable_source" },
    { from: { holder: owner, exists: true, reachable: false }, reason: "unavailable_source" },
    {
      to: { holder: recipient, exists: false, reachable: true },
      reason: "unavailable_destination",
    },
    {
      to: { holder: recipient, exists: true, reachable: true, endedAt: 0 },
      reason: "unavailable_destination",
    },
    { to: { holder: null, exists: true, reachable: true }, reason: "unavailable_destination" },
    {
      to: { holder: recipient, exists: true, reachable: false },
      reason: "unavailable_destination",
    },
    { to: { holder: owner, exists: true, reachable: true }, reason: "same_holder" },
  ])("rechazo físico $reason sin cambios propuestos", ({ reason, ...extra }) => {
    expect(transferItem(input(extra))).toEqual({ accepted: false, reason });
  });

  it.each([0, -1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rechaza cuota inválida %s",
    (share) => {
      expect(
        transferItem(input({ snapshot: { ...snapshot, rights: [{ ...right, share }] } })),
      ).toEqual({ accepted: false, reason: "invalid_snapshot" });
    },
  );

  it("determinismo e inmutabilidad incluso para entradas congeladas", () => {
    const request = input({ operation: "give", donation });
    const before = structuredClone(request);
    freezeDeep(request);
    expect(transferItem(request)).toEqual(transferItem(request));
    expect(request).toEqual(before);
    expect(transferItem({ ...request, from: { ...request.from, reachable: false } })).toEqual({
      accepted: false,
      reason: "unavailable_source",
    });
    expect(request).toEqual(before);
  });
});
