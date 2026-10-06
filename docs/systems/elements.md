# Interacciones elementales

> Estado: **borrador de diseño**. Amplía [metaphysics.md](metaphysics.md). Describe la **física común de los elementos**: qué elementos tiene un mundo, cómo se generan, se vencen y se transforman entre sí, y una única operación de interacción que usan la alquimia, la forja, las formaciones, los talismanes, el combate, el cultivo, el cuerpo, la ecología y el clima. Separa la **ley elemental** (verdad, generada por el seed) de las **teorías elementales** de cada cultura (creencias, a veces equivocadas).

Depende de: [metaphysics.md](metaphysics.md) (ejes del mundo; los elementos son parte de la ley), [causality.md](causality.md) (conservación de la esencia, nada aparece porque sí), [planet-gen.md](planet-gen.md) (el qi de cada celda tiene un vector elemental derivado de la geología y el clima), [discovery.md](discovery.md) (las relaciones elementales son creencias `law` que se descubren; los aspectos de la ley tienen afinidad elemental), [perception.md](perception.md) (el sentido de la esencia lee elementos). Lo usan: [cultivation.md](cultivation.md) (raíces, absorción, refinamiento, desequilibrio, técnicas), [body-health.md](body-health.md) (ambientes, desequilibrio, daño elemental, órganos), [living-world.md](living-world.md) (bestias y plantas con afinidad, clima de qi), [heaven-karma.md](heaven-karma.md) (el rayo de la tribulación tiene elemento), [spirits.md](spirits.md) (yin), [economy.md](economy.md) (metales espirituales, valor de los materiales), [crafts.md](crafts.md) (alquimia, forja, formaciones, talismanes) y la futura guerra.

## Principios
1. **Los elementos son física, no etiquetas.** Un elemento no es un "tipo" que da ventaja en una tabla: es una forma de la esencia con firma física (calor, humedad, rigidez, movimiento, vida) y relaciones con las demás. La ventaja sale de una operación continua sobre cantidades, no de "fuego le gana a metal".
2. **Una sola operación para todo.** Una píldora que se estabiliza en el horno, un sable de agua que choca con una lanza de fuego, una formación que recircula el qi de una montaña, un meridiano que se quema por absorber fuego y una niebla que nace donde un valle de agua toca un volcán son **la misma función** (`interact`, §3) con distinto contexto.
3. **Conservación.** Ninguna interacción crea ni destruye esencia. "Vencer" un elemento lo **disuelve** en qi desordenado que vuelve al ambiente (o explota, si es mucho y de golpe); "generar" es **convertir** con pérdida. El ledger de causality §3 se cumple en cada choque.
4. **La magnitud importa.** El agua vence al fuego, pero una taza de agua no apaga un incendio: lo que se tira encima se evapora. Las inversiones (el elemento débil que se impone por cantidad, 相侮) y los excesos (el fuerte que arrasa al débil, 相乘) salen de la misma fórmula.
5. **Ley vs teoría.** La matriz real de relaciones vive en `WorldTruth`. Cada cultura tiene una **teoría elemental** (cuántos elementos hay, cuál genera a cuál) que puede estar incompleta o equivocada. Las recetas y técnicas se diseñan con la teoría y las evalúa la ley (discovery §10).
6. **Varía por mundo.** Cinco fases es lo más común en xianxia, pero no lo único: el seed puede dar yin/yang con fases, ocho trigramas, cuatro elementos, o un sistema generado. Dos mundos de cinco fases tampoco tienen por qué tener las mismas intensidades.
7. **Determinista.** `interact` es determinista dado el estado; el azar (`rng.fork("elements", contextId, eventId)`) solo entra en el ruido de control (la mano del alquimista, la técnica de un cultivador cansado) y en márgenes, nunca en el resultado de fondo.

## 1. El sistema elemental (ley, generada por el seed)
```ts
interface ElementSystem {
  id: ElementSystemId;
  family: "five_phases" | "yin_yang_phases" | "trigrams" | "four_classical" | "generated";
  elements: ElementDef[];                 // los elementos base
  derived: DerivedElement[];              // mutaciones: hielo, rayo, viento, veneno... (§5)
  G: number[][];                          // G[a][b] ∈ [0,1]: cuánto genera a b (相生)
  K: number[][];                          // K[a][b] ∈ [0,1]: cuánto vence a b (相克)
  insultRatio: number;                    // λ: a partir de qué proporción el vencido invierte la relación (相侮)
  generationLoss: number;                 // fracción que se pierde al convertir por generación
  overcomeCost: number;                   // κ: cuánto gasta el vencedor por unidad que disuelve (< 1)
  polarity?: { axis: "yin_yang"; of: Record<ElementId, number> };   // −1 yin ↔ +1 yang
  resonance: number;                      // cuánto se refuerzan dos cantidades del mismo elemento al juntarse
  originEventId: EventId;                 // la génesis del mundo (capa 0)
}

interface ElementDef {
  id: ElementId;
  physical: PhysicalSignature;            // qué le hace a la materia y al ambiente
  celestial?: CelestialBinding;           // sube y baja con el sol, la luna, las estaciones, conjunciones
  geologicalSources: SourceKind[];        // de dónde nace (planet-gen §5): volcanes, vetas, bosques, ríos, sedimento
  bodyAffinity: BodyRegionId[];           // órganos y meridianos con los que resuena (§7)
  aspects: LawAspectId[];                 // aspectos de la ley que lo tocan (discovery §7): fuego → calor, consumir, pasión
}

interface PhysicalSignature {
  heat: number;        // + calienta, − enfría
  moisture: number;    // + moja, − seca
  rigidity: number;    // + endurece, cristaliza; − ablanda, disuelve
  motion: number;      // + empuja, dispersa; − estanca, retiene
  vitality: number;    // + nutre, hace crecer; − marchita, corrompe
}

type ElementVector = Record<ElementId, number>;   // cantidades de esencia por elemento (no proporciones)
```

### Familias de sistemas
| Familia | Elementos | Notas |
|---|---|---|
| **Cinco fases** (la más común en xianxia) | Madera, Fuego, Tierra, Metal, Agua | Ciclo de generación (madera → fuego → tierra → metal → agua → madera) y estrella de destrucción (madera vence tierra, tierra vence agua, agua vence fuego, fuego vence metal, metal vence madera). |
| **Yin/yang con fases** | Las cinco fases con polaridad | Cada elemento tiene un lado yin y uno yang (fuego yang del sol, fuego yin de los fantasmas). La polaridad es un eje más de la interacción (§3). |
| **Trigramas** | Cielo, Tierra, Trueno, Viento, Agua, Fuego, Montaña, Lago | Ocho, en pares opuestos más que en ciclos; muchas relaciones débiles. Favorece formaciones complejas. |
| **Cuatro clásicos** | Fuego, Agua, Aire, Tierra | Pares opuestos (fuego–agua, aire–tierra) sin ciclo de generación fuerte. Típico de otras familias de mundo. |
| **Generado** | 3 a 8 elementos | El seed arma un grafo con restricciones (abajo). Mundos raros. |

- **Pesos.** Dentro de la familia xianxia: cinco fases 70%, yin/yang con fases 15%, trigramas 8%, generado 7%. Los cuatro clásicos aparecen en otras familias de mundo (alta fantasía occidental).
- **Las intensidades varían aunque la forma sea la misma.** En un mundo de cinco fases el agua vence al fuego con `K = 0.9`; en otro con `K = 0.5`, y ahí un cultivador de fuego no le teme tanto al agua. También varían `λ`, `κ` y la pérdida de generación: hay mundos de ciclos generosos (convertir es barato) y mundos de destrucción brutal.
- **Validador del sistema** (se corre sobre miles de seeds):
  - Ningún elemento vence a todos ni es vencido por todos.
  - Todo elemento se puede generar desde algún otro (o es primordial y se declara así: un mundo puede tener un elemento que no nace de nada y solo existe en venas profundas).
  - La firma física es coherente con las fuentes geológicas: el elemento de los volcanes calienta, el de los ríos moja.
  - El ciclo de generación cerrado no permite **ganar** esencia: con `generationLoss > 0`, dar la vuelta completa siempre pierde (no hay móvil perpetuo; causality §3).

## 2. Vectores elementales: todo tiene uno
- **Esencia.** El qi de cada celda (planet-gen §5), el de un cultivador (`elementMix` de cada camino), el de una técnica en uso, el de una formación, el de un tesoro.
- **Materia.** Cada material y sustancia tiene una **firma elemental** en `content/` (por familia de mundo): una hierba de fuego, un mineral de metal, el núcleo de una bestia de agua, la sangre de un dragón. La firma de un objeto concreto puede diferir de la de su tipo según su origen (una hierba de fuego que creció en un valle de agua es más débil y más impura: procedencia, economy §1).
- **Ambiente.** La estación, la hora, la fase lunar y el clima modulan el vector de la celda: el verano sube el fuego, la noche y la luna llena suben el yin y el agua (`celestial` del elemento). Una tormenta trae agua y, si el sistema lo tiene, trueno.
- **Cantidad vs proporción.** Los vectores son cantidades absolutas. "Afinidad agua 63%" (VISION) es una proporción que alguien calculó o creyó leer: la sim guarda cantidades, la percepción las convierte en impresiones (§10).

## 3. La operación: `interact`
Toda interacción elemental es un contacto entre dos vectores (un **activo** que actúa y un **pasivo** que recibe), con una **intensidad de contacto** y un **tiempo**.

```ts
interface InteractionContext {
  kind: "clash" | "infusion" | "mixing" | "absorption" | "field" | "refining";
  coupling: number;              // 0-1: qué tan íntimo es el contacto (una espada que roza ↔ un horno sellado)
  duration: number;              // en ticks del contexto (un instante en combate, horas en un horno, un día en una celda)
  control?: ControlState;        // quién conduce la interacción y con qué precisión (alquimista, cultivador, formación)
  container?: ContainerState;    // horno, cuerpo, formación, celda: capacidad y qué hace con lo liberado
}

interface InteractionResult {
  activeAfter: ElementVector;
  passiveAfter: ElementVector;
  released: ElementVector | number;   // esencia desordenada liberada al contenedor o al ambiente (conservación)
  physical: PhysicalEffects;          // calor, vapor, ceniza, presión, corte: lo que la materia siente
  burst?: number;                     // si se liberó mucho en poco tiempo: onda de choque, explosión, retroceso
  tensionDelta: number;               // cuánto cambió la tensión interna (§4)
  causes: EventId[];
}

function interact(active: ElementVector, passive: ElementVector, ctx: InteractionContext, law: ElementSystem): InteractionResult;
```

Para cada par de elementos `a` (en el activo) y `b` (en el pasivo), en cada tick:

- **Destrucción (相克).** Si `K[a][b] > 0`:
  - Se compara cuánto hay: si `A_a × λ ≥ B_b`, **a vence a b**. Se disuelve `d = coupling × K[a][b] × min(A_a, B_b)` de `b`, y `a` gasta `κ × d`.
  - Si `B_b > λ × A_a`, **la relación se invierte (相侮)**: `b` disuelve a `a` con una fuerza menor (`K[a][b] × ρ`, con `ρ < 1`). La taza de agua sobre el incendio se evapora; la chispa sobre la montaña de metal no la funde.
  - Si `a` es mucho mayor que `b`, el exceso **arrasa (相乘)**: además de disolver `b`, el sobrante pasa a lo que `b` protegía (un fuego que funde la espada sigue quemando la mano).
  - Lo disuelto **no desaparece**: se suma a `released` como qi desordenado. En un horno queda adentro (y hay que sacarlo o refinarlo); en un combate sale al aire como onda de choque y calor; en un cuerpo daña donde se libera.
- **Generación (相生).** Si `G[a][b] > 0`, `a` alimenta a `b`: pasa `t = coupling × G[a][b] × A_a` (limitado por cuánto puede recibir el pasivo), `a` pierde `t` y `b` gana `t × (1 − generationLoss)`. La pérdida se va a `released`. Que la madre se vacíe para alimentar al hijo (子盗母气) no es una regla aparte: es lo que pasa cuando el hijo tiene mucha capacidad.
- **Resonancia.** El mismo elemento en los dos lados se refuerza en el sentido de la acción: dos fuegos que se juntan no pelean, se suman (y el contenedor tiene que aguantar la suma). Por eso pelear contra un cultivador de fuego en un volcán es pelear contra el volcán.
- **Polaridad** (si el sistema la tiene). Yin y yang del mismo elemento se atraen y se neutralizan parcialmente: liberan esencia ordenada en vez de desordenada (la base del cultivo dual y de ciertas píldoras) o se repelen si el contexto no los contiene.
- **Neutralidad.** Elementos sin relación simplemente coexisten: una mezcla, no una reacción. Una mezcla con muchos elementos neutrales es estable pero difícil de usar.

### Física que acompaña
- Cada unidad disuelta o convertida produce efectos según la **firma física** de los elementos involucrados: el agua que apaga fuego produce vapor y frío local; el fuego que vence al metal lo funde (calor que la materia recibe); la madera que vence a la tierra la parte (raíces que rompen piedra).
- Esos efectos entran a los sistemas mundanos como cualquier otro: calor al balance térmico (body-health §7), daño a partes del cuerpo (§4 de body-health), cambios en la materia (un sable que se ablanda pierde filo), humedad y niebla a la celda (planet-gen, clima).

### Ejemplo: un choque en combate
Un cultivador lanza una lanza de fuego (`{fuego: 40}`) contra un escudo de agua (`{agua: 25, metal: 5}`), con `K[agua][fuego] = 0.8`, `λ = 3`, `κ = 0.6`, en un instante de alto acoplamiento.
- El agua es el activo defensivo frente al fuego: `25 × 3 ≥ 40`, así que el agua vence. Disuelve `0.9 × 0.8 × 25 = 18` de fuego y gasta `0.6 × 18 ≈ 11` de agua.
- El fuego que sobra (22) vence al metal del escudo (`K[fuego][metal]`), disuelve unos 4 de los 5 y gasta unos 2.5: el escudo se debilita por la parte que no se esperaba.
- El fuego restante (unos 19) atraviesa el escudo, que quedó con 14 de agua, y llega al cuerpo con menos fuerza. Lo disuelto y lo gastado (unos 35: 70 antes, 35 después) sale como vapor y calor: ciega a los dos por un instante (percepción) y quema a quien esté cerca.
- Si el escudo hubiera tenido solo 10 de agua (`10 × 3 < 40`), el fuego lo habría arrasado: el agua se evapora y el fuego entra casi entero.

## 4. Tensión: por qué algunas mezclas se sostienen y otras explotan
Un vector solo, sin nadie que lo toque, también tiene una dinámica interna: sus elementos interactúan entre sí.
```
tensión(v) = Σ_a Σ_b K[a][b] × v_a × v_b / total(v)  −  Σ_a Σ_b G[a][b] × v_a × v_b / total(v)  −  contención
```
- **Estable:** una mezcla donde los elementos se generan en cadena (madera y fuego, fuego y tierra) se sostiene y hasta se alimenta sola. Una mezcla con pares que se vencen (agua y fuego juntos) tiene tensión: decae, libera, y si nada la contiene, revienta.
- **Contención:** un horno, un recipiente de jade, una formación, un dantian, un sello de talismán bajan la tensión efectiva mientras aguantan. Cada contenedor tiene una capacidad; si la tensión la supera, se rompe (el horno que explota, el dantian que se fisura, la formación que colapsa).
- **Dónde importa:**
  - **Píldoras:** una píldora es un vector contenido en materia. Su tensión residual es **toxicidad** y es **inestabilidad** (pierde potencia con el tiempo o se rompe). Es la toxicidad residual de body-health §9 vista desde la ley.
  - **El cuerpo del cultivador:** `elementMix` con tensión alta es el desequilibrio elemental de cultivation §5: daña meridianos o desestabiliza (desviación, body-health §12). Un cuerpo con raíces que se generan en cadena (agua y madera) es más estable que uno con raíces opuestas.
  - **Tesoros naturales:** solo se forman donde la tensión del lugar es baja durante mucho tiempo (planet-gen §5). Un lugar de fuego y agua opuestos produce, en cambio, fenómenos violentos: géiseres, tormentas permanentes.
  - **Formaciones:** un circuito con elementos que se vencen en serie es una formación de matar (acumula tensión y la descarga hacia adentro); uno en ciclo de generación es una formación de nutrir o de defensa que se sostiene sola mientras tenga fuente.

## 5. Elementos derivados y mutaciones
Además de los elementos base, el sistema puede tener **derivados** que nacen de condiciones concretas.

```ts
interface DerivedElement {
  id: ElementId;                                 // hielo, rayo, viento, veneno, luz, oscuridad...
  parents: Partial<ElementVector>;               // de qué se compone (agua + yin extremo → hielo)
  conditions: FieldCondition[];                  // dónde aparece: frío extremo, tormenta sobre un pico, pantano corrupto
  rows: { G: number[]; K: number[] };            // sus relaciones, derivadas de las de sus padres con correcciones del seed
  stability: number;                             // cuánto dura fuera de las condiciones que lo crean
}
```

- **Nacen en el mundo, no en una lista.** Hay hielo donde el agua se encuentra con un frío yin extremo durante mucho tiempo (glaciares de montañas altas, lagos de agua yin); rayo donde el fuego y el viento chocan en tormentas sobre picos; veneno donde la madera se pudre en qi estancado. Fuera de sus condiciones, los derivados decaen hacia sus padres (el hielo espiritual se derrite si lo sacás del glaciar sin contención).
- **Raíces mutadas (变异灵根).** Una persona cuyas raíces resuenan con un derivado es rara y valiosa: sale del genoma más la exposición durante la gestación o la infancia (nacer junto a un glaciar espiritual, sobrevivir a un rayo). No es una tirada de talento: tiene causa, y se puede rastrear.
- **Relaciones heredadas con matiz.** El hielo hereda del agua la debilidad ante la tierra pero resiste mejor al fuego en poca cantidad (necesita más calor para fundirse que el agua para evaporarse). Esas correcciones son parte de la ley y son terreno de descubrimiento.
- **Elementos del Cielo.** El rayo de la tribulación tiene un elemento (o un vector) propio del Cielo de ese mundo (heaven-karma): prepararse con tesoros y formaciones del elemento que lo vence, o con contenedores que aguanten la descarga, es parte de la preparación de la ruptura (cultivation §6).

## 6. Campos: los elementos en el mundo
El qi de cada celda tiene su vector, y las celdas interactúan con sus vecinas en el tick de mundo (contexto `field`, acoplamiento bajo, duración larga).
- **Fronteras elementales.** Donde un valle de agua toca una ladera volcánica hay nieblas permanentes, aguas termales, minerales raros; donde un bosque viejo avanza sobre una meseta de tierra, raíces que parten roca. No se pintan: salen de `interact` entre celdas con fuerte contraste.
- **Ciclo de generación en el paisaje.** Una cuenca donde el bosque (madera) rodea un volcán (fuego) rodeado de llanura (tierra) es un lugar de qi que se alimenta solo: lo buscan las sectas y lo marcan los geománticos.
- **Estaciones y astros.** El vector de cada celda oscila con `celestial`: un lugar de fuego es más fuerte en verano y a mediodía, uno de agua en invierno y en luna llena. Las conjunciones raras (planet-gen §1) amplifican un elemento en todo el planeta por días: ventanas de ruptura, de forja y de alquimia que se calculan con astronomía.
- **El uso cambia el campo.** Una secta de fuego que absorbe fuego durante siglos deja su montaña sesgada hacia lo que no consume (la tierra y el metal crecen en proporción). Una batalla de técnicas de agua deja la celda húmeda y fría. Una masacre deja yin (spirits).
- **Ecología.** Plantas y bestias espirituales prosperan donde el vector del lugar resuena con el suyo y lo modifican al consumir ([living-world.md](living-world.md) §8: poblaciones y selección). Un pantano de veneno con bestias de veneno es estable porque se alimentan entre sí.
- **Clima.** El qi elemental intenso empuja al clima mundano a través de la firma física (un lugar de fuego denso es más seco y caliente que su latitud). El efecto es pequeño salvo en anomalías, pero existe y es descubrible.

## 7. El cuerpo y los elementos
- **Órganos y meridianos.** Cada elemento resuena con regiones del cuerpo (`bodyAffinity`). En cinco fases, típico: madera con hígado y tendones, fuego con corazón, tierra con bazo y músculo, metal con pulmones y piel, agua con riñones y huesos. **La asignación real la genera el seed** dentro de lo que la familia permite; las teorías médicas de cada cultura (body-health §11) la creen con más o menos acierto.
- **Desequilibrio.** Tensión alta en el `elementMix` daña primero las regiones de los elementos en conflicto: un cultivador de agua que absorbe fuego sin refinar empieza por el corazón y los riñones. body-health §12 aplica el daño; esta capa dice dónde.
- **Daño elemental.** Lo que una técnica o un ambiente le hace al cuerpo es su firma física más la esencia que entra: el fuego quema (heridas de quemadura), el metal corta y hiere la piel, el agua y el yin enfrían hasta congelar, la madera envenena o enreda, la tierra aplasta. La esencia que entra sigue interactuando adentro con el `elementMix` del herido: un golpe de fuego sobre un cultivador de metal no solo quema, también disuelve parte de su esencia.
- **Ambientes.** El qi de fuego, el frío yin y las miasmas de body-health §7 son vectores de celda que entran por la respiración y la piel con contexto `absorption` de acoplamiento bajo.
- **Medicina.** Equilibrar elementos (hierbas del elemento que genera al débil, del que vence al excesivo) es una teoría médica que funciona en la medida en que su matriz coincida con la ley.

## 8. Usos (resumen para los sistemas que la usan)
| Sistema | Qué hace con `interact` |
|---|---|
| **Cultivo** (cultivation §5) | Absorción: coincidencia entre raíces y el vector de la fuente. Refinamiento: técnicas que convierten por generación lo que no coincide (una técnica de fuego que pasa madera a fuego) con su pérdida, o lo expulsan. Técnicas de un elemento contrario al propio chocan con el cuerpo. |
| **Alquimia** ([crafts.md](crafts.md) §4) | Los ingredientes son vectores; el fuego del horno es el activo; el orden de agregado importa porque cada paso es un `interact` sobre lo que ya hay. La píldora es lo que queda contenido; la toxicidad es la tensión residual; el horno que revienta es contención superada. |
| **Forja** ([crafts.md](crafts.md) §5) | El fuego vence al metal (fundir, ablandar); el temple es un `interact` con agua (u otro elemento) que fija la estructura. Un metal espiritual no se funde con fuego mortal porque su cantidad de metal invierte la relación (相侮): hace falta fuego espiritual en proporción. |
| **Formaciones** ([crafts.md](crafts.md) §6) | Circuitos de nodos sobre el campo de qi real: ciclos de generación para concentrar, nutrir o defender; cadenas de destrucción para matar o sellar. Romper una formación es encontrar el nodo donde inyectar el elemento que vence al que lo sostiene. |
| **Talismanes** ([crafts.md](crafts.md) §7) | Un vector contenido en papel, jade o hueso, con un patrón que dice cómo liberarlo. Al activarse, `interact` con lo que toca. |
| **Combate** (guerra y resolución de acciones) | Cada técnica en uso tiene vector, acoplamiento y duración; cada choque es un `interact` más su física. El ambiente se suma por resonancia. La ventaja elemental es real pero proporcional. |
| **Percepción** (perception) | El sentido de la esencia lee vectores con ruido (§10). |
| **Ecología y clima** (living-world, planet-gen) | Contexto `field` entre celdas, poblaciones y estaciones. |
| **Cielo** (heaven-karma) | El elemento del rayo y de los fenómenos del Cielo. |
| **Espíritus** (spirits) | El yin como polaridad (si existe) o como elemento: sostiene a los espíritus, los yang los disuelven. |

## 9. Teorías elementales (conocimiento, cultura)
```ts
interface ElementTheory {
  id: TheoryId;
  culture: CultureId;
  originEventId: EventId;                         // quién la sistematizó, a partir de qué observaciones
  believedElements: { name: string; maps?: ElementId[] }[];   // pueden juntar o separar elementos reales
  believedG: Belief[];                            // creencias `law` de tipo elementRelation (discovery §1)
  believedK: Belief[];
  correspondences: Belief[];                      // órganos, colores, estaciones, direcciones, sabores, emociones
}
```
- **La teoría no es la ley.** Una cultura puede creer en cuatro elementos en un mundo de cinco fases (y meter la madera y el metal en "tierra"), creer que el metal genera agua con fuerza cuando la relación real es débil, o no saber que el hielo existe como elemento propio. Las recetas, técnicas y formaciones de esa cultura heredan esos errores como `flaws` (discovery §10).
- **Correspondencias.** Colores, direcciones, estaciones, sabores, emociones y animales asociados a cada elemento son mayormente **cultura**: algunas tienen base en la ley (la estación en que un elemento crece de verdad), otras son simbolismo que nadie verificó. El jugador puede descubrir cuáles son reales.
- **Descubrir la matriz.** Las relaciones son creencias `law` del tipo `elementRelation` (discovery §1) con evidencia: el alquimista que ve reventar hornos con cierta combinación, el cultivador que nota que su escudo de agua se rompe más de lo esperado ante cierto fuego. Medir la inversión (`λ`) o la pérdida de generación con precisión es saber de élite.
- **Dogmas y cismas.** Dos escuelas con matrices distintas compiten: la que tiene la más fiel produce mejores píldoras y formaciones, y eso, con el tiempo, se nota (discovery §9).

## 10. Percepción
- **Sentido de la esencia** (perception, tabla de canales): percibe el vector de un aura, una celda, un objeto o una técnica en uso como una **impresión** (elemento dominante, intensidad relativa, textura), con error que baja con el cultivo, la atención y la profundidad en los aspectos relevantes (discovery §7). Un experto distingue fuego yin de fuego yang; un novato siente "calor".
- **Lectura sin sentido de la esencia.** Los mortales ven la firma física: calor, humedad, plantas que crecen raras, metal que se oxida rápido. Un geomántico mortal puede leer un lugar por esos indicios con su teoría (y equivocarse).
- **Ocultar y falsificar.** Técnicas que enmascaran el elemento del aura o lo muestran como otro (perception: supresión). Un asesino de fuego que se hace pasar por cultivador de agua hasta el golpe.

## 11. El jugador y el narrador
- **Sin números.** El jugador no ve vectores ni matrices: siente el calor del qi de una cueva, el choque entre su agua y el fuego del rival, el horno que empieza a vibrar, la incomodidad en el pecho después de absorber qi de otro elemento. Lo que lee con el sentido de la esencia llega como impresión con la precisión que tiene.
- **Lo que sabe es su teoría.** El narrador usa el vocabulario de la teoría elemental de la cultura del personaje (y de lo que el personaje aprendió), nunca la matriz real. Si el personaje cree que el metal genera agua, el narrador no lo corrige: narra lo que pasa y deja que el jugador lo note.
- **Experimentar es jugar.** El jugador puede probar combinaciones (en un horno, en combate, en su cuerpo) y formar hipótesis sobre las relaciones; el diario de hipótesis (discovery) las guarda. Encontrar una inversión que nadie conoce (un elemento débil que vence en cierta proporción) es una ventaja real.

## 12. Escala (LOD)
- **Tier 3-4 (cerca del jugador, combates, oficios en curso):** `interact` completo por elemento, tick a tick, con física y contención.
- **Tier 2:** interacciones resumidas por evento (un combate se resuelve con los vectores agregados de cada lado y un solo `interact` de duración larga; una sesión de alquimia, con la receta entera como una secuencia corta).
- **Tier 0-1 y celdas lejanas:** cada celda guarda su vector y la tensión; el campo se actualiza por estación con el contexto `field`; las poblaciones y organizaciones usan el elemento dominante y un escalar de calidad.
- **Precálculo.** Como la matriz es fija por mundo, se pueden precalcular tablas (resultado de choques por proporción, tensión de mezclas comunes) para el modo agregado, siempre derivadas de la ley y no escritas a mano.

## Implementación
- **Fase 1:** `ElementSystem` de cinco fases fijo en `content/` (el seed solo genera intensidades), `ElementVector` en el qi de las celdas, firma física de materiales básicos (fuego mundano, agua). `interact` puro en `src/sim/elements/` con tests de conservación.
- **Fase 4 (cultivo):** raíces, absorción con coincidencia, refinamiento por generación, tensión del `elementMix`, daño por desequilibrio, técnicas con vector, sentido de la esencia que lee elementos.
- **Oficios ([crafts.md](crafts.md)):** alquimia, forja, formaciones y talismanes sobre `interact` y tensión con contenedores.
- **Fase 5:** campos entre celdas (fronteras, estaciones), derivados que nacen de condiciones, ecología con afinidad.
- **Fase 6-7:** teorías elementales por cultura, dogmas y cismas sobre la matriz, correspondencias.
- **Fase 7 (worldgen completo):** el seed genera la familia del sistema y el grafo (incluidos los generados) con su validador; elementos del Cielo.

## Tests
- **Conservación:** en todo `interact`, `total(activo) + total(pasivo)` antes = después + `released`. Sin excepción, en miles de casos aleatorios (con seed).
- **Sin móvil perpetuo:** ninguna secuencia de generaciones devuelve más esencia que la que entró; validado sobre los sistemas generados.
- **Validador:** miles de seeds generan sistemas que pasan las reglas de §1.
- **Determinismo:** mismo estado y mismo contexto dan el mismo resultado; el ruido de control solo depende del `rng.fork` del contexto.
- **Magnitud:** en un escenario controlado, la taza de agua no apaga el incendio (inversión) y el incendio arrasa una defensa chica (exceso); las curvas de resultado por proporción son monótonas.
- **Tensión:** una mezcla en ciclo de generación tiene tensión menor que una con pares opuestos de igual cantidad; un contenedor que se supera libera lo que contenía (sin perder nada).
- **Ninguna teoría lee la ley:** las recetas y técnicas se diseñan con `ElementTheory`; `interact` solo se llama con la ley desde la simulación.
- **El narrador no recibe la matriz real** ni vectores que el personaje no percibió.

## Decisiones tomadas en este borrador (revisables)
- Doc propio (`elements.md`) en vez de una sección de metaphysics.md, porque lo usan casi todos los sistemas; metaphysics.md lo enlaza como parte de la ley.
- Una sola función `interact` con contexto para todos los usos; la tensión (§4) es la misma función aplicada a un vector consigo mismo.
- Vencer disuelve en qi desordenado (no destruye) y generar convierte con pérdida: así se cumple la conservación y no hay móvil perpetuo.
- Las relaciones son continuas (`G`, `K`) con inversión por cantidad (`λ`), no una tabla de ventajas.
- Los derivados nacen de condiciones del mundo y decaen fuera de ellas.
- Cinco fases es la familia más común en xianxia (70%); el seed varía las intensidades incluso dentro de la misma forma.
- La asignación de elementos a órganos es ley del mundo (generada), y las teorías médicas la creen con más o menos acierto.

## Preguntas abiertas
- Calibración: `λ`, `κ`, `ρ` y pérdida de generación típicos para que la ventaja elemental importe sin decidir sola los combates (un cultivador mucho más fuerte gana aunque tenga el elemento en contra).
- Calibración: velocidad con que el uso sesga el campo elemental de una celda, y cuánto empuja el qi elemental al clima mundano.
- Calibración: frecuencia de raíces mutadas y de lugares donde nacen derivados.
