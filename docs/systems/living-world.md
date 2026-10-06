# El mundo vivo

> Lo que le pasa al planeta y a sus pueblos después de generado: desastres, bestias que evolucionan, culturas que salen del terreno, mitos que son historia deformada, rutas y conocimiento que se pierde, y la ecología que hay debajo de todo eso. Nada se escribe a mano: todo sale de las capas de [causality.md](causality.md) corriendo sobre el mapa de [planet-gen.md](planet-gen.md).

> Estado: §1-§7 **decididas**; §8-§16 son una **ampliación en borrador** (2026-10-06): la capa 2 de causality como modelo explícito. Poblaciones de plantas y bestias con rasgos heredables y cadenas tróficas, sucesión ecológica y fuego, especies que llegan por puentes de tierra y rutas comerciales, migraciones estacionales con rutas aprendidas, domesticación como proceso histórico, y vínculos y contratos con bestias.

Depende de: [causality.md](causality.md) (capa 2, presiones, conservación), [planet-gen.md](planet-gen.md) (biomas, clima, oscilaciones, suelos, puentes de tierra, volcanes), [elements.md](elements.md) (afinidad elemental de plantas y bestias, campos), [heaven-karma.md](heaven-karma.md) (deuda de qi por matanzas, calamidades), [family-lineage.md](family-lineage.md) (genoma y herencia, linajes de sangre), [npc-psychology.md](npc-psychology.md) (psicología de bestias despiertas, períodos sensibles), [perception.md](perception.md) (sentidos por especie). Lo usan: [economy.md](economy.md) (stocks de caza, pesca, hierbas y madera; ganado como bien vivo), [body-health.md](body-health.md) (zoonosis, reservorios, choque de poblaciones), [technology.md](technology.md) (ganadería, cultivos traídos de lejos), [contracts.md](contracts.md) (pactos con bestias), [crafts.md](crafts.md) (materiales de bestias y plantas, fuego de bestia), [cultivation.md](cultivation.md) (núcleos de bestia, bestias que cultivan), [secret-realms.md](secret-realms.md) (ecologías cerradas), [war.md](war.md) (monturas, bestias de guerra, forraje), [law.md](law.md) (robo de ganado, partes protegidas), [divination.md](divination.md) (bestias que bajan como presagio), [deep-history.md](deep-history.md) (extinciones, domesticaciones y ruinas cubiertas de bosque).

## Principios
1. **Ningún ser vivo aparece.** Cada población cambia solo por nacimientos, muertes, migraciones e introducciones con un vector concreto (causality, Ley 2). Una especie nueva en un valle llegó en algo: un puente de tierra, un río, una caravana, un barco, el bolsillo de un cultivador.
2. **La ecología se apoya en la física.** La productividad de una celda sale del clima, el suelo y el qi (planet-gen); lo que vive ahí, de esa productividad y de quién come a quién. Nada se pinta encima.
3. **Las especies emergen.** `content/` define linajes base con rasgos heredables. Las variantes regionales, las razas domésticas y las especies nuevas salen de la selección en el tiempo y llevan su `originEventId`.
4. **Conservación.** La biomasa sale de la energía (sol y qi) y de los nutrientes del suelo, y vuelve al suelo al morir (planet-gen §9). Cazar, talar y cosechar sacan de un stock finito (economy §3); nada se repone por decreto.
5. **Las bestias tienen mente según su especie.** Las no despiertas deciden con una mente chica (hambre, miedo, apego, territorio, memoria de individuos). Las despiertas son agentes completos (npc-psychology).
6. **Determinista.** Toda dinámica usa `rng.fork("eco", proceso, celda, tick)`. El azar elige entre lo que el estado permite: si una semilla prende, cuántas crías sobreviven, hacia qué lado se corre la manada.

## 1. Desastres con causa
No hay tabla de catástrofes: cada desastre es la descarga de una presión que el estado ya acumulaba.

| Desastre | Presión que lo causa | Se puede prever |
|---|---|---|
| Terremoto | Tensión acumulada en una falla activa (crece con el movimiento de placas) | Sí: fallas conocidas, temblores previos |
| Erupción | Presión en un volcán activo (punto caliente o borde); las grandes dan un invierno volcánico lejos ([planet-gen.md](planet-gen.md) §10) | Sí: humo, temblores, animales que huyen |
| Tsunami | Terremoto submarino | Minutos u horas antes, si sabés leer el mar |
| Sequía, inundación | Ciclos climáticos de varios años (oscilaciones del océano, [planet-gen.md](planet-gen.md) §3; mareas de qi); inundaciones glaciares ([planet-gen.md](planet-gen.md) §8) | Sí, por quien estudió los ciclos |
| Incendio forestal | Combustible acumulado en la vegetación + sequía + rayo o mano humana (§9) | Sí: años secos sobre bosques sin fuego hace mucho |
| Plaga, epidemia | Densidad de población + rutas comerciales + higiene + cosechas malas | Sí: síntomas que viajan por los caminos |
| Plaga de cultivos, langosta | Una población que explota (§8): lluvias tras sequía para la langosta, monocultivo para una roya, una especie llegada sin enemigos (§10) | Sí: los primeros enjambres, las hojas manchadas |
| Calamidad de qi | Sobreexplotación de una región (ver heaven-karma) | Sí: el qi baja, las bestias mutan |

- Los cultivadores fuertes pueden **provocarlos** (una batalla que rompe una falla) o **frenarlos** (sellar un volcán). Las dos cosas mueven karma.
- Un desastre deja huella: migraciones, hambre, guerras por recursos, tabúes ("no construyas en el valle"), mitos, y un terreno que la sucesión vuelve a ocupar (§9).

## 2. Bestias que evolucionan y despiertan
- **Adaptación por selección:** cada población de bestias tiene rasgos heredables (afinidad elemental según [elements.md](elements.md), tamaño, resistencia). Generación tras generación, el entorno favorece variantes: cerca de un volcán prosperan los lobos con afinidad al fuego. Las especies regionales **emergen**, no se escriben en una tabla. `content/` solo define los linajes base. El modelo de poblaciones está en §8.
- **Despertar:** una bestia muy longeva con mucho qi puede despertar inteligencia. A partir de ahí es un **agente** con psicología (la misma de [npc-psychology.md](npc-psychology.md), con otros valores y necesidades), cultiva y con el tiempo puede tomar forma humana.
- **Domesticadas que despiertan:** una bestia de una raza domesticada (§12) también puede despertar, pero más rara vez: la cría para mansedumbre y producción debilita el núcleo. La que despierta recuerda cómo la trataron (su `BeastMind`, §13, pasa a ser su memoria de agente): el buey que despierta en un establo cruel trae una deuda; el que despierta en una casa que lo quiso, un vínculo.
- **Reinos de bestias:** bestias despiertas que reúnen a otras forman facciones con territorio, intereses y memoria. Recuerdan a los humanos que cazaron a sus crías: las guerras entre humanos y bestias tienen causa. Sus tratados con humanos son compromisos (§13).
- **Culturas de bestias:** los reinos de bestias forman culturas con **lengua propia** (generada con el mismo generador de §3, con fonología propia de la especie), normas propias (por ejemplo, si reconocen deudas de gratitud con humanos, si el territorio se hereda, qué es una ofensa) y sus propios nombres de lugares. Negociar con ellos exige aprender la lengua o un intérprete; los malentendidos tienen forma.

## 3. La geografía hace a las culturas
Cuando la historia profunda crea un pueblo, sus rasgos culturales salen de **dónde vive y qué le pasó**:
- **Economía → valores:** nómadas del desierto (movilidad, hospitalidad, honor de clan), imperios de río (burocracia, obras hidráulicas, jerarquía), pueblos de montaña (aislamiento, tradición), costeros (comercio, apertura). Los pastores que siguen a sus rebaños (§11) y los pueblos que domesticaron un animal de tiro o de guerra (§12) tienen la economía que ese animal permite.
- **Comida, vestimenta, arquitectura** según clima y recursos (madera, piedra, barro).
- **Valores colectivos** con el mismo catálogo que los NPCs, como sesgo inicial para quienes nacen ahí.
- **Lenguas generadas de verdad** (decidido: máximo detalle):
  - Cada protolengua tiene **fonología** (inventario de sonidos, estructura de sílabas), **raíces** con significado y **morfología** básica (cómo se forman palabras compuestas).
  - **Evolución:** cuando un pueblo se separa (montañas, mares, migración), su lengua cambia con reglas de cambio fonético a lo largo de los siglos. Las lenguas hermanas se parecen y sus parientes lejanos apenas.
  - **Contacto:** el comercio y la conquista prestan palabras entre lenguas. Las especies llegadas de lejos suelen llegar con el nombre de donde vienen, o con el del puerto por donde entraron (§10).
  - **Nombres con significado:** "Qingshui" significa "agua clara" en esa lengua. Un lugar conserva nombres viejos deformados de pueblos que ya no existen, y eso es una pista arqueológica ([deep-history.md](deep-history.md) §5: topónimos en capas, nombres redundantes, etimologías populares).
  - **Escritura:** algunas culturas la inventan (o la heredan); los textos viejos están en lenguas muertas que hay que aprender a leer.
  - El LLM no inventa palabras: usa las del léxico generado (las traduce o las cita).

## 4. Los mitos son historia deformada
- La memoria colectiva usa la **misma mecánica** que la memoria de los NPCs: se transmite contada, se distorsiona y se comprime en gist. A escala de siglos, una batalla real entre dos inmortales se vuelve "el dios dragón contra la diosa del sol".
- Cada mito guarda un **puntero causal** al evento real (en `WorldTruth`). El jugador que investiga (comparar versiones de pueblos distintos, encontrar ruinas, leer textos antiguos) puede reconstruir qué pasó.
- **Los mitos apuntan a lugares reales:** "donde cayó la lanza del dios" puede ser un cráter con un fragmento de arma de verdad.
- Los mitos cambian la conducta (tabúes, peregrinaciones, odios entre pueblos), así que son causa y no solo decoración. Muchos tabúes son ecológicos con mecanismo: "no se caza en el bosque sagrado" protege un refugio de cría; "no se come el pez del lago negro" recuerda un envenenamiento.

## 5. Creencias sobre el Cielo y calendarios
- Cada pueblo interpreta el Cielo, las tribulaciones, los eclipses y la muerte según lo que vivió: adorarlo (el Cielo castiga a los soberbios), desafiarlo (el camino del cultivo es rebelión), negarlo (no hay Cielo, hay leyes), temerle.
- **Religiones** como organizaciones que nacen de eventos (un profeta que vio una tribulación, un milagro que fue un cultivador) y compiten.
- **Calendarios:** cada cultura cuenta los años desde su propio evento fundador. "Año 314 del Calendario de la Grulla Celestial" sale solo, y la misma fecha tiene números distintos según quién la diga. Los calendarios de cazadores y pastores marcan los pasos de las manadas y las floraciones (§11).

## 6. Rutas que nacen del terreno
- Las rutas son caminos de **menor costo** sobre el mapa (pendiente, ríos navegables, pasos, costas, peligro) entre lugares que tienen algo que intercambiar.
- Las ciudades crecen en **cruces**: confluencias, desembocaduras, pasos de montaña, puertos naturales.
- Los **cuellos de botella** (un paso, un estrecho) valen mucho, así que se fortifican, se cobran peajes y provocan guerras.
- Más tarde aparece infraestructura construida por la historia (caminos, canales, formaciones de teletransporte), que cambia el costo de viajar y redibuja el mapa del comercio.
- Las rutas también llevan plagas, rumores, técnicas, ejércitos y **especies** (§10). Y cortan otras rutas: un camino amurallado o un canal puede cerrar el paso de una migración (§11).

## 7. El conocimiento es físico
- Una técnica, un mapa o una receta existen **en algún soporte**: manuscrito, tablilla de jade, inscripción, la memoria de alguien. Sin soporte, se pierde.
- Los soportes se degradan (papel que se pudre, jade que dura milenios), se queman, se roban y se copian (con errores: una técnica mal copiada es peligrosa).
- Un maestro que muere sin discípulos se lleva lo que sabía. **Las técnicas perdidas son reales**, y una ruina puede guardar algo que el mundo olvidó.
- El conocimiento se conserva como cualquier recurso: copiarlo crea un objeto nuevo con `originEventId`, y nada aparece sin fuente.
- Lo mismo vale para las bestias: la ruta de migración de una manada vive en la memoria de sus viejos (§11), y una raza doméstica vive en sus animales y en quien sabe criarlos (§12).

## 8. Poblaciones, nichos y cadenas tróficas

La capa 2 de causality. La unidad no es el individuo sino la **población por celda**; los individuos se materializan cuando hace falta (§16).

```ts
interface Lineage {                        // content/: linaje base (lobo, ciervo, grulla, arroz silvestre, pino)
  id: LineageId;
  kingdom: "plant" | "animal" | "fungus" | "spirit_beast" | "spirit_plant";
  bodyPlan?: BodyPlanId;                   // body-health §1
  senses?: SenseProfileId;                 // perception
  diet?: DietSpec;                         // qué come y en qué proporción
  lifeHistory: { maturity: number; lifespan: number; litter: number; gestation: number; breedingSeason?: SeasonSpec };
  traits: TraitSpec[];                     // rasgos heredables con media y varianza: tamaño, afinidad elemental, tolerancias, docilidad…
  social: "solitary" | "pair" | "group" | "herd" | "colony" | "hive";
  qiUse?: { need: number; coreGrowth?: number };   // bestias y plantas espirituales: cuánto qi comen y si forman núcleo
}

interface Population {                     // por celda (nivel 0) o parche (nivel 1)
  id: PopulationId;
  lineage: LineageId;
  variant?: VariantId;                     // variante regional o raza doméstica que emergió (§2, §12)
  cell: CellId;
  ageClasses: Float32Array;                // individuos por clase de edad
  traitMeans: Record<TraitId, number>;     // la distribución heredable de esta población
  traitVar: Record<TraitId, number>;
  condition: number;                       // reservas promedio: flacos en invierno, gordos en otoño
  memory?: PopulationMemoryRef;            // rutas y lugares aprendidos (§11), miedo a los humanos
  owner?: HolderRef;                       // ganado: de quién es (economy, §12)
  originEventId: EventId;                  // condición inicial, llegada (§10), separación de otra población
}

interface Niche {                          // derivado del linaje y los rasgos actuales
  temperature: Range; moisture: Range; altitude?: Range;
  elementAffinity?: ElementVector;         // elements: prospera donde resuena el campo
  qiRange?: Range;                         // las espirituales necesitan qi mínimo; ninguna tolera cualquiera
  habitat: SuccessionStage[];              // en qué etapas de la vegetación vive (§9)
}
```

- **Productividad.** Cada celda tiene una producción primaria por estación: `f(luz, temperatura, agua, nutrientes del suelo, qi de madera)`. Es la energía que entra a la cadena. Un año seco de la oscilación oceánica (planet-gen §3) baja la producción y todo lo que sigue lo siente.
- **Quién come a quién.** Una red trófica por celda con las poblaciones presentes y sus dietas. Las tasas de consumo dependen de las densidades (respuesta funcional saturante: un depredador come más cuando hay más presas, hasta un techo) y del refugio (presas en bosque denso son más difíciles). Ciclos de depredador y presa salen solos.
- **Capacidad de carga.** Nadie tiene un tope escrito: la población crece hasta que la comida, el refugio, las enfermedades o los depredadores la frenan. Por eso la sobrecaza de lobos llena el valle de ciervos que se comen los brotes del bosque y los campos (causality, capa 2).
- **Selección.** Cada generación, la reproducción y la supervivencia dependen de los rasgos frente al nicho y a los depredadores; la media de la población se corre. Con poblaciones separadas (un puente de tierra que se cierra, una cordillera, un reino secreto), las medias divergen y con el tiempo salen variantes y especies nuevas (evento `speciation` con causa: la separación).
- **Bestias espirituales.** Comen qi además de comida: el qi de la celda es otra fuente de la red (con conservación: lo que comen baja el campo, planet-gen §5). Acumulan un núcleo que crece con los años y el qi. Por eso se juntan en venas y tesoros naturales, y por eso matarlas en masa deja deuda de qi (heaven-karma §6) y un vacío en la red.
- **Plantas espirituales.** Crecen solo con qi suficiente, en etapas maduras de la vegetación (§9) y sin cosecha: la edad es su valor (crafts: la edad concentra esencia). Una hierba de mil años es mil años sin disturbio ni recolector.
- **Enfermedades de fauna.** Los patógenos de body-health §6 también corren en poblaciones animales (epizootias): una peste de los ciervos baja la caza y hace bajar a los lobos a los rebaños. Las poblaciones animales son los reservorios de las zoonosis.
- **Extinción con causa.** Una población que llega a cero se extingue en esa celda; si era la última, el linaje o la variante desaparece del mundo con un evento que guarda sus causas (sobrecaza, hábitat talado, una especie llegada, un invierno volcánico). Lo que no se puede reponer no vuelve (salvo que alguien guarde huevos, semillas o un reino secreto: §16).
- **Stocks para la economía.** Caza, pesca, recolección de hierbas y tala sacan individuos y biomasa de estas poblaciones (economy §3). El rendimiento por esfuerzo baja cuando el stock baja: el precio sube sin que nadie lo decida.

## 9. Sucesión ecológica y fuego

La vegetación de un lugar no es fija: avanza por etapas después de cada disturbio, y cada etapa trae su fauna, su suelo y su qi.

```ts
type SuccessionStage =
  | "bare"            // roca, lava, morrena, suelo arrancado
  | "pioneer"         // líquenes, hierbas anuales, matas
  | "grass_shrub"     // pastizal, matorral
  | "young_forest"    // árboles pioneros de luz
  | "mature_forest"   // especies de sombra
  | "old_growth";     // bosque viejo: árboles de siglos, madera muerta, qi de madera acumulado

interface VegetationState {               // por celda (fracciones) o por parche (una etapa)
  stages: Partial<Record<SuccessionStage, number>>;   // fracción de la superficie en cada etapa
  standAge: Float32Array;                 // edad de la vegetación por fracción
  biomass: number;
  fuelLoad: number;                       // combustible acumulado: hojarasca, madera muerta, pasto seco
  canopy: number;
  trajectory: TrajectoryId;               // content/: la secuencia de cada bioma (no todos llegan a bosque)
  lastDisturbance?: { kind: DisturbanceKind; eventId: EventId; at: Tick };
}
```

- **Trayectorias por bioma.** Cada bioma (planet-gen §4) tiene su secuencia y su etapa final: en el clima húmedo templado llega a bosque viejo; en la estepa se queda en pastizal; en un pantano de qi yin, a un bosque de juncos negros. La velocidad depende del clima, el suelo y si quedan semillas cerca (un claro chico se cierra rápido; una ladera entera sin bosque vecino tarda siglos).
- **Primaria y secundaria.** Sobre roca desnuda (una colada nueva, la morrena de un glaciar que se retiró, un cráter) la sucesión empieza sin suelo y espera a que se forme (planet-gen §9): siglos. Sobre un campo abandonado o un bosque quemado el suelo queda y vuelve a ser bosque en décadas.
- **Disturbios.** Fuego, tala, roza, arado, pastoreo, inundación, deslizamientos, ceniza volcánica, huracanes, plagas de insectos, una batalla de cultivadores que arrasa una ladera. Cada uno resetea parte de la vegetación a una etapa anterior, con un evento.
- **Fuego como presión.** El `fuelLoad` sube cada año sin fuego y baja con el pastoreo y las quemas. Con sequía y una chispa (rayo, quema de un campesino, un campamento, una técnica de fuego) el hazard de incendio crece con el combustible: un bosque sin fuego en un siglo arde entero, uno que se quema seguido arde poco. Los pueblos que hacen quemas chicas tienen menos incendios grandes y no siempre saben por qué (discovery: una costumbre con mecanismo). Prohibir las quemas acumula la presión.
- **El bosque viejo guarda qi.** La fuente de qi de madera "bosques viejos" (planet-gen §5) es la etapa `old_growth`: talarlo baja el qi de la celda, y ese qi tarda siglos en volver. Las plantas espirituales y sus guardianes viven ahí. Una secta que tala su bosque para construir sus pabellones se queda sin hierbas, y no lo nota hasta tarde.
- **La sucesión cubre la historia.** Los campos abandonados se vuelven matorral y después bosque. Una aldea vaciada por la plaga queda bajo árboles en un siglo: el bosque tiene la edad del abandono ([deep-history.md](deep-history.md) §3: datación por la edad de los árboles sobre una ruina).
- **Fauna con la etapa.** Cada población vive en ciertas etapas (`Niche.habitat`): los herbívoros de pastizal siguen a los claros y a los incendios; los de bosque viejo se van cuando se tala. El paisaje en mosaico (parches de distintas edades) sostiene más especies que uno uniforme.
- **Paisajes hechos por la gente.** El pastoreo mantiene praderas que sin él serían bosque; la roza crea mosaicos; un coto de caza de un noble conserva un bosque que los campesinos no pueden tocar (law: caza furtiva). Quitar a la gente también cambia el paisaje.

## 10. Especies que llegan: dispersión, contacto e invasoras

```ts
interface Introduction {
  id: IntroductionId;
  lineage: LineageId; variant?: VariantId;
  from: CellId; to: CellId;
  vector:
    | { kind: "natural"; via: "land_bridge" | "river" | "wind" | "birds" | "current" | "range_shift" }
    | { kind: "human"; via: "caravan" | "ship" | "army" | "migrants" | "deliberate" | "escape" | "cultivator_storage" }
    | { kind: "realm"; realm: RealmId };   // un reino secreto que colapsa y suelta lo que tenía adentro
  propagules: number;                      // cuántos llegaron: semillas en el grano, ratas en la bodega, una pareja de cabras
  carrierEventId: EventId;                 // el viaje concreto: esta caravana, este barco, este puente abierto
  fate?: "failed" | "lagging" | "established" | "invasive";
}
```

- **Siempre con vector.** Una especie llega en algo concreto. Natural: un puente de tierra que se abre (planet-gen §8), una crecida que baja semillas, aves que llevan semillas en el buche, un rango que se corre con el clima. Humano: semillas de malezas en el grano de una caravana, ratas y sus pulgas en la bodega de un barco, el ganado de unos migrantes, una planta traída a propósito, una bestia que escapa de un criadero de secta, los huevos que un cultivador olvidó en su anillo. Del reino secreto que colapsa sale lo que vivía adentro (secret-realms §8).
- **Establecerse no es seguro.** Depende de cuántos llegaron, del nicho que encuentran (clima, qi, afinidad elemental) y de la resistencia de la comunidad local (competidores, depredadores, enfermedades). La mayoría de las introducciones fracasan. Con el estado decidido, el azar elige.
- **Liberación de enemigos.** La que prende llega sin sus depredadores ni sus parásitos: crece como en casa no podía. A veces pasa décadas en números chicos (fase de latencia) hasta que una variante se adapta o un año bueno la dispara.
- **Lo que hace una invasora:** compite con las nativas, come presas que no saben de ella (las islas y los continentes aislados pierden especies enteras), se cruza con parientes locales, trae patógenos nuevos para la fauna local, cambia el fuego (un pasto que arde más) o el suelo. Una bestia de fuego en un valle de agua choca con el campo (elements): o se adapta, o se apaga, o lo inclina.
- **El intercambio entre continentes.** Cuando dos continentes que no se conocían entran en contacto (planet-gen §5b), viajan cultivos, animales, malezas y enfermedades en las dos direcciones. Unos cultivos nuevos cambian la demografía de un continente (technology: cultivos traídos de lejos); unas enfermedades nuevas vacían otro (body-health: choque de poblaciones). Es uno de los eventos más grandes que la historia puede producir, y sale de las mismas reglas.
- **Plagas de cultivos.** Un monocultivo extenso es una red trófica pobre: una roya, un insecto o un roedor sin enemigos explota. La langosta forma enjambres después de una sequía seguida de lluvias. Cada plaga es una población que explotó con causa.
- **Lo que hace la gente.** Nombra a la especie (con el nombre de donde vino o del enemigo al que culpa), la caza, la quema, la come, la vende, la vuelve plato típico en dos generaciones. A veces introduce un depredador para controlarla, y ese depredador se come otra cosa. Una secta puede soltar bestias a propósito en el territorio de otra (schemes: sabotaje con cadena causal larga).
- **Huella.** Cada población guarda su `originEventId`: el inspector puede seguir la rata del puerto hasta el barco, y un herbolario sabio puede saber que esta hierba "nativa" llegó con los abuelos (discovery: una hipótesis que se puede probar).

## 11. Migraciones y movimientos estacionales

```ts
interface MigrationRoute {
  id: MigrationRouteId;
  lineage: LineageId; populations: PopulationId[];
  path: CellId[];                          // ida y vuelta, con paradas
  phases: { cells: CellId[]; season: SeasonSpec }[];   // dónde está la población en cada parte del año
  cues: Cue[];                             // qué la dispara: largo del día, frío, lluvia, pasto, luna, marea de qi
  bottlenecks: CellId[];                   // vados, pasos, estrechos por donde pasa toda junta
  knownBy: { population: PopulationId; fidelity: number }[];   // la ruta aprendida: memoria de los viejos o instinto
  originEventId: EventId;
}

type Cue =
  | { kind: "photoperiod"; threshold: number }
  | { kind: "temperature"; threshold: number }
  | { kind: "forage"; below: number }      // el pasto se acaba acá
  | { kind: "rain_front" }                  // seguir la lluvia de la estación
  | { kind: "moon"; phase: number }        // desoves y bestias lunares
  | { kind: "qi_tide"; element: ElementId; above: number };   // bestias espirituales que siguen el qi
```

- **Por qué migran.** La estación cambia dónde hay comida, agua, calor o qi; las poblaciones que se mueven con ella aprovechan dos lugares que no podrían sostenerlas todo el año. Herbívoros que siguen el pasto de la lluvia, aves que cruzan medio planeta, peces que remontan los ríos a desovar, bestias espirituales que siguen la luna llena o el pulso de una vena.
- **Instinto o memoria.** Algunas especies llevan la ruta en el instinto (rasgo heredable que la selección afina). Las sociales la **aprenden** de los viejos: si se cazan los viejos, la manada pierde la ruta y se queda en lugares malos o se dispersa (el conocimiento es físico también para las bestias, §7). Una ruta nueva se forma cuando una población la descubre por presión y la sobrevivencia la fija.
- **Cuellos de botella.** Toda la población pasa por el mismo vado o el mismo paso en la misma semana. Ahí hay depredadores esperando, cazadores, emboscadas, festivales, asentamientos y disputas por el derecho a cazar (law, organizations). Calendarios y ritos se ordenan alrededor del paso (§5).
- **Barreras.** Una muralla, una ciudad, un canal, un campo cercado o una formación de protección cortan una ruta. La población se amontona contra la barrera, la rompe, cambia de camino o colapsa. Los pastores y los granjeros pelean por esto (social-structure, war: nómadas contra sedentarios).
- **Irrupciones.** Cuando una población crece mucho o un invierno es duro (presión `beastHunger`), salen fuera de su rango: lobos en las aldeas, bestias que bajan de las montañas, aves que llegan donde nunca llegaban. Las culturas lo leen como presagio (divination §7) y tiene causa.
- **Corrimientos largos.** Con las glaciaciones y los cambios del qi (planet-gen §8, heaven-karma), los rangos enteros se corren a lo largo de generaciones: las especies que no pueden seguir el clima se quedan en refugios (picos, valles cálidos) y quedan aisladas.
- **Gente que sigue animales.** Los pastores trashumantes mueven sus rebaños entre pastos de verano y de invierno por rutas con derechos (contracts: pasos acordados, peajes). Los cazadores siguen las manadas. Su economía, su calendario y su política salen de la ruta (§3).
- **Llevan cosas.** Las migraciones llevan semillas, parásitos y enfermedades entre lugares (§10, body-health): una peste aviar llega con las aves del sur.

## 12. Domesticación y cría

Domesticar no es una tecnología que se desbloquea: es un proceso de muchas generaciones sobre una población concreta, que deja una variante nueva con su origen.

```ts
interface Domestication {
  id: DomesticationId;
  wildLineage: LineageId;
  wildSource: PopulationId;                // la población salvaje de la que salió
  pathway: "commensal" | "prey" | "directed";   // se acercó sola a la basura / se manejó la caza / se capturó a propósito
  breed: VariantId;                        // la variante doméstica que resultó
  keepers: CultureId[];                    // quién sabe criarla (y con qué técnicas: technology)
  startedAt: Tick; establishedAt?: Tick;
  originEventId: EventId;
}

interface Breed {                           // una raza: variante doméstica con su propia distribución de rasgos
  id: VariantId;
  lineage: LineageId;
  parent?: VariantId;                      // razas que salen de razas
  traitMeans: Record<TraitId, number>;     // docilidad, tamaño, leche, lana, velocidad, afinidad elemental…
  selectedFor: TraitId[];                  // lo que buscaban sus criadores
  secretOf?: OrgId | CultureId;            // razas que se guardan (caballos de sangre de dragón, grullas de una secta)
  originEventId: EventId;
}
```

- **Qué especies se pueden.** Depende de rasgos que la especie ya tiene: dieta flexible, crecimiento rápido, que se reproduzca en cautiverio, que no entre en pánico encerrada, que tenga jerarquías que acepten un líder. La mayoría de las especies no cumple. Por eso unas regiones tienen animales de tiro y otras no, y eso cambia su historia (technology: ganadería; war: guerra montada).
- **Tres caminos.** **Comensal:** los animales menos miedosos se acercan a la basura del asentamiento y se quedan (perros, gatos, ratas, cuervos de secta). **Presa:** los cazadores que manejan una manada para no agotarla terminan arreándola. **Dirigido:** alguien que ya sabe criar captura una especie nueva a propósito.
- **Selección.** Los criadores eligen quién se reproduce: cada generación los rasgos se corren hacia lo elegido, y con ellos otros que no se buscaban (docilidad que trae orejas caídas y colores manchados; en bestias espirituales, docilidad que trae un núcleo más débil y menos afinidad). La raza resultante se guarda como `Breed` con origen.
- **Flujo con lo salvaje.** Las razas se cruzan con parientes salvajes (a propósito o no); las que escapan forman poblaciones asilvestradas, que pueden ser invasoras (§10).
- **Ganado como bien vivo.** Un buey es un lote de economy con cuerpo (body-health): come, envejece, enferma, pare, se roba (law: abigeato) y se hereda. En culturas pastoras es riqueza, dote y moneda (economy §2: bienes-moneda). Da tiro, leche, lana, abono para el suelo (planet-gen §9), carne y prestigio.
- **Costos que vienen con el animal.** Las zoonosis (body-health §6: los rebaños densos crían patógenos que saltan a la gente), el sobrepastoreo que erosiona y desertifica (planet-gen §9), la competencia con la fauna salvaje por el pasto, los depredadores que bajan a los corrales.
- **Bestias espirituales domésticas.** Criarlas exige qi (un corral sobre una vena, piedras o píldoras) y saber; da monturas que vuelan, bestias de tiro que no se cansan, guardianes, fuegos de bestia para los hornos (crafts §3), sedas y venenos. Son razas guardadas por sectas y clanes, robadas, contrabandeadas. Pueden **despertar** como cualquier bestia longeva con qi (§2), y la bestia despierta recuerda cómo la trataron.
- **Plantas.** Lo mismo vale para cultivos: el arroz y el trigo domésticos son variantes con origen, seleccionadas por sus granjeros, que se llevan a otras tierras como introducciones deliberadas (§10). Las variedades de hierbas espirituales cultivadas en una secta son razas de plantas.
- **El saber de criar es conocimiento.** Las técnicas de cría, castración, ordeñe, doma y amansamiento son procesos de technology; viven en personas y se pierden (§7). Un pueblo que pierde a sus criadores puede perder la raza.

## 13. Vínculos y contratos con bestias

```ts
interface BeastMind {                      // bestias no despiertas (tier 2-3 cuando importan)
  temperament: { boldness: number; aggression: number; sociability: number; curiosity: number };
  drives: { hunger: number; fear: number; thirst: number; mating: number; territory: number };
  bonds: { with: AgentId; trust: number; fear: number; familiarity: number }[];   // a quién reconoce y qué siente
  learned: LearnedCue[];                   // asociaciones: este silbido trae comida, este olor trae dolor
  imprint?: { on: AgentId | LineageId; at: Tick };   // período sensible: lo primero que vio al nacer
  originEventId: EventId;
}
```

- **Dos casos.** Las bestias **no despiertas** no hacen promesas: se vinculan por aprendizaje (asociación, costumbre, apego). Las **despiertas** son agentes completos: pueden comprometerse, mentir, guardar rencor y firmar tratados con el modelo de [contracts.md](contracts.md).
- **Ganarse una bestia no despierta.** Con tiempo, comida, cuidado y constancia, la bestia aprende a confiar en una persona concreta (la reconoce por el olor, la voz, el aura). **Criar desde la cría** usa el período sensible (npc-psychology §10): lo que la bestia ve al nacer queda como figura de apego. Por eso se roban huevos, y la madre que vuelve al nido vacío recuerda el olor del ladrón (§2: reinos de bestias).
- **Domar por la fuerza.** El miedo también vincula, pero mal: la bestia obedece mientras teme y se vuelve en cuanto el amo se debilita (herido, viejo, en una ruptura fallida). Las bestias maltratadas que despiertan son enemigas de por vida.
- **Contrato de alma (灵兽契约).** Donde la metafísica lo permite, un cultivador ata su alma a la de una bestia con una técnica (contracts §8: contrato de sangre o de alma): comparten esencia, se sienten a distancia, el daño de uno alcanza al otro, la muerte de uno hiere al otro. La bestia tiene que aceptarlo (por vínculo, por estar vencida o por ser cría) o ser más débil que el alma del que ata. Es una atadura con conservación: la esencia que la sostiene sale de los dos.
- **Bestia compañera.** Una bestia contratada crece con su compañero: comparte qi, recibe píldoras y núcleos, cultiva con él. Puede despertar, y entonces el contrato pasa a ser entre dos agentes; si el trato fue malo, la bestia busca romperlo (contracts §8: resistir una atadura duele).
- **Sellos de esclavo sobre bestias.** Igual que sobre personas (social-structure §7): obediencia sin vínculo, resentimiento acumulado, karma para el que sella. Muchos guardianes de reinos secretos son bestias selladas cuyos amos murieron (secret-realms §5).
- **Tratados con bestias despiertas.** Una aldea y un reino de bestias pueden acordar territorio ("no se caza al norte del río"), ofrendas, paso de rebaños o ayuda contra un enemigo común. Es un `Commitment` entre una comunidad y una organización de bestias (organizations: las bestias despiertas forman organizaciones con sus propias normas). Se rompe cuando una generación nueva de cazadores no lo conoce o no lo cree, y la represalia tiene causa.
- **Mercado de bestias.** Crías, huevos, núcleos, sangre, pieles, garras y bestias domadas se venden (economy); algunas especies están protegidas por un código, una secta o un reino de bestias (law: partes protegidas). Un huevo de una especie rara vale fortunas y tiene una madre que lo busca.
- **Karma.** Matar bestias espirituales en masa deja deuda de qi (heaven-karma §6); romper un contrato con una bestia despierta es traición en el libro del Cielo (contracts §9). Salvar una bestia crea una deuda de gracia que la bestia, si despierta, puede reconocer o no según su cultura.

## 14. Cascadas y servicios que nadie ve

La red trófica conecta cosas que la gente no relaciona:
- **Depredadores tope.** Sacar a los lobos sube los ciervos, que comen los brotes del bosque, que deja de regenerar, que pierde el qi de madera, que se lleva las hierbas espirituales. Una recompensa por cada lobo muerto es el principio de esa cadena.
- **Polinizadores y dispersores.** Una peste en las abejas baja las cosechas de frutales; la caza de las aves que comen frutos detiene la expansión de un árbol.
- **Carroñeros y limpieza.** Sin carroñeros los cadáveres duran más, y con ellos los patógenos (body-health §13).
- **Pesca y ríos.** La sobrepesca colapsa un stock que tarda décadas en volver; el sedimento de la erosión (planet-gen §9) ahoga los desoves aguas abajo; los peces que remontan llevan nutrientes del mar al bosque.
- **Bestias que custodian.** Las bestias que comen el qi de un tesoro natural lo protegen de otros consumidores (planet-gen §5). Matarlas expone el tesoro y lo acelera a manos de quien llegue primero.
- **Nadie ve la cadena.** La gente ve sus efectos (menos caza, más ratas, el bosque que no vuelve) y forma hipótesis (discovery): unos culpan a una maldición, otros al vecino, y algún herbolario o un sabio de secta encuentra la causa verdadera, que nadie le cree.

## 15. El jugador y el narrador
- **Nadie ve las poblaciones.** El personaje percibe animales concretos, rastros, cantos, huellas, el bosque que cambia, la caza que escasea, el pasto que no alcanza. El narrador recibe esos percepts, nunca `Population`, `VegetationState` ni las rutas como verdad.
- **El saber ecológico es creencia.** Dónde pasa la manada, cuándo florece la hierba, qué especie llegó con los barcos: lo sabe quien lo vio, lo aprendió de un cazador o lo leyó (information). Un cazador viejo sabe cosas que no están en ningún libro.
- **El jugador puede actuar** sobre todo esto como cualquiera: cazar, quemar, talar, plantar, criar, domar, robar huevos, soltar una especie, proteger un bosque, cortar un vado, pactar con un reino de bestias. Las consecuencias vienen años después y por caminos largos.
- **El inspector** muestra la verdad: poblaciones por celda, redes tróficas, sucesión, combustible, rutas de migración, introducciones con su vector y razas con su origen (`pressures`, `why`: causality §10).

## 16. Escala (LOD)

| Proceso | Cerca del jugador (tier 3-4) | Región activa | Historia profunda |
|---|---|---|---|
| Poblaciones y red trófica | Individuos materializados de un parche coherentes con la población; bestias con `BeastMind` | Poblaciones por celda, paso por estación | Agregado por bioma y época: tendencias, extinciones y especiaciones como eventos |
| Sucesión y fuego | Parches con etapa y edad; incendios con frente | Fracciones por celda, por año | Composición por época; incendios grandes como eventos |
| Invasoras | Introducciones con portador concreto | Frentes de expansión por las rutas | Intercambios entre continentes al abrirse un puente o al cruzar un océano |
| Migraciones | Manadas visibles con rumbo y cuellos de botella | Rutas por estación | Corrimientos de rango con el clima |
| Domesticación y cría | Animales individuales con dueño y cuerpo | Ganado agregado por hogar y aldea | Domesticaciones y razas como eventos de cultura |
| Vínculos con bestias | Bestias compañeras como agentes de tier alto | Bestias contratadas de NPCs importantes | Tratados y guerras con reinos de bestias como eventos |

- **Coherencia.** Al materializar un parche, los individuos respetan los agregados de su población (edades, rasgos, condición), y lo que pasa con ellos (cazados, nacidos) vuelve al agregado.
- **Las bestias de tier alto se siguen.** Una bestia vieja con núcleo, una compañera de un cultivador o un rey de bestias se simulan como agentes a través de las épocas (deep-history: seres longevos).
- **Reservorios.** Una especie extinta en el mundo puede seguir viva adentro de un reino secreto, en un criadero de secta o en huevos guardados en un anillo: su vuelta es una introducción con vector (§10).

## Implementación
- **Fase 3:** plagas y hambrunas (demografía + rutas), conocimiento con soporte. Poblaciones por celda con productividad y red trófica simple; caza, pesca, recolección y tala que agotan stocks; ganado como bien vivo con cuerpo, dueño y zoonosis; sucesión en campos abandonados y barbecho; fuego con combustible (§8, §9, §12).
- **Fase 4:** bestias espirituales con núcleo y consumo de qi; bestia compañera con contrato de alma; criar desde la cría con período sensible (§8, §13).
- **Fase 5:** rutas por costo mínimo, ciudades en cruces. Migraciones estacionales con rutas aprendidas, cuellos de botella y barreras; trashumancia; introducciones por rutas comerciales con fase de latencia; plagas de cultivos; `BeastMind` para monturas, perros y bestias de tier 2-3 (§10, §11, §13).
- **Fase 6:** tratados entre comunidades y reinos de bestias, razas secretas de sectas, mercado de bestias y partes protegidas (§12, §13).
- **Fase 7 (historia):** desastres geológicos y climáticos, culturas por geografía, mitos y calendarios, religiones, lenguas. Domesticaciones y razas como eventos de cultura; especiación por aislamiento; intercambios por puentes de tierra; extinciones; sucesión de largo plazo sobre ruinas (§8-§12).
- **Fase 8:** reinos de bestias, evolución de linajes a escala de mundo, intercambio entre continentes al cruzar océanos (§10).

## Tests
- Ningún desastre sin presión previa medible en el estado.
- Todo mito tiene un evento real como origen.
- Ningún conocimiento sin soporte ni fuente.
- Determinismo de la evolución de bestias con el mismo seed.
- Conservación de individuos: cada población cambia solo por nacimientos, muertes, migraciones e introducciones; toda introducción tiene un vector con `carrierEventId`.
- Conservación de biomasa y nutrientes: lo que se come, se caza o se cosecha sale de una población o del suelo y entra en algo; lo que muere vuelve al suelo.
- Ninguna raza ni variante sin un evento de domesticación o de separación como origen.
- Sin disturbios, la sucesión no retrocede; todo retroceso tiene un evento de disturbio.
- Ningún incendio sin combustible acumulado y una ignición con causa.
- Una población social que pierde a todos sus viejos pierde (o degrada) su ruta aprendida.
- Una barrera sobre una ruta cambia el movimiento de la población que la usa.
- Las bestias espirituales consumen qi de la celda (el ledger de qi cuadra).
- Determinismo: mismo seed → mismas poblaciones, rutas, introducciones y razas tras N años.

## Decisiones tomadas en este borrador (revisables)
- **Poblaciones por celda como unidad**, con rasgos heredables (media y varianza) y red trófica; los individuos se materializan coherentes con el agregado.
- **La productividad sale de clima, suelo y qi**; la capacidad de carga no es un parámetro, emerge.
- **Sucesión por etapas con trayectorias por bioma**, disturbios con evento y fuego como presión de combustible; el bosque viejo es la fuente de qi de madera.
- **Toda especie llega con un vector concreto**; la mayoría de las introducciones fracasa y las que prenden pueden tardar en explotar.
- **Las rutas de migración de las especies sociales se aprenden** y se pierden con los viejos.
- **Domesticar es un proceso de generaciones** sobre una población concreta y deja una raza con origen; el ganado es un bien vivo con cuerpo.
- **Bestias no despiertas con `BeastMind`** (aprendizaje y apego), despiertas como agentes completos; los vínculos con unas y los contratos con otras salen de la misma psicología y de contracts.
- **Las bestias domesticadas pueden despertar**, con menor probabilidad, y recuerdan cómo las trataron (aprobado 2026-10-06).
- **Las bestias despiertas forman culturas con lengua generada**, normas y toponimia propias; negociar exige la lengua o un intérprete (aprobado 2026-10-06).

## Preguntas abiertas
- Calibración: velocidad de sucesión por bioma y clima; curva de hazard de incendio por combustible y sequía; probabilidad de establecimiento por propágulos y duración de la latencia; tasas de crecimiento y respuesta funcional por linaje; generaciones necesarias para una raza; cuánto tarda una manada en perder o rehacer una ruta; efecto de la domesticación sobre el núcleo de las bestias espirituales.
