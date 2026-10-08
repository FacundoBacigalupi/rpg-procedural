// Parámetros demográficos de una población (family-lineage §3, §11; simulation §5 modo agregado):
// mortalidad por edad y sexo, fecundidad de las casadas, uniones y la fundación de una aldea. Son
// contenido: cada mundo y cada cultura los calibra en `content/demography/`.

import { contentId, defineContent, z } from "../../core/index.ts";

const Prob = z.number().min(0).max(1);
const AgeRange = z
  .strictObject({ min: z.number().int().min(0), max: z.number().int().min(0) })
  .refine((r) => r.min <= r.max, "min > max");

/** Tramos por edad: cada uno vale desde `fromAge` hasta el siguiente. */
const ascending = (xs: readonly { readonly fromAge: number }[]) =>
  xs.length > 0 && xs.every((x, i) => i === 0 || x.fromAge > (xs[i - 1]?.fromAge ?? 0));

export const Demography = z.strictObject({
  id: contentId,
  species: contentId,
  name: z.string().min(1),
  /** Fracción de varones al nacer. */
  maleBirthRatio: Prob,
  /** Probabilidad de morir en el año, por edad cumplida al empezarlo. */
  mortality: z
    .array(z.strictObject({ fromAge: z.number().int().min(0), female: Prob, male: Prob }))
    .refine(
      (xs) => ascending(xs) && xs[0]?.fromAge === 0,
      "tramos desordenados o sin el de 0 años",
    ),
  /** Probabilidad de parir en el año (antes del primer tramo, 0) de una casada con el marido vivo. */
  fertility: z
    .array(z.strictObject({ fromAge: z.number().int().min(0), rate: Prob }))
    .refine(ascending, "tramos desordenados"),
  /** Probabilidad de que la madre muera en el parto. */
  maternalDeath: Prob,
  union: z.strictObject({
    women: z.strictObject({ from: z.number().int(), to: z.number().int() }),
    men: z.strictObject({ from: z.number().int(), to: z.number().int() }),
    /** Probabilidad anual de buscar pareja de quien puede casarse. */
    rate: Prob,
    /** Diferencia de edad (marido − mujer) que más se busca. */
    preferredGap: z.number(),
    /** Probabilidad anual de casarse fuera si no hay con quién en la aldea. */
    outsideRate: Prob,
    /** Desde qué edad se busca fuera. */
    outsideFrom: z.strictObject({ women: z.number().int(), men: z.number().int() }),
  }),
  founding: z.strictObject({
    yearsAgo: AgeRange,
    households: AgeRange,
    wifeAge: AgeRange,
    husbandAge: AgeRange,
  }),
  /** La tierra como presión: cuánta gente sostienen los campos de la aldea. */
  land: z.strictObject({
    peoplePerFarmHex: z.number().positive(),
    minCapacity: z.number().int().positive(),
    /** Desde qué fracción de la capacidad empieza a bajar la fecundidad. */
    crowdingFrom: z.number().min(0).lt(1),
  }),
  /**
   * El hambre: la cosecha del año (media 1, desvío log `sigma`) contra las bocas, con graneros
   * de `storeYears` años de consumo. Lo que falta es hambre [0, 1]: multiplica la mortalidad
   * por tramo de edad y baja la fecundidad hasta `fertilityLoss`.
   */
  hunger: z.strictObject({
    sigma: z.number().min(0),
    /** Fracción de la capacidad de la tierra que una cosecha media alimenta (semilla, diezmo, pérdidas). */
    feedable: z.number().gt(0).max(1),
    storeYears: z.number().min(0),
    fertilityLoss: Prob,
    mortality: z
      .array(z.strictObject({ fromAge: z.number().int().min(0), factor: z.number().min(1) }))
      .refine((xs) => ascending(xs) && xs[0]?.fromAge === 0, "tramos desordenados o sin el de 0"),
  }),
});
export type Demography = z.infer<typeof Demography>;

export const DEMOGRAPHY = defineContent("demography", Demography);

/** El valor del tramo que cubre `age`. */
export function band<T extends { readonly fromAge: number }>(
  xs: readonly T[],
  age: number,
): T | undefined {
  let out: T | undefined;
  for (const x of xs) {
    if (x.fromAge > age) break;
    out = x;
  }
  return out;
}
