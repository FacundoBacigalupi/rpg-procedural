import { describe, expect, it } from "vitest";
import { externalAccount, holderAccount, Ledger, ledgerUnit, makeId } from "../../core/index.ts";
import { burnCultLot, type CultMaterial, CultRecipe, craftCultLot } from "./cult.ts";

const fiber = ledgerUnit("good:fiber");
const wax = ledgerUnit("good:wax");
const owner = holderAccount(makeId("agent", 1));
const productAccount = holderAccount({
  kind: "building",
  building: makeId("building", 1),
  space: "cult-lot-3",
});
const ash = externalAccount("offering-ash");
const event = makeId("event", 2);
const recipe = CultRecipe.parse({
  id: "wax-candle",
  product: "candle",
  inputs: [
    { material: "wax", grams: 90 },
    { material: "fiber", grams: 10 },
  ],
});
const materials = [
  {
    id: makeId("lot", 1),
    material: "wax",
    unit: wax,
    from: owner,
    originEventId: makeId("event", 1),
  },
  {
    id: makeId("lot", 2),
    material: "fiber",
    unit: fiber,
    from: owner,
    originEventId: makeId("event", 1),
  },
] as const;
function setup() {
  const ledger = new Ledger({ externals: { seed: [fiber, wax], "offering-ash": [fiber, wax] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [fiber, wax].map((unit) => ({
      from: externalAccount("seed"),
      to: owner,
      unit,
      amount: 100,
    })),
  });
  return ledger;
}
function craft(ledger = setup(), inputs: readonly CultMaterial[] = materials) {
  return craftCultLot(recipe, inputs, makeId("lot", 3), productAccount, event, 1, ledger);
}

describe("lotes materiales de culto", () => {
  it.each(["incense", "offering_paper", "candle", "tablet"] as const)(
    "admite %s sin registrar contenido global",
    (product) => {
      expect(CultRecipe.parse({ ...recipe, product }).product).toBe(product);
    },
  );
  it("conserva materia y origen al fabricar y quemar; rechaza una segunda quema", () => {
    const ledger = setup();
    const { lot, posting } = craft(ledger);
    expect(ledger.balance(owner, wax)).toBe(100);
    expect(lot.originEventId).toBe(event);
    expect(lot.materials.map((m) => m.originEventId)).toEqual([
      makeId("event", 1),
      makeId("event", 1),
    ]);
    ledger.post(posting);
    expect(ledger.total(wax)).toBe(100);
    expect(ledger.balance(productAccount, wax)).toBe(90);
    const burned = burnCultLot(lot, ash, makeId("event", 3), 2, ledger);
    ledger.post(burned);
    expect(ledger.balance(ash, wax)).toBe(90);
    expect(ledger.balance(ash, fiber)).toBe(10);
    expect(ledger.holdings(productAccount)).toEqual([]);
    expect(() => burnCultLot(lot, ash, makeId("event", 4), 3, ledger)).toThrow();
    expect(Ledger.fromJournal(ledger.config, ledger.journal()).journal()).toEqual(ledger.journal());
  });
  it("ordena canónicamente sin modificar los insumos", () => {
    expect(craft().posting).toEqual(craft(setup(), [...materials].reverse()).posting);
    expect(materials[0]?.material).toBe("wax");
  });
  it.each([NaN, Infinity, -1, 0.5])("rechaza tick no canónico %s", (tick) => {
    expect(() =>
      craftCultLot(recipe, materials, makeId("lot", 3), productAccount, event, tick, setup()),
    ).toThrow();
  });
  it.each([NaN, Infinity, 0, -1, 0.5])("rechaza gramos no conservables %s", (grams) => {
    expect(CultRecipe.safeParse({ ...recipe, inputs: [{ material: "wax", grams }] }).success).toBe(
      false,
    );
  });
  it("no conserva alias con la receta ni los objetos materiales del llamador", () => {
    const inputs = materials.map((m) => ({ ...m, material: String(m.material) }));
    const { lot, posting } = craft(setup(), inputs);
    expect(lot.materials[0]).not.toBe(inputs[1]);
    const changed = inputs[1];
    if (!changed) throw new Error("falta insumo de la prueba");
    changed.material = "changed";
    expect(lot.materials[0]?.material).toBe("fiber");
    expect(posting.transfers[0]?.amount).toBe(10);
  });
  it("no permite quemar fracciones ni duplicar insumos de un lote reconstruido", () => {
    const ledger = setup();
    const { lot, posting } = craft(ledger);
    ledger.post(posting);
    const material = lot.materials[0] as (typeof lot.materials)[number];
    expect(() =>
      burnCultLot({ ...lot, materials: [{ ...material, grams: 0.5 }] }, ash, event, 2, ledger),
    ).toThrow();
    expect(() =>
      burnCultLot({ ...lot, materials: [material, material] }, ash, event, 2, ledger),
    ).toThrow();
  });
  it("rechaza insumos insuficientes o repetidos sin mutar el ledger", () => {
    const ledger = setup();
    const before = [...ledger.journal()];
    expect(() => craft(ledger, [materials[0], materials[0]])).toThrow();
    expect(() =>
      craftCultLot(
        { ...recipe, inputs: [{ material: "wax", grams: 101 }] },
        [materials[0]],
        makeId("lot", 3),
        productAccount,
        event,
        1,
        ledger,
      ),
    ).toThrow();
    expect(ledger.journal()).toEqual(before);
  });
  it("preview agrega el gasto cuando dos materiales comparten unidad y cuenta", () => {
    const ledger = setup();
    expect(() =>
      craftCultLot(
        {
          ...recipe,
          inputs: [
            { material: "wax", grams: 80 },
            { material: "fiber", grams: 30 },
          ],
        },
        materials.map((m) => ({ ...m, unit: wax })),
        makeId("lot", 3),
        productAccount,
        event,
        1,
        ledger,
      ),
    ).toThrow();
  });
});
