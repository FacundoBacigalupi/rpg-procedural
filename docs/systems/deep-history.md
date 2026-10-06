# Historia profunda — simular por relevancia, no por años

> Problema planteado: algo de hace 100.000 años puede seguir afectando el mundo, mientras el resto de esa época no importa. Y hay cultivadores de 1.000 años vivos que sí hay que simular. No sirve "simular N años".

> Estado: el embudo, los legados y el criterio de olvido están decididos (2026-10-05). La arqueología (§1-§11) está en borrador desde el 2026-10-06.

Depende de: [causality.md](causality.md) (procedencia, la historia es la misma sim en modo agregado), [planet-gen.md](planet-gen.md) (sedimentación, glaciaciones, nivel del mar, suelos, volcanes), [living-world.md](living-world.md) (lenguas generadas, mitos como historia deformada, sucesión sobre ruinas), [perception.md](perception.md) (huellas), [discovery.md](discovery.md) (hipótesis y evidencia), [chronicle.md](chronicle.md) (textos como objetos).
Lo usan: [secret-realms.md](secret-realms.md) (los reinos son legados), [spirits.md](spirits.md) (ajuar enterrado, santuarios viejos), [state.md](state.md) (legitimidad que se apoya en el pasado), [economy.md](economy.md) (mercado de antigüedades), [law.md](law.md) (saqueo de tumbas), [chronicle.md](chronicle.md) (la verdad detrás de las ruinas).

---

## Idea: un embudo hacia el presente

La historia se simula **hacia adelante** (para respetar la causalidad), pero a una **resolución que crece a medida que nos acercamos al presente**. Al cerrar cada época, el mundo **olvida** todo lo que ya no tiene efecto.

```
   pasado profundo                                          presente
   ───────────────────────────────────────────────────────────────►
   [ eones ]  [ eras ]  [ milenios ]  [ siglos ]  [ décadas ]  [ días ]
    muy grueso ──────────── resolución creciente ─────────── individuos
         │          │           │           │           │
       olvido     olvido      olvido      olvido      olvido
```

El costo depende de **cuánto importa** cada época, no de cuántos años dura.

## Qué sobrevive entre épocas (los "legados")

Al cerrar una época, solo pasa a la siguiente lo que todavía **existe físicamente, vive o se recuerda**. Todo lo demás se compacta en un resumen sin detalle.

| Tipo de legado | Ejemplos | Cómo dura |
|---|---|---|
| **Geológico / metafísico** | Costa sumergida con sus ruinas, puente de tierra cerrado ([planet-gen.md](planet-gen.md) §8), cráter de una batalla de inmortales, vena de qi destrozada, sello sobre una bestia, cicatriz en el Cielo | Indefinidamente, se erosiona muy lento |
| **Objetos** | Ruinas, reinos secretos y lugares sellados ([secret-realms.md](secret-realms.md)), armas, manuscritos, arrays todavía activos, cadáveres de bestias antiguas | Se degradan con el tiempo; pueden destruirse o ser encontrados |
| **Seres longevos** | Cultivadores de 1.000 años, bestias antiguas, espíritus, almas selladas | **Se siguen simulando** como agentes Tier 3 a través de las épocas |
| **Conocimiento** | Técnicas, historia escrita, profecías | Mientras haya portadores o registros |
| **Cultura / memoria colectiva** | Leyendas (cada vez más distorsionadas), religiones, tabúes, odios ancestrales | Se transmite y se deforma |
| **Linajes** | Sangre de un ancestro poderoso, maldiciones, karma heredado | Se diluye por generación, puede reactivarse |
| **Estado del Cielo** | Su fuerza, sus heridas, su "memoria" de las rebeliones | Variable global de largo plazo |

Ejemplo: hace 100.000 años, una guerra entre inmortales y el Cielo. De toda esa era sobreviven solo tres cosas: el Cielo herido (que explica la era actual), un continente partido (geografía) y un sello en el fondo del mar (un objeto con un ser dentro). Los imperios, las personas y las ciudades de esa época se compactaron en "civilización X existió, cayó". Puede haber ruinas sueltas si su degradación todavía no terminó.

## Resolución según lo que se simula

- **Épocas profundas:** solo procesos planetarios y del Cielo, civilizaciones como bloques y los seres más poderosos. Pasos de siglos o milenios.
- **Épocas intermedias:** naciones, grandes sectas y linajes. Pasos de años o décadas. Personas solo si son Tier 3.
- **Últimos siglos:** organizaciones completas, asentamientos y familias importantes.
- **Últimas décadas:** población de la región inicial con individuos (lo que van a recordar los NPCs vivos).
- **Presente:** simulación completa alrededor del jugador.

Un ser longevo que vive en varias épocas **fuerza más resolución a su alrededor**. El maestro de 1.000 años necesita que su secta y sus enemigos tengan historia detallada; un imperio sin sobrevivientes no.

## Cuánto tiempo hacia atrás

No es fijo: lo decide el seed a partir de la cosmología, con cosas como la edad del planeta, cuándo apareció la vida inteligente y cuándo se descubrió el cultivo. Un mundo joven puede tener 5.000 años de historia relevante, y uno antiguo, cientos de miles (aunque casi todo compactado).

---

# Arqueología: el pasado como evidencia

El embudo deja legados físicos. La arqueología es la manera de leerlos desde adentro del mundo: el jugador (y cualquier NPC) puede reconstruir qué pasó hace mil años con lo que quedó bajo tierra, en las piedras, en los nombres de los lugares y en los textos, con los mismos errores con forma que cualquier otra investigación.

## Principios
1. **El pasado está en la verdad.** Cada estrato, objeto enterrado y nombre de lugar existe en `WorldTruth` con su `originEventId`. Excavar no inventa nada: revela lo que la historia dejó.
2. **La arqueología es percepción más descubrimiento.** Ver un estrato es percepción ([perception.md](perception.md) §9: huellas); entender qué significa es formar hipótesis sobre eventos pasados con evidencia ([discovery.md](discovery.md) §2-§3). Las mismas reglas, aplicadas al pasado en vez de a las leyes.
3. **El contexto es información que se destruye.** Un objeto sacado de su estrato sin registro conserva su valor material, pero pierde para siempre lo que decía su posición. Saquear es quemar un libro que nadie leyó.
4. **Detalle diferido con restricciones.** Lo que nadie excavó puede quedar como un resumen estadístico (`assemblage`). Al excavar, los objetos se materializan coherentes con el resumen y con el sub-stream del depósito, así que el mismo seed da siempre los mismos hallazgos ([secret-realms.md](secret-realms.md) §7: el mismo mecanismo).
5. **El mundo no espera al jugador.** Saqueadores, anticuarios, sectas que buscan técnicas perdidas y cortes que buscan legitimidad excavan por su cuenta, y lo que encuentran (o creen encontrar) cambia el presente.

## 1. Depósitos y estratos

Cada celda con algo que contar tiene un **depósito**: una pila de capas formadas por procesos físicos y humanos, de la más vieja (abajo) a la más nueva (arriba).

```ts
interface Deposit {
  cell: CellId;
  site?: SiteId;                       // si es un asentamiento, una tumba, un campo de batalla
  strata: Stratum[];                   // de abajo hacia arriba
  disturbances: Disturbance[];         // lo que rompió el orden (§1)
}

interface Stratum {
  id: StratumId;
  depth: { top: number; bottom: number };   // en metros, según tasas de acumulación y erosión
  formed: { from: Tick; to: Tick };         // verdad: cuándo se formó
  process: StratumProcess;
  contents: Find[] | Assemblage;            // objetos ya fijados, o resumen diferido (Principio 4)
  originEventId: EventId;                   // la crecida, la erupción, la ocupación, el incendio
}

type StratumProcess =
  | "flood_silt" | "loess" | "volcanic_ash" | "glacial_till" | "marine"     // naturales (planet-gen)
  | "soil" | "peat" | "forest_litter"                                        // suelos y sucesión (planet-gen §9, living-world §9)
  | "occupation" | "floor" | "midden" | "fill" | "collapse" | "burn"         // humanos
  | "grave" | "tomb" | "construction";

interface Assemblage {                 // lo que hay, sin fijar cada pieza
  culture: CultureId;
  styleStage: StyleStageId;            // en qué etapa de su secuencia de estilos estaba (§3)
  density: Record<FindClass, number>;  // cerámica, metal, hueso, carbón, jade, monedas, textos, restos de qi
  notable?: LegacyId[];                // legados que el embudo conservó con identidad (un arma, una tablilla, un cuerpo)
  seed: SubstreamId;                   // rng.fork("deposit", celda, estrato)
}

interface Disturbance {
  kind: "pit" | "looting" | "burrow" | "roots" | "plowing" | "earthquake" | "flood_scour" | "later_grave" | "reuse";
  affects: StratumId[];
  eventId: EventId;
}
```

- **De dónde salen las capas.** Las naturales salen de planet-gen: limo de las crecidas de un río, loess traído por el viento en las eras secas, ceniza de una erupción (§10 de planet-gen), till de un glaciar que avanzó, sedimento marino donde el mar subió (§8 de planet-gen). Las humanas, de la ocupación: pisos, basureros, rellenos, derrumbes, capas de incendio.
- **Los asentamientos crecen hacia arriba.** Una ciudad que se reconstruye sobre sus propios escombros durante siglos forma un montículo (tell): diez ciudades apiladas, cada una con su capa de destrucción. La altura del montículo es una pista de cuánto tiempo estuvo habitado.
- **Capas que marcan el tiempo en toda una región.** La ceniza de una misma erupción cae en todas las celdas bajo su pluma: es un horizonte que aparece igual en sitios distantes y permite decir "esto es anterior a la gran ceniza" en todos ellos. Lo mismo pasa con una capa de incendio por una guerra que quemó muchas aldeas el mismo año, o el sedimento de una inundación enorme.
- **La superposición vale en la verdad, pero se rompe.** Lo de abajo es más viejo, salvo donde algo lo revolvió: una fosa cavada después, madrigueras, raíces, el arado, un terremoto, una tumba nueva metida en una capa vieja, piedras reutilizadas en una pared posterior. Cada perturbación es un evento registrado, y es la fuente de los errores con forma (§4).
- **La erosión también borra.** Donde el terreno erosiona (pendientes, ríos que cambian de cauce, costas que retroceden) las capas desaparecen, y con ellas los legados (deep-history: el embudo los olvida si no queda nada físico).

## 2. Qué se conserva

Lo que sobrevive depende del **material** y del **ambiente** del depósito, con tasas por par material–ambiente en `content/`.

| Material | Se conserva bien en | Desaparece en |
|---|---|---|
| Hueso y dientes | Suelos neutros o alcalinos, cuevas secas | Suelos ácidos (bosques de coníferas, turba ácida) |
| Madera, textiles, cuero, papel | Desierto seco, turba anegada, hielo, tumbas selladas | Casi cualquier suelo húmedo en décadas |
| Bronce y cobre | La mayoría de los suelos (con pátina) | Agua salada, suelos muy ácidos |
| Hierro | Ambientes secos o anaeróbicos | Suelos húmedos: se vuelve una mancha de óxido en siglos |
| Oro, jade, piedra, cerámica cocida | Casi todos | Casi nada (se rompen, no se pudren) |
| Carbón vegetal, semillas carbonizadas | Casi todos | Erosión |
| Cuerpos | Hielo, turba, desierto, sal; tumbas con técnicas de conservación | Lo demás |

- **Materiales espirituales.** Los objetos con qi se degradan según su calidad y el campo de la celda: un artefacto puede conservar su núcleo milenios aunque su forma se haya corroído; una píldora vieja puede seguir activa (y volverse tóxica). Los artefactos con espíritu de objeto ([spirits.md](spirits.md) §1) pueden seguir despiertos bajo tierra.
- **Las huellas de qi.** Los residuos de técnicas comunes se borran en meses ([perception.md](perception.md) §9), pero los eventos enormes (una batalla de inmortales, una tribulación, la muerte de una bestia antigua) dejan **cicatrices en el campo** que duran milenios: una celda con el elemento torcido, rocas cristalizadas con el qi del momento, una vena desviada.
- **La memoria de los cristales.** Algunos minerales crecen absorbiendo el campo de la celda y registran su mezcla elemental capa por capa, como anillos. Un cultivador que sepa leerlos puede ver cómo cambió el campo de un lugar durante siglos (§3). Es un método real en la familia xianxia (metaphysics) y otras familias pueden no tenerlo.
- **El ajuar enterrado** de los santuarios y tumbas ([spirits.md](spirits.md) §11) sigue estas reglas. Las tumbas ricas suelen tener cámaras selladas que conservan más, y por eso son lo que más se saquea.

## 3. Datación

Saber **cuándo** es una inferencia. Cada método es conocimiento (se aprende, se inventa, se pierde: [technology.md](technology.md), discovery) y da una **estimación con error**, nunca la fecha real.

```ts
interface DatingEstimate {
  target: FindId | StratumId | SiteId;
  method: DatingMethod;
  range: { from: Tick; to: Tick };       // en el calendario del que estima (living-world §5)
  confidence: number;
  assumptions: BeliefRef[];               // lo que el método da por cierto (y puede ser falso)
  by: AgentId;
  eventId: EventId;
}
```

| Método | Cómo funciona | Errores con forma |
|---|---|---|
| **Superposición** | Lo de abajo es más viejo | Perturbaciones (§1) que el que excava no vio |
| **Tipología y seriación** | Los estilos de cerámica, armas, monedas, escritura y arquitectura de cada cultura cambian en secuencia (generada en la historia, no en una tabla). Quien conoce la secuencia ubica una pieza en ella | Piezas heredadas que se usaron siglos (reliquias), estilos arcaizantes a propósito, culturas vecinas con secuencias parecidas |
| **Inscripciones y monedas** | Nombres de reinados, años de un calendario | Hay que saber la lengua, la escritura y **correlacionar calendarios** (living-world §5): "año 12 del Emperador Grulla" no dice nada si nadie sabe cuándo reinó |
| **Anillos de árboles** | Los árboles sobre una ruina dan una edad mínima de abandono ([living-world.md](living-world.md) §9); una viga con suficientes anillos se puede encajar en una secuencia regional de años buenos y malos | La madera reutilizada de una construcción más vieja; secuencias que nadie armó |
| **Marcadores regionales** | La ceniza de una erupción conocida, una capa de incendio de una guerra documentada (§1) | Confundir dos erupciones del mismo volcán |
| **Pátina, corrosión, acumulación** | Velocidades de corrosión o de sedimentación aproximadas | Dependen del ambiente; una pátina se puede falsificar (§6) |
| **Decaimiento de qi** | Un cultivador lee cuánto qi residual queda en un objeto o una cicatriz y estima su edad según cuánto tarda en disiparse (el equivalente xianxia del carbono) | El campo de la celda lo recarga o lo drena; una formación lo conserva; objetos que se usaron hace poco |
| **Memoria de cristales** | Lectura de las capas de un cristal (§2) | Solo sirve donde crecieron cristales; leerlo exige sentido espiritual fino |
| **Testigos longevos** | Un cultivador de mil años, un espíritu o una bestia antigua recuerdan | Memoria comprimida en gist y sesgada ([npc-psychology.md](npc-psychology.md): memoria de siglos); pueden mentir |
| **Lectura metafísica** | Leer el karma o la historia de un objeto ([divination.md](divination.md) §2) | Ruido, velos, reacción del Cielo, y la interpretación en símbolos |

- **Las fechas viven en calendarios.** El que estima expresa el resultado en su calendario. Que dos eruditos de culturas distintas coincidan exige saber cómo se traducen sus calendarios, y eso también es conocimiento que se arma.
- **Varias fuentes convergen.** Una estimación que cruza estratigrafía, tipología y una moneda es mucho más confiable que una sola. Es la misma actualización bayesiana de discovery §3 aplicada a una fecha.

## 4. Interpretar: hipótesis sobre el pasado

Lo que se reconstruye no es una ley, es un **evento**: quién construyó esto, qué lo destruyó, quién está enterrado acá, por qué se abandonó. Son hipótesis con la estructura de discovery §2, sobre una pregunta histórica en vez de una `LawKey`.

```ts
interface PastQuestion {
  id: PastQuestionId;
  about: SiteId | FindId | StratumId | PlaceNameId | MythId;
  asks: "who" | "when" | "what_happened" | "why_abandoned" | "what_for" | "where_from";
}

interface PastHypothesis {               // misma forma que Hypothesis de discovery, con otra clave
  question: PastQuestionId;
  claim: PastClaim;                      // "la ciudad la quemó un ejército del oeste hacia el año 300 del calendario X"
  predicts: (probe: Probe) => Distribution<FindClass | StratumProcess | Reading>;   // qué esperar si se cava ahí, si se lee aquello
  origin: HypothesisOrigin;              // tradición (el mito local), contada, generada, del jugador
}
```

- **La evidencia** son los hallazgos, los estratos, las estimaciones de datación, los textos ([chronicle.md](chronicle.md) §1), los mitos (living-world §4: cada mito guarda un puntero causal al evento real) y los nombres de lugares (§5).
- **Las hipótesis predicen.** "Si la quemaron, debería haber una capa de incendio con puntas de flecha del oeste" se puede poner a prueba cavando en otro sector: es un experimento (discovery §4).
- **Errores con forma** (discovery §5):
  - Una fosa posterior que mete objetos nuevos en una capa vieja ("encontraron hierro en la capa de bronce: ¡conocían el hierro!").
  - Reliquias y reuso: la espada antigua que alguien guardó tres siglos; la estela vieja usada como escalón.
  - Sesgo de conservación: se encuentra lo que dura (piedra, cerámica, oro) y se concluye que esa cultura no usaba madera ni textiles.
  - Sesgo del que busca: el erudito de la corte encuentra lo que confirma la antigüedad de la dinastía; el de la secta, la gloria del fundador.
  - Leer el mito literalmente ("el dios dragón") o descartarlo del todo (y perder el puntero a un evento real).
  - Falsificaciones (§6).
- **La verdad puede no estar en la lista.** Si nadie piensa que la ciudad la destruyó una plaga y no una guerra, ninguna excavación lo va a confirmar: solo van a aparecer anomalías (no hay puntas de flecha, hay fosas comunes sin heridas).

## 5. Nombres de lugares como pistas

Un lugar acumula **capas de nombres** como acumula estratos. Cada pueblo que pasó por ahí le puso su nombre en su lengua, y los que vinieron después lo heredaron deformado.

```ts
interface PlaceName {
  id: PlaceNameId;
  place: CellId | SiteId | FeatureId;      // un río, una montaña, un pueblo, un paso
  form: string;                            // la forma actual en esta lengua
  language: LanguageId;
  meaning?: Gloss;                         // lo que significa (si lo significa) en su lengua
  derivedFrom?: PlaceNameId;               // el nombre anterior del que salió
  soundChanges: SoundChangeId[];           // los cambios fonéticos que lo llevaron de aquel a este (living-world §3)
  folkEtymology?: { meaning: Gloss; myth?: MythId };   // el significado nuevo (falso) que le dieron los que ya no entendían el viejo
  givenBy: EventId;                        // fundación, conquista, un evento que se recordó, una bestia que vivía ahí
}
```

- **Los nombres guardan hechos.** Se nombra lo que había: "Lago Salado", "Colina Quemada", "Vado de los Diez Mil", "Tumba del Dragón", "Bosque de los Robles". El lugar puede haber cambiado (el lago se secó en un cambio de clima de planet-gen §8, el bosque se taló hace siglos) y el nombre sigue diciendo lo que fue.
- **Los nombres viejos se deforman con la lengua que los hereda.** Con las reglas de cambio fonético de living-world §3, *kul-mar* ("lago de sal" en una lengua muerta) se vuelve "Hulmar", que para los de ahora no significa nada. Quien conoce las leyes fonéticas de esa familia de lenguas puede reconstruir la forma original y su significado. Esa reconstrucción es una hipótesis con evidencia, como cualquier otra.
- **Nombres redundantes.** Cuando un pueblo nuevo no entiende el nombre viejo, le agrega el suyo: "Río Hulvar" donde *hulvar* ya significaba "río". Son pistas de una capa de lengua anterior.
- **Etimologías populares.** Cuando un nombre ya no se entiende, la gente le inventa un significado que sí entiende, y muchas veces un mito para explicarlo: "Hulmar" se oye como "Ala Marchita" y aparece la leyenda de un fénix caído. El mito es falso, pero su existencia es una pista de que el nombre es más viejo que la lengua.
- **Mapas de pueblos que ya no existen.** La distribución de un elemento de nombre (todos los lugares con *-mar* o *-tok*) dibuja dónde vivió un pueblo desaparecido y hasta dónde llegó su frontera.
- **El nombre de una cosa dice de dónde vino.** Las especies, las técnicas y los objetos importados llegan con el nombre de su origen (living-world §3, §10): una palabra prestada es evidencia de contacto.
- **Generación.** Los nombres salen de la historia: cada pueblo que funda, conquista o recuerda algo nombra con su léxico generado, y cada siglo aplica los cambios fonéticos de su lengua. El LLM nunca inventa topónimos: cita los del léxico.

## 6. Excavar

Excavar es una **sesión de oficio** ([crafts.md](crafts.md) §1) en un depósito concreto: pasos que resuelve la ley, con herramientas, mano de obra y tiempo.

- **Habilidad:** control (cavar sin romper, seguir el límite de una capa), sentidos (notar un cambio de color en la tierra, una huella de poste podrido, un hilo de qi) y juicio (decidir dónde cavar y qué significa lo que aparece). Se aprende practicando.
- **Rápido o cuidadoso.** Cavar rápido saca objetos y destruye el contexto (Principio 3). Cavar con cuidado y registrar (dibujos, notas, la posición de cada pieza) produce un **registro de excavación**, un objeto que conserva el contexto para quien venga después ([chronicle.md](chronicle.md): textos como objetos).
- **Peligros con causa:**
  - Derrumbes en zanjas y túneles; tumbas con trampas y formaciones todavía activas ([secret-realms.md](secret-realms.md): lugares sellados).
  - Espíritus reales: el dueño de la tumba que se quedó, guardianes atados, resentidos de una fosa común ([spirits.md](spirits.md) §1).
  - Miasmas: qi yin acumulado, gases de cámaras selladas, enfermedades de cuerpos viejos ([body-health.md](body-health.md)).
  - Artefactos con espíritu propio que no quieren salir, o que eligen dueño.
- **Peligros sociales:** muchas tumbas son de alguien. Cavar un cementerio de clan es profanación ([law.md](law.md), spirits §7); el estado puede reclamar lo que aparece; la aldea puede tener un tabú sobre la colina (que a veces existe por una razón real que nadie recuerda).
- **Lo que se encuentra se fija.** Al excavar un estrato con `Assemblage`, los objetos se materializan con su sub-stream y pasan a ser verdad persistente. Lo que no se excavó queda diferido.

## 7. Saqueadores, anticuarios y el mercado

- **Saqueo de tumbas** como oficio y como organización ([law.md](law.md) §13): bandas que saben leer el terreno, encontrar cámaras y desarmar trampas. Venden a intermediarios y destruyen el contexto de todo lo que tocan.
- **Mercado de antigüedades** ([economy.md](economy.md)): el precio sale de lo que el comprador cree sobre la edad, el origen y el poder del objeto. Una procedencia ilustre ("de la tumba del Rey Grulla") multiplica el precio, y por eso se inventa.
- **Falsificaciones** (crafts): pátina inducida, inscripciones nuevas en piedras viejas, piezas armadas con fragmentos de varias, qi residual implantado con una técnica. Detectarlas es datación (§3) con un sospechoso.
- **Coleccionistas y eruditos:** nobles, sectas y templos compran y estudian. Escriben catálogos y tratados que son textos con autor y sesgo ([chronicle.md](chronicle.md) §2).
- **Sectas que buscan técnicas perdidas** (living-world §7: las técnicas perdidas son reales). Un rumor de una cueva de herencia mueve expediciones, rivalidades y muertes.

## 8. El pasado en el presente

Lo que se encuentra (o se cree encontrar) cambia el mundo:
- **Legitimidad:** una dinastía que se dice heredera de un imperio antiguo financia excavaciones que lo confirmen y oculta las que lo desmienten ([state.md](state.md): legitimidad). Un hallazgo que prueba que el mito fundador es falso es un arma política.
- **Reclamos:** "esta tierra fue nuestra": las ruinas y los nombres sostienen pretensiones territoriales de clanes, sectas y reinos.
- **Cultos que vuelven:** una estatua desenterrada puede reavivar un culto ([spirits.md](spirits.md) §9), y a veces había un espíritu esperando.
- **Karma que reaparece:** una deuda de sangre de hace diez mil años puede seguir abierta (heaven-karma: las deudas enormes pasan al linaje), y el descendiente que encuentra la tumba del acreedor tiene un problema.
- **Cosas selladas:** el sello en el fondo del mar del ejemplo de arriba es un legado. Romperlo por accidente mientras se excava es un evento con causa y con consecuencias.
- **Conocimiento recuperado:** una técnica, una receta o un proceso perdido que reaparece cambia el equilibrio de poder (discovery §11, technology §8).

## 9. El jugador y el narrador
- **El narrador describe lo que el personaje percibe**: "una capa oscura de ceniza, fragmentos de cerámica roja con un motivo en espiral, un olor a qi viejo y frío". Nunca dice "esto es de la dinastía Xu, hace 3.000 años" salvo que el personaje lo sepa o lo infiera, y en ese caso lo dice como creencia del personaje, con su confianza.
- **El jugador investiga con acciones libres:** cavar acá o allá, comparar con otro sitio, consultar a un erudito, aprender una lengua muerta, buscar un testigo longevo, pagarle a un adivino. Cada acción produce evidencia que actualiza sus hipótesis.
- **Las pistas pasan por la percepción y la información.** El jugador puede llegar a una reconstrucción falsa y actuar sobre ella; la crónica final ([chronicle.md](chronicle.md) §5: lo que nunca supiste) muestra qué era de verdad.
- **El usuario puede proponer hipótesis** ("creo que este nombre viene de la lengua de los Kul"), que entran como hipótesis del personaje (discovery §14) y se evalúan con la evidencia que tenga.

## 10. Escala (LOD)
- **Solo hay depósitos donde hay algo que contar:** sitios con legados, asentamientos, tumbas, campos de batalla. El resto de las celdas tiene una columna geológica genérica derivada de planet-gen (tasas de sedimentación y erosión por época), sin contenidos.
- **Los contenidos de las épocas compactadas son `Assemblage`:** por estrato, la cultura, la etapa de estilo y las densidades. Las piezas se fijan solo al excavar (Principio 4).
- **El embudo tiene que guardar lo necesario para la arqueología.** Al compactar una época, el resumen conserva por región las culturas presentes, sus secuencias de estilos, los eventos de destrucción, las lenguas y los topónimos, para que las preguntas arqueológicas tengan respuesta en la verdad.
- **Los depósitos mantienen vivos los hechos.** El criterio de olvido (arriba) cuenta "si existe algo físico": un estrato con contenido mantiene un puntero causal mínimo a su evento aunque nadie lo recuerde.
- **Topónimos:** cada lugar con nombre guarda su cadena de derivación completa (es barata); los cambios fonéticos se aplican por lengua y por siglo en la historia agregada.
- **NPCs que excavan** en LOD bajo: tasa de saqueo por región según pobreza, riqueza enterrada y ley; hallazgos agregados que alimentan el mercado de antigüedades. Se materializan cuando el jugador se cruza con ellos.

## 11. Implementación
- **Fase 4 (cultivo):** lugares sellados y tumbas simples con contenido diferido (ya está en secret-realms); lectura de qi residual como método de datación.
- **Fase 5 (región):** depósitos en los sitios de la región, estratos con perturbaciones, excavar como sesión de oficio, saqueo de tumbas con contexto destruido.
- **Fase 7 (historia):** estratos generados por la historia agregada (procesos naturales y ocupación, montículos, horizontes de ceniza), `Assemblage` al compactar, secuencias de estilos por cultura, topónimos en capas con cambio fonético y etimologías populares, cicatrices de qi y memoria de cristales.
- **Fase 8 (mundo completo):** mercado de antigüedades y falsificaciones, eruditos y tratados, arqueología como arma de legitimidad, correlación de calendarios entre culturas.

## Tests
- Ningún hallazgo sin estrato ni `originEventId`; todo lo materializado es coherente con el `Assemblage` y los legados del estrato.
- Determinismo: excavar el mismo estrato con el mismo seed da los mismos hallazgos, en cualquier orden de excavación.
- La superposición se cumple en la verdad salvo donde hay una `Disturbance` registrada.
- Una erupción deja la misma capa de ceniza en todas las celdas de su pluma, con el mismo `originEventId`.
- Cada topónimo tiene una cadena de derivación que termina en un evento de nombramiento y una lengua; aplicar los cambios fonéticos a la forma vieja da la forma actual.
- Saquear destruye el contexto: después de un saqueo, ninguna hipótesis puede usar la posición de esos objetos como evidencia.
- Las estimaciones de datación contienen la fecha real con la frecuencia que dice su confianza (calibración, ignorando los errores con forma introducidos a propósito).

## Decisiones tomadas en el borrador de arqueología (2026-10-06, revisables)
- **Estratos en la verdad con detalle diferido:** depósitos por sitio, `Assemblage` al compactar, hallazgos que se fijan al excavar con su sub-stream.
- **La arqueología reutiliza discovery:** hipótesis sobre preguntas históricas, evidencia, experimentos y errores con forma; no hay un sistema aparte.
- **La datación siempre es una estimación** con método, error y supuestos; los calendarios se tienen que correlacionar.
- **Los topónimos son capas con derivación** (cambio fonético, nombres redundantes, etimologías populares) y son evidencia de lenguas y pueblos desaparecidos.
- **El contexto se destruye al saquear** y se conserva en registros de excavación como objetos.
- **En la familia xianxia hay métodos metafísicos de datación** (decaimiento de qi, memoria de cristales, lectura de karma), con sus propios errores.

## Decisiones (2026-10-05)
- **El jugador no ve el pasado profundo directamente.** Solo lo descubre por legados (ruinas, leyendas, seres antiguos, textos) y a través de percepción e información, así que puede llegarle distorsionado o falso.
- **Criterio de olvido: puntaje de influencia.** Combina (a) cuántos agentes vivos lo recuerdan, (b) si existe algo físico (ruina, objeto, cuerpo, técnica escrita) y (c) cuánto karma sigue abierto. Un hecho se olvida entre épocas cuando los tres llegan a cero; los pesos se calibran con la sim headless.

## Preguntas abiertas
- Calibración de las reglas agregadas contra las individuales (ver causality.md §5.1): es trabajo técnico de la sim headless, no una decisión de diseño.
- Calibración de la arqueología: tasas de sedimentación y erosión por proceso; curvas de conservación por material y ambiente; frecuencia de perturbaciones; ritmo de cambio de estilos por cultura; cuánto sobreviven los topónimos a un cambio de lengua; tasa de saqueo por región; granularidad de los `Assemblage`.
