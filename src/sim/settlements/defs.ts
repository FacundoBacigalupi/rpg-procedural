// El contenido de settlements (settlements §5, §8): materiales con origen, tipos de edificio con
// sus cuartos y componentes, y obras de infraestructura (pozo, camino). Los números son punto de
// partida de calibración; lo que nace de ellos (qué casa tiene cada hogar, de qué está hecha)
// sale de la sembradora, no de acá.

import { contentId, defineContent, z } from "../../core/index.ts";
import { BARRIERS, SPACE_KINDS } from "../world/index.ts";

/** De dónde sale un material: lo que la aldea tenga cerca decide cuáles puede usar. */
export const MATERIAL_SOURCES = ["forest", "fields", "ground"] as const;

/** Partes de edificio donde el material sirve (sin lista: cualquiera). */
export const BUILDING_PARTS = ["foundation", "walls", "roof", "door"] as const;

export const MaterialDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  source: z.enum(MATERIAL_SOURCES),
  /** En qué partes del edificio se puede usar (alternativas al reconstruir distinto). */
  parts: z.array(z.enum(BUILDING_PARTS)).min(1).optional(),
  /** Gramos por metro cuadrado de componente. */
  gramsPerM2: z.number().int().positive(),
  /** Desgaste por año sin mantenimiento (fracción que se pierde, exponencial). */
  decayPerYear: z.number().min(0).max(1),
  /** La barrera que hace una pared de este material entre espacios (perception §3). */
  wall: z.enum(BARRIERS),
  /** Cuánto alimenta un fuego (0 = no arde); entra en el frente de fuego (Fase 3). */
  fuel: z.number().min(0),
  /** Cobre por kilo puesto en la obra (jornales y acarreo incluidos); sin él, `DEFAULT_MATERIAL_COPPER_PER_KG`. */
  priceCopperPerKg: z.number().positive().optional(),
});
export type MaterialDef = z.infer<typeof MaterialDef>;
export const MATERIALS = defineContent("materials", MaterialDef);

const RoomDef = z.strictObject({
  id: contentId,
  kind: z.enum(SPACE_KINDS),
  area: z.number().positive(),
  daylight: z.number().min(0).max(1),
  lamp: z.number().min(0).max(1),
  noise: z.number().min(0),
});

const ComponentDef = z.strictObject({
  part: z.enum(BUILDING_PARTS),
  /** Metros cuadrados del componente. */
  area: z.number().positive(),
  /** Con qué se puede hacer, con peso relativo; solo entran los materiales que hay cerca. */
  materials: z.array(z.strictObject({ material: contentId, weight: z.number().positive() })).min(1),
});

export const BuildingDef = z
  .strictObject({
    id: contentId,
    name: z.string().min(1),
    /** Quién lo tiene: el hogar que vive ahí o la comunidad. */
    tenure: z.enum(["household", "community"]),
    /** Vivienda: el de más `minMembers` que le cabe al hogar. */
    minMembers: z.number().int().min(1).optional(),
    /** Comunal: uno cada tantas personas (al menos uno). */
    perPeople: z.number().int().min(1).optional(),
    /** Cada cuántos años se repara en promedio. */
    repairYears: z.number().positive(),
    /** El primer cuarto es el principal: donde vive el hogar. Un patio es por donde se entra. */
    rooms: z.array(RoomDef).min(1),
    components: z.array(ComponentDef).min(1),
  })
  .superRefine((d, ctx) => {
    const ids = d.rooms.map((r) => r.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["rooms"], message: "cuartos repetidos" });
    }
    if (d.tenure === "household" && d.minMembers === undefined) {
      ctx.addIssue({ code: "custom", path: ["minMembers"], message: "falta minMembers" });
    }
    if (d.tenure === "community" && d.perPeople === undefined) {
      ctx.addIssue({ code: "custom", path: ["perPeople"], message: "falta perPeople" });
    }
  });
export type BuildingDef = z.infer<typeof BuildingDef>;
export const BUILDING_TYPES = defineContent("buildings", BuildingDef, (b) =>
  b.components.flatMap((c, i) =>
    c.materials.map((m, j) => ({
      kind: "materials",
      id: m.material,
      at: `components.${i}.materials.${j}.material`,
    })),
  ),
);

const WorkBase = { id: contentId, name: z.string().min(1) };
export const WorkDef = z.discriminatedUnion("kind", [
  z.strictObject({
    ...WorkBase,
    kind: z.literal("well"),
    material: contentId,
    grams: z.number().int().positive(),
    litersPerDay: z.number().positive(),
    repairYears: z.number().positive(),
    decayPerYear: z.number().min(0).max(1),
  }),
  z.strictObject({
    ...WorkBase,
    kind: z.literal("road"),
    repairYears: z.number().positive(),
    decayPerYear: z.number().min(0).max(1),
  }),
]);
export type WorkDef = z.infer<typeof WorkDef>;
export const WORK_TYPES = defineContent("works", WorkDef, (w) =>
  w.kind === "well" ? [{ kind: "materials", id: w.material, at: "material" }] : [],
);
