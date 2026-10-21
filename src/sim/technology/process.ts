// Los procesos mortales como contenido (technology §1): formas de transformar el mundo que la ley
// permite y que alguien puede aprender. No hay árbol: un proceso es posible cuando existen los
// recursos, la energía, los conceptos y las herramientas que pide (`feasibility.ts`), no cuando se
// «investigó» lo anterior. Lo único que se ordena es lo físico: una herramienta es otro proceso
// (el arado de hierro pide saber hacer hierro) y ese grafo no puede tener ciclos.
//
// Es `TechProcessDef` y no `ProcessDef`: el segundo es el proceso del scheduler (ARCHITECTURE §6).
// Puro: el catálogo no sabe quién sabe qué (`knowledge.ts`) ni qué hay cerca (`feasibility.ts`).

import { compareStrings, contentId, defineContent, z } from "../../core/index.ts";

export const TECH_DOMAINS = [
  "agriculture",
  "husbandry",
  "food",
  "metallurgy",
  "ceramics_glass",
  "textiles",
  "construction",
  "hydraulics",
  "energy",
  "transport",
  "navigation",
  "writing",
  "printing",
  "measurement",
  "chemistry",
  "medicine",
  "military",
  "custom",
] as const;
export type TechDomain = (typeof TECH_DOMAINS)[number];

export const ENERGY_KINDS = ["muscle", "fire", "water", "wind"] as const;
export type EnergyKind = (typeof ENERGY_KINDS)[number];

export const TRANSPORT_MODES = ["foot", "pack", "cart", "river", "sea"] as const;

const Unit = z.number().min(0).max(1);

/** Un efecto sobre un sistema que ya existe (technology §4): cambia parámetros, no da bonos. */
export const TechEffect = z.discriminatedUnion("kind", [
  /** Rendimiento de un cultivo: `factor` sobre la cosecha por superficie, `labor` sobre las horas de trabajo. */
  z.strictObject({
    kind: z.literal("yield"),
    crop: contentId,
    factor: z.number().positive(),
    labor: z.number().positive().default(1),
  }),
  /** Cuánto se pudre un bien guardado (1 = igual que antes). */
  z.strictObject({ kind: z.literal("storage"), good: contentId, spoilage: z.number().positive() }),
  z.strictObject({
    kind: z.literal("transport_cost"),
    mode: z.enum(TRANSPORT_MODES),
    factor: z.number().positive(),
  }),
  z.strictObject({
    kind: z.literal("copy_cost"),
    medium: contentId,
    factor: z.number().positive(),
  }),
  /** Tierras que se vuelven cultivables (terrazas, drenaje, riego). */
  z.strictObject({ kind: z.literal("arable"), terrain: contentId }),
  z.strictObject({ kind: z.literal("material"), produces: contentId, quality: Unit }),
  /** Habilita a otro proceso: lo vuelve posible si es lo único que le faltaba. */
  z.strictObject({ kind: z.literal("craft_unlock"), process: contentId }),
]);
export type TechEffect = z.infer<typeof TechEffect>;

export const TechProcessDef = z
  .strictObject({
    id: contentId,
    name: z.string().min(1),
    domain: z.enum(TECH_DOMAINS),
    requires: z
      .strictObject({
        /** Lo que tiene que haber cerca: cobre, estaño, arcilla, fibras. Ids de recurso, no de bien. */
        resources: z.array(contentId).default([]),
        /** El calor o la fuerza: un horno que llegue a 1100° o un molino. */
        energy: z
          .strictObject({
            kind: z.enum(ENERGY_KINDS),
            /** °C que tiene que alcanzar; solo para el fuego. */
            temperature: z.number().positive().optional(),
          })
          .optional(),
        /** Ideas previas (la fermentación, el fuelle, la numeración): se saben, no se tienen. */
        concepts: z.array(contentId).default([]),
        /** Otros procesos cuyo producto se usa como herramienta. */
        tools: z.array(contentId).default([]),
        /** Personas mínimas para que funcione (un alto horno no lo opera una familia). */
        scale: z.number().int().positive().default(1),
      })
      .default({ resources: [], concepts: [], tools: [], scale: 1 }),
    /** Cuánto no se pasa como texto (skills §2.4): forja ~0,8, salar carne ~0,3. */
    tacitness: Unit,
    /** Horas de práctica con maestro para llegar a dominarlo (a talento medio). */
    learnHours: z.number().positive(),
    /** Bienes de `content/goods/` que produce, si ya hay un bien que lo represente. */
    outputs: z.array(contentId).default([]),
    effects: z.array(TechEffect).default([]),
    /** Condiciones de la ley del mundo (metaphysics); si no se cumplen, el proceso no existe. */
    worldLaw: z.array(contentId).default([]),
  })
  .superRefine((d, ctx) => {
    if (d.requires.energy?.temperature !== undefined && d.requires.energy.kind !== "fire") {
      ctx.addIssue({
        code: "custom",
        path: ["requires", "energy", "temperature"],
        message: "solo el fuego tiene temperatura",
      });
    }
    for (const [key, list] of [
      ["resources", d.requires.resources],
      ["concepts", d.requires.concepts],
      ["tools", d.requires.tools],
    ] as const) {
      if (new Set(list).size !== list.length) {
        ctx.addIssue({ code: "custom", path: ["requires", key], message: `${key} repetidos` });
      }
    }
    if (d.requires.tools.includes(d.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["requires", "tools"],
        message: "es su propia herramienta",
      });
    }
  });
export type TechProcessDef = z.infer<typeof TechProcessDef>;

export const TECH_PROCESSES = defineContent("techprocesses", TechProcessDef, (p) => [
  ...p.outputs.map((good, i) => ({ kind: "goods", id: good, at: `outputs.${i}` })),
  ...p.effects.flatMap((e, i) =>
    e.kind === "yield"
      ? [{ kind: "goods", id: e.crop, at: `effects.${i}.crop` }]
      : e.kind === "storage"
        ? [{ kind: "goods", id: e.good, at: `effects.${i}.good` }]
        : [],
  ),
]);

/**
 * Los procesos cargados. Comprueba lo que el esquema solo no ve: que las herramientas y los
 * desbloqueos existan y que el grafo de herramientas no tenga ciclos (un proceso no puede ser su
 * propia herramienta, ni siquiera de lejos).
 */
export class TechCatalog {
  readonly #byId: ReadonlyMap<string, TechProcessDef>;

  constructor(defs: readonly TechProcessDef[]) {
    this.#byId = new Map(
      [...defs].sort((a, b) => compareStrings(a.id, b.id)).map((d) => [d.id, d]),
    );
    const problems: string[] = [];
    for (const d of this.#byId.values()) {
      for (const t of d.requires.tools) {
        if (!this.#byId.has(t)) problems.push(`${d.id}: la herramienta ${t} no existe`);
      }
      for (const e of d.effects) {
        if (e.kind === "craft_unlock" && !this.#byId.has(e.process)) {
          problems.push(`${d.id}: desbloquea ${e.process}, que no existe`);
        }
      }
    }
    if (problems.length === 0) {
      for (const d of this.#byId.values()) {
        if (this.toolChain(d.id).includes(d.id)) problems.push(`${d.id}: ciclo de herramientas`);
      }
    }
    if (problems.length > 0) throw new RangeError(problems.join("; "));
  }

  get(id: string): TechProcessDef | undefined {
    return this.#byId.get(id);
  }

  /** Todos, ordenados por id. */
  get all(): readonly TechProcessDef[] {
    return [...this.#byId.values()];
  }

  byDomain(domain: TechDomain): readonly TechProcessDef[] {
    return this.all.filter((d) => d.domain === domain);
  }

  /** Las herramientas de un proceso, y las de sus herramientas, sin repetir y ordenadas. */
  toolChain(id: string): readonly string[] {
    const seen = new Set<string>();
    const stack = [...(this.#byId.get(id)?.requires.tools ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(this.#byId.get(next)?.requires.tools ?? []));
    }
    return [...seen].sort(compareStrings);
  }
}
