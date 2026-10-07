# Oficios

> Estado: **borrador de diseño**. Cómo se hacen las cosas: alquimia, forja y refinación de artefactos, formaciones, talismanes, y los oficios mortales (medicina, metalurgia, cocina, tejido, alfarería) con el mismo modelo. Un oficio es un **proceso por pasos** sobre materiales reales, que la ley resuelve con la física elemental de [elements.md](elements.md) y la física mundana, guiado por una **receta** (lo que el artesano cree), ejecutado con una **mano** (lo que sabe hacer) y vigilado con unos **sentidos** (lo que percibe mientras trabaja).

Depende de: [elements.md](elements.md) (`interact`, tensión, contención, derivados), [economy.md](economy.md) (bienes como lotes con origen, producción, metal escaso, piedras espirituales, calidad incierta, gremios), [discovery.md](discovery.md) (recetas como saber, inventar procesos, `flaws` donde la creencia diverge de la ley, obras con intención), [cultivation.md](cultivation.md) (esencia del artesano, fuego propio, píldoras y tesoros como insumos del cultivo, camino del arma), [body-health.md](body-health.md) (sustancias, toxicidad de píldoras, medicina, heridas de un horno que revienta), [perception.md](perception.md) (vigilar el trabajo, tasar, detectar falsificaciones, formaciones que engañan los sentidos), [planet-gen.md](planet-gen.md) (minerales, metales espirituales, fuego de tierra, qi de cada celda), [causality.md](causality.md) (conservación, procedencia), [npc-psychology.md](npc-psychology.md) (habilidades que salen de lo que se hizo, fatiga, concentración), [information.md](information.md) (recetas secretas, filtraciones), [organizations.md](organizations.md) (gremios, salones de alquimia de secta, maestro y aprendiz). Lo usan: [spirits.md](spirits.md) (espíritus de objeto, estandartes de almas), [heaven-karma.md](heaven-karma.md) (objetos que desafían al Cielo, karma de refinar almas), [contracts.md](contracts.md) (encargos), [law.md](law.md) (contrabando, falsificación), [war.md](war.md) (armas, formaciones de asedio), y [technology.md](technology.md) (procesos mortales que se descubren y difunden).

## Principios
1. **Hacer es un proceso, no una tirada.** Un oficio es una secuencia de pasos (preparar, mezclar, calentar, sostener, enfriar, golpear, templar, inscribir, cargar) y cada paso cambia el estado real del trabajo. El resultado es lo que quedó al final, no un número sacado de una tabla de éxito.
2. **La ley resuelve; la receta propone.** La receta es lo que el artesano **cree** que hay que hacer y lo que cree que va a salir. La ley (física mundana y elemental) calcula lo que sale. Los defectos de una receta son los lugares donde la creencia diverge de la verdad (discovery §10).
3. **Conservación.** Todo producto sale de insumos concretos con origen. El metal que entra está en la espada o en la escoria; el qi de las hierbas está en la píldora, en la toxina residual o en el aire del taller; las piedras que alimentan una formación se gastan. Nada se crea por habilidad.
4. **La mano es del artesano.** La habilidad no es un nivel: es control (cuánto se aparta lo que hace de lo que quiere hacer), sentidos (cuánto ve del estado del trabajo) y oficio (qué sabe reconocer y corregir). Sale de lo que practicó (npc-psychology: habilidades por acciones registradas) y se nota en lo que produce.
5. **El fracaso tiene forma.** Un horno que revienta, una espada que se quiebra en el temple, una píldora tóxica que parece buena, una formación con un nodo débil que nadie ve: cada fracaso tiene causa en el estado y deja huella.
6. **Lo hecho tiene historia.** Todo producto es un lote o un ítem con `originEventId`, autor, insumos y taller (economy §1). La calidad real es verdad; la calidad que cada uno percibe es creencia (economy §6).
7. **Las mismas reglas para mortales y cultivadores.** El herrero de aldea y el refinador de artefactos usan el mismo modelo: el primero con fuego de carbón y hierro, el segundo con fuego espiritual y hierro estelar. Cambian los materiales, las fuentes de calor y los sentidos, no el motor.
8. **Determinista.** `rng.fork("craft", crafterId, sessionId, step)` para el ruido de control y de percepción; nada más es azar.

## 1. El modelo común
```ts
interface CraftSession {
  id: SessionId;
  craft: CraftKind;                       // alchemy | smithing | artifact_refining | formation | talisman | medicine | cooking | ...
  crafter: EntityId;                      // o varios: un maestro con ayudantes
  helpers: EntityId[];
  site: SiteId;                           // taller, fragua, sala de alquimia, cueva, el terreno de una formación
  container?: ContainerId;                // horno, crisol, molde, papel, el suelo: capacidad y propiedades
  heat?: HeatSource;                      // carbón, leña, fuego de tierra, fuego de bestia, fuego propio (§3)
  recipe?: RecipeRef;                     // la receta que sigue (si sigue alguna): una creencia con fuente
  plan: PlannedStep[];                    // lo que el artesano piensa hacer (puede cambiarlo en el camino)
  work: WorkState;                        // el estado real del trabajo (verdad)
  perceived: PerceivedWorkState;          // lo que el artesano cree ver del trabajo
  log: StepEvent[];                       // cada paso es un evento con causas
  originEventId: EventId;                 // por qué empezó (un encargo, una orden de la secta, una necesidad)
}

interface WorkState {
  materials: MaterialPortion[];           // qué hay adentro: cantidades, vectores elementales, propiedades físicas
  temperature: number;
  structure: StructureState;              // fase, cristalización, grano del metal, patrón inscrito, nodos de la formación
  essence: ElementVector;                 // la esencia del trabajo (suma de lo que aportaron insumos, fuego y artesano)
  tension: number;                        // elements §4: sube con mezclas en conflicto, baja con contención y generación
  impurities: ElementVector | number;     // lo que no se integró
  containerStress: number;                // cuánto le falta al recipiente para romperse
}

interface PlannedStep {
  op: StepOp;                             // add | grind | extract | heat | hold | cool | quench | hammer | fold | fuse
                                          // | condense | inscribe | charge | place_node | link | seal | bind | wait
  params: Record<string, number | string>;// cuánto, a qué temperatura, por cuánto tiempo, qué patrón
  believedEffect?: string;                // lo que el artesano cree que hace este paso (creencia, puede estar mal)
}
```

### Cómo se resuelve un paso
1. **Intención.** El artesano elige el próximo paso según su plan, su receta y lo que **percibe** del trabajo (no el estado real).
2. **Ejecución con ruido de control.** Lo que hace se aparta de lo que quiere según su `control` en ese oficio, su fatiga, su concentración (dolor, emociones, ruido; npc-psychology), la calidad de sus herramientas y la dificultad del paso. Querer "fuego medio durante una hora" produce un fuego que oscila alrededor de eso, más o menos según la mano.
3. **La ley.** El paso modifica `WorkState` con física mundana (temperatura, fases, mezcla, deformación) y con `interact` (elements §3) entre los materiales, el fuego y la esencia que pone el artesano. La tensión y la carga del recipiente se actualizan.
4. **Percepción.** El artesano percibe el nuevo estado con sus sentidos (color, olor, sonido, textura; con el sentido de la esencia, el vector y la tensión) con un error que depende de su `senses` en el oficio y de su atención (perception). Un maestro alquimista "ve" que la píldora está por agrietarse; un aprendiz ve humo.
5. **Reacción.** Con lo que percibe, sigue el plan, lo corrige (bajar el fuego, agregar un estabilizador, sacar del horno antes) o abandona. Corregir bien es la mitad del oficio.

### La habilidad
```ts
interface CraftSkill {
  craft: CraftKind;
  control: number;            // precisión de la mano: fuego, golpe, trazo, colocación
  senses: number;             // lectura del estado del trabajo mientras se hace
  repertoire: RecipeRef[];    // procesos que sabe ejecutar (saber cómo)
  judgment: number;           // reconocer problemas y saber corregirlos (memoria de fracasos propios y vistos)
  specialties: Partial<Record<ProductClass, number>>;  // familiaridad con tipos de producto (píldoras de curación, sables)
}
```
- **Sale de la práctica.** Cada sesión deposita experiencia en lo que el artesano **percibió** del proceso (no aprende de lo que no vio). Fracasar y entender por qué enseña más que acertar sin saber. Hay rendimiento decreciente con la repetición de lo mismo y saltos con lo nuevo. `CraftSkill` es una vista del modelo general de habilidad ([skills.md](skills.md) §10).
- **Los aspectos ayudan.** Un alquimista con comprensión del fuego (discovery §7) controla mejor el fuego y lo lee mejor; un forjador con comprensión del filo forja filos que cortan más allá de su metal (intención, discovery §9).
- **El cultivo cambia la mano.** Un cultivador puede poner esencia propia en el trabajo, controlar un fuego espiritual y sentir la esencia de los materiales. Los oficios espirituales **piden** umbrales mínimos (no se puede sostener fuego propio sin esencia suficiente) y su techo crece con el cultivo.
- **Aprendices.** El aprendiz aprende mirando (percepts del trabajo del maestro), haciendo pasos bajo supervisión (el maestro corrige antes del desastre) y con el tiempo con sesiones propias. Un buen maestro es el que deja fracasar barato (organizations §9).

## 2. Materiales
```ts
interface MaterialProps {
  // físicas
  hardness: number; toughness: number; meltingPoint: number; density: number;
  fiber?: number; grain?: GrainState;      // madera, tela, metal trabajado
  // espirituales
  elements: ElementVector;                 // firma elemental (elements §2)
  essence: number;                         // qi contenido (ledger de qi)
  purity: number;
  age?: number;                            // hierbas, maderas y bestias: la edad concentra esencia
  conductivity: number;                    // qué tan bien lleva esencia (clave en artefactos y talismanes)
  toxins?: Partial<Record<SubstanceId, number>>;
  activeParts?: ActivePart[];              // qué partes de una hierba o de una bestia tienen qué (raíz, flor, hiel, núcleo)
}
```
- **Cada lote es único.** Las propiedades de un lote concreto salen de su tipo (en `content/`) modificado por su origen: dónde creció o se extrajo, con qué qi, cuánto tiempo, cómo se cosechó y guardó (economy §1). Una ginseng de cien años de un valle de madera no es la misma que una de cien años de una ladera seca.
- **Preparar es parte del oficio.** Secar, macerar, destilar, quitar partes tóxicas, purificar metal, moler, extraer la esencia de una hierba: cada preparación es un paso con su ley. Una hierba mal preparada mete toxinas al horno.
- **Se degradan.** Las hierbas espirituales pierden esencia (vuelve al ambiente) según cómo se guarden; los núcleos de bestia se pudren si no se sellan; el metal se oxida.
- **Conocer un material es saber.** Que la hiel de cierta serpiente cura fiebres y la piel la provoca es una creencia `law` que se descubre (discovery). Las farmacopeas y los catálogos de materiales de cada cultura tienen errores con forma.

## 3. Fuentes de calor y energía
El fuego es el activo de casi todos los oficios. Cuál se use define qué se puede hacer.
| Fuente | Qué es | Qué permite |
|---|---|---|
| **Fuego mortal** (leña, carbón, fuelle) | Calor sin esencia; temperatura limitada por el combustible y el fuelle | Cocina, cerámica, bronce, hierro; nada de materiales espirituales de grado medio o alto |
| **Fuego de tierra** (地火) | Calor de un punto volcánico o una veta de fuego (planet-gen §5), con vector de fuego | Alquimia y forja espiritual sin gastar esencia propia; los talleres de las sectas se construyen encima |
| **Fuego de bestia** | Núcleos o glándulas de bestias de fuego, o la bestia viva (contratos con bestias) | Fuego con elemento y "carácter" propio (una bestia de fuego yin da un fuego frío) |
| **Fuego propio** (丹火) | Esencia del artesano transformada en fuego por una técnica | Control fino; cuesta esencia (sale del dantian y se repone cultivando); su vector es el del artesano |
| **Fuegos extraños** (异火) | Derivados raros (elements §5): fuego de meteorito, llama que nace donde un rayo cayó sobre una veta | Fundir lo que nada más funde. Son tesoros con origen y se pelean |
| **Piedras y formaciones** | Esencia de piedras canalizada | Calor estable para sesiones largas; quema dinero |

- **El fuego es un vector.** Un fuego de tierra cargado de metal, el fuego propio de un cultivador de agua (más débil, con agua mezclada), el fuego frío de una bestia yin: cada uno interactúa distinto con los materiales. Elegir el fuego es parte de la receta.
- **Conservación.** El fuego mortal consume combustible (bien con precio); el de tierra baja el qi de la celda; el propio, la esencia del artesano; el de piedras, piedras. El calor sobrante calienta el taller (body-health §7: los talleres de fundición son lugares duros).

## 4. Alquimia (丹道)
Hacer píldoras, polvos, elixires y venenos con esencia.
- **El horno** es el contenedor: capacidad de tensión, material (bronce, jade, hierro espiritual), conductividad (qué tan bien deja pasar el fuego y la mano del alquimista), elemento propio (un horno de agua estabiliza recetas de fuego y las vuelve más lentas). Los hornos se gastan y se rajan; un horno famoso es un ítem único con historia.
- **El proceso típico:**
  1. **Preparación** de cada ingrediente (§2).
  2. **Refinar** ingredientes en el fuego para separar esencia útil de impurezas (cada uno a su temperatura: la ley lo dice, la receta lo cree).
  3. **Fusionar** en un orden: cada ingrediente que entra es un `interact` con lo que ya hay. Agregar el fuego antes del agua no es lo mismo que al revés.
  4. **Sostener** el fuego mientras la mezcla se integra; la tensión sube y baja.
  5. **Condensar** (凝丹): la mezcla se cierra en una forma. Si la tensión es demasiado alta o el recipiente no aguanta, revienta; si se condensa antes de tiempo, la píldora queda impura; si se pasa, se quema.
- **El resultado** es un lote de píldoras con propiedades reales:
  ```ts
  interface PillProps {
    effects: Effect[];            // calculados: esencia por elemento, curación, sustancias activas, efectos raros
    essence: ElementVector;       // lo que entrega a quien la toma (cultivation §5)
    purity: number;               // grado real
    residualTension: number;      // = toxicidad (丹毒, body-health §9) e inestabilidad
    shelfLife: DecayCurve;        // las inestables pierden potencia o se rompen
    signs: VisibleSigns;          // color, aroma, brillo, vetas (丹纹): lo que los demás pueden percibir
  }
  ```
- **Las vetas y el aroma son señales, no grados.** Las culturas asocian "una veta = grado bajo, tres = grado alto". Hay correlación real (salen del mismo estado), pero no es perfecta, y un falsificador puede imitar las señales sin la sustancia (economy §6, estafa).
- **Fracasos con forma:** píldora quemada (inútil, a veces tóxica), impura (funciona poco y envenena más), con un efecto que nadie buscó (puede ser valioso: así se descubren recetas), estallido del horno (onda de choque, fuego, esencia liberada: heridas para quien esté cerca, daño al taller; la esencia vuelve al ambiente), y la peor: **una píldora que parece buena y no lo es**.
- **Venenos y antídotos.** Son alquimia o medicina con otro fin. Un antídoto existe solo si alguien conoce (o descubre) qué neutraliza qué; la ley define si es posible.
- **Medicina mortal.** Decocciones, ungüentos, polvos: el mismo modelo con esencia casi nula y fuego mortal (body-health §11). El médico de aldea es un alquimista sin esencia.
- **Píldoras que desafían al Cielo.** Si el mundo tiene un Cielo que se opone (heaven-karma) y una píldora supera un umbral de transgresión (alargar la vida más allá de lo permitido, forzar un umbral), su condensación puede atraer una respuesta (nubes, un rayo pequeño). No es decoración: es la misma regla que en las rupturas.

## 5. Forja y refinación de artefactos (炼器)
### Metalurgia mortal
- **Física real simplificada:** reducir mineral a metal (necesita temperatura y carbón: un horno de tiro natural da hierro esponjoso, uno con fuelle hidráulico da hierro colado), carburar, forjar (golpear cambia el grano y expulsa escoria), plegar, templar (enfriar rápido endurece y hace frágil), revenir (recalentar suave devuelve tenacidad).
- **El acero es saber.** Cuánto carbón, a qué color sacar del fuego, en qué templar (agua, aceite, salmuera, orina, nieve): procesos que cada cultura descubre o no ([technology.md](technology.md); discovery). El "secreto del acero de tal ciudad" es una receta y un mito.
- **El metal es escaso** (economy §11): cada espada es metal que no es una azada ni una moneda. Reforjar y fundir son eventos en el ledger.

### Refinación espiritual
- **Los metales espirituales** (hierro estelar, oro yin, cobre de fuego; economy §11) tienen tanta esencia de metal que invierten la relación con un fuego mortal (相侮, elements §3): el fuego se apaga contra ellos. Hace falta un fuego espiritual en proporción, y a veces un fuego extraño.
- **Fusionar materiales.** Un artefacto mezcla metales, huesos, escamas, jade, núcleos: cada uno es un vector y una propiedad física; la fusión es un `interact` con tensión, igual que la alquimia, pero el resultado tiene forma y estructura.
- **Inscribir.** Patrones (runas, circuitos) grabados en el artefacto que conducen y dan forma a la esencia: un sable que concentra filo, un escudo que reparte el impacto, un anillo que pliega espacio (si el mundo lo permite). Una inscripción es una formación en miniatura (§6) con los mismos defectos posibles.
- **El artefacto:**
  ```ts
  interface ArtifactProps {
    physical: MaterialProps;          // filo, dureza, peso, equilibrio
    essence: ElementVector;           // lo que lleva adentro
    capacity: number;                 // cuánta esencia del portador puede canalizar
    inscriptions: Inscription[];      // circuitos, cada uno con su efecto calculado por la ley y sus defectos
    bond?: { owner: EntityId; depth: number };   // vínculo con el dueño (abajo)
    wear: WearState;                  // mellas, grietas, inscripciones gastadas
    spirit?: SpiritId;                // si nació un espíritu de objeto (spirits.md)
    originEventId: EventId;
  }
  ```
- **Vínculo con el dueño (认主).** Refinar un artefacto con sangre, esencia o alma propia lo ata: se canaliza mejor, responde a la voluntad, avisa de peligros. Romper un vínculo ajeno cuesta (y duele al dueño, body-health). Un artefacto atado que cambia de manos es poco útil hasta que se re-refina.
- **Se gastan y se reparan.** Cada choque es un `interact` sobre el artefacto: se mella, las inscripciones se borran, la esencia se agota. Repararlo es una sesión de forja; algunas heridas (el núcleo de una inscripción partido) no se reparan.
- **Crecen con el uso.** Un arma que su dueño cultiva (cultivation §10, camino del arma) acumula esencia e intención; con siglos de uso puede nacer un espíritu de objeto (spirits.md) con la personalidad que le dejaron sus usos.

## 6. Formaciones (阵法)
Circuitos de esencia construidos **sobre el campo de qi real** de un lugar (planet-gen §5, elements §6).
```ts
interface Formation {
  id: FormationId;
  site: CellId[];                     // el terreno que ocupa
  nodes: FormationNode[];             // banderas, piedras, estacas, inscripciones en roca: cada uno con material y vector
  links: { a: NodeId; b: NodeId; conductance: number }[];
  pattern: PatternRef;                // el diseño que se siguió (saber, con su autor y sus defectos)
  sources: EnergySource[];            // la vena del lugar, piedras en los nodos, cultivadores que la alimentan
  functions: FormationFunction[];     // calculadas por la ley a partir del grafo (abajo)
  keys: KeyRef[];                     // fichas, técnicas o sangre que la atraviesan sin activarla
  state: { charge: number; tension: number; integrity: number };
  builders: EntityId[];
  originEventId: EventId;
}
```
- **La ley calcula qué hace.** Cada tick, la esencia fluye por el grafo: cada link es un `interact` entre los vectores de sus nodos. Un grafo en ciclo de generación concentra y se sostiene; una cadena de destrucción acumula tensión y la descarga donde el diseño la dirige. Las funciones (`concentrate`, `barrier`, `conceal`, `illusion`, `kill`, `seal`, `bind`, `alarm`, y las que el mundo permita, como trasladar) **salen del grafo**, no se eligen de una lista.
- **Concentrar es mover.** Una formación de reunir qi trae qi de las celdas vecinas (que bajan): no lo crea (causality §3, cultivation §5).
- **Barreras.** Una barrera es esencia contenida en una forma; un ataque contra ella es un `interact` contra su vector, y lo que la sostiene es su fuente. Una barrera de agua aguanta fuego y se rompe ante tierra; una barrera sin fuente se agota.
- **Ocultar y engañar.** Las formaciones de ocultamiento suben el ruido de percepción (perception: enmascarar emisiones); las de ilusión generan **percepts falsos** en quien entra (nunca cambian la verdad: cambian lo que se percibe). Resistirlas es percepción y voluntad contra la fuerza de la formación.
- **Romper una formación:**
  - **Fuerza:** superar su capacidad (integridad) con más esencia de la que aguanta; caro y ruidoso.
  - **Saber:** encontrar el nodo donde inyectar el elemento que vence al que lo sostiene, o el link que, cortado, abre el circuito. Requiere percibir el grafo (sentido de la esencia, conocimiento del patrón).
  - **Llave:** tener (o robar, o copiar) una ficha; el traidor de adentro es la forma más común.
  - **Hambre:** cortarle la fuente (sitiar una secta hasta que se gasten las piedras: guerra).
- **Mantenimiento.** Los nodos se gastan, las piedras se agotan, el campo del lugar cambia con los siglos (elements §6). Una formación sin mantenimiento decae y, en ruinas, puede quedar a medias: viva, débil, con funciones torcidas (deep-history). Las formaciones de protección de una secta son su infraestructura más cara (organizations §6).
- **Geomancia (风水).** La versión mortal: ubicar casas, tumbas y templos según el campo. Hay base real (el campo existe y afecta: una tumba sobre yin acumula yin) y mucha teoría cultural sin verificar (elements §9).

## 7. Talismanes (符箓)
- **Qué son.** Un vector de esencia contenido en un soporte (papel, seda, jade, hueso) con un patrón que dice cómo liberarlo. Son formaciones de un uso y portátiles.
- **Hacerlos:** soporte (calidad y conductividad), tinta (cinabrio, sangre de bestia, polvo de jade, esencia del que traza), trazo (control: un trazo tembloroso deja un circuito débil o roto), carga (esencia del artesano o de piedras). Cada parte entra en la ley.
- **Usarlos:** activar libera el vector con la forma del patrón: un `interact` con lo que toca (fuego contra un enemigo, una barrera, un sello sobre un fantasma). Algunos los puede activar un mortal (llevan la carga adentro), otros piden esencia del usuario.
- **Se descargan.** La esencia contenida se escapa con el tiempo según la calidad del soporte y del sello. Un talismán viejo es más débil o inútil, y eso no se ve a simple vista.
- **Son los consumibles del mundo.** Baratos comparados con artefactos y formaciones, producidos en cantidad por talleres de secta y vendidos en mercados (economy); falsificados también (papel con trazos sin carga).

## 8. Oficios mortales
El mismo modelo con materiales y fuego mortales, y con el detalle que pida la escena:
- **Medicina** (§4 sin esencia): preparar remedios, cirugía (body-health §11), entablillar.
- **Cocina y conservas:** salar, ahumar, fermentar, destilar; la comida tiene calidad y nutrición (body-health §5) y puede tener esencia si los ingredientes la tienen (la cocina espiritual existe donde hay ingredientes espirituales).
- **Tejido, curtido, alfarería, carpintería, construcción:** propiedades físicas de los materiales y pasos con control. Una casa mal hecha se cae en el primer terremoto (planet-gen: desastres).
- **Escritura y copia:** papel, tinta, copia de manuales con errores (information: copias). El copista es un oficio.
- **Arte con intención:** pintura, caligrafía, música, escultura con comprensión (discovery §9): un oficio cuyo producto lleva impronta.
- Todos producen con `ProductionProcess` (economy §3) en el modo agregado; en el modo individual, son sesiones con pasos cuando la escena lo pide (el jugador forja su primer cuchillo).

## 9. Recetas, patrones y saber
```ts
interface Recipe {
  id: RecipeId;
  craft: CraftKind;
  author: EntityId | null;               // null = saber anónimo de una tradición
  originEventId: EventId;                // la invención, el accidente, la iluminación (discovery §10)
  steps: PlannedStep[];                  // lo que dice que hay que hacer
  believedResult: string;                // lo que dice que sale
  believedRequirements: Requirement[];   // fuego, umbral, horno, ingredientes y edades
  ancestors: RecipeId[];                 // de qué receta deriva (variantes, copias)
  media: MediumRef[];                    // dónde está escrita (y con qué errores de copia)
}
```
- **Una receta es una creencia sobre un proceso.** Sus `flaws` son los pasos donde el autor (o el copista) se equivocó: una temperatura de más, un ingrediente que no hacía falta, un orden que funciona solo con cierto horno. Seguirla al pie de la letra reproduce sus errores.
- **Saber cómo no es saber que.** Tener la receta escrita no da la mano: sin `control` y `senses`, la receta perfecta sale mal. Un maestro sin receta, improvisando por lo que siente, puede superar a un aprendiz con el manual.
- **Invención y variantes** son la búsqueda de discovery §10 con este espacio de diseño: pasos, ingredientes, fuegos, patrones. Las variantes nacen de corregir una receta en el horno (la sesión salió distinta y alguien entendió por qué).
- **Ingeniería inversa.** Examinar un producto (probar la píldora, desarmar el artefacto, estudiar los nodos de una formación) da observaciones sobre su proceso: con suficiente percepción y saber se reconstruye la receta, a veces mejorada, a veces peor.
- **Secretos.** Las recetas valiosas son secretos de familia, de gremio o de secta (information §7, economy §3): dan monopolio y se roban, se compran, se filtran. Una receta filtrada baja el precio del producto.

## 10. El oficio en la sociedad
- **Talleres y salones.** Las sectas tienen salones de alquimia, forja y formaciones con sus puestos (organizations §3), sus fuegos de tierra y sus cuotas; los mortales, talleres de familia. Producir para la organización es una obligación con pago en puntos o piedras (organizations §6).
- **Encargos.** Pedirle a un artesano que haga algo con los materiales del cliente (o con los suyos) es un compromiso de tipo encargo ([contracts.md](contracts.md) §11): qué se entrega, qué pasa si falla, quién se queda con lo que sobra. Los artesanos famosos tienen lista de espera y eligen clientes.
- **Gremios** (economy §10): licencias, calidad mínima, recetas protegidas, precios. Un alquimista de fuera del gremio es un competidor y a veces un criminal.
- **Marcas y reputación.** El sello de un maestro vale porque sus productos fueron buenos (economy §6); se falsifica; su caída arrastra la de la marca.
- **Prestigio del oficio.** En muchas culturas un gran alquimista o un maestro de formaciones vale tanto como un cultivador fuerte: todos lo necesitan, nadie quiere enemistarse con él. Es una vía al poder fuera de la escalera del cultivo.
- **Peligros sociales.** El refinador de almas (estandartes, espíritus esclavos: spirits) es un criminal en casi todas las culturas y carga mucho karma; los venenos y los talismanes de maldición son herramientas de intriga (schemes).

## 11. El jugador y el narrador
- **Hacer es una escena.** El jugador escribe lo que hace ("subo el fuego despacio y agrego la raíz cuando el vapor se aclare"); el parser lo traduce a pasos (`PlannedStep`) y la sim los resuelve uno por uno. El jugador puede seguir una receta, desviarse o improvisar.
- **Siente, no lee.** El narrador recibe lo que el personaje **percibe** del trabajo (color, olor, sonido, el pulso del horno, la tensión que siente con el sentido de la esencia), nunca el `WorkState` real. Si el personaje no tiene sentidos para ver que la píldora se está agrietando, el narrador no lo dice.
- **El resultado se descubre.** Al terminar, el personaje sabe lo que ve del producto, con la precisión de su tasación. Lo que hace de verdad se descubre al usarlo (o al vendérselo a alguien que sabe mirar).
- **Aprender es jugar.** Con la experiencia, el jugador nota patrones y forma hipótesis (discovery): qué fuego le conviene a qué hierba, en qué orden agregar. Su mano mejora sola con la práctica; su saber, con lo que él entienda.
- **Sesiones largas.** Una alquimia de días o una formación de meses se juegan como acciones largas con momentos de decisión (cuando algo cambia, el narrador lo presenta y el jugador decide) y el mundo sigue mientras tanto.

## 12. Escala (LOD)
- **Tier 3-4 (el jugador, escenas cercanas):** sesiones paso a paso con `interact` completo, percepción y reacción.
- **Tier 2:** una sesión es un solo cálculo con la receta como secuencia corta y el ruido de control resumido: sale un producto con calidad y defectos coherentes con el artesano, la receta y los materiales.
- **Tier 0-1:** producción agregada (`ProductionProcess`, economy §3) con tasas de calidad, de fracaso y de accidentes por taller, calibradas contra el modo individual. Los productos notables (un artefacto con nombre, un estallido que mata a un maestro) se materializan como eventos.
- **Formaciones** se simulan como grafos en tick de mundo cuando alguien interactúa con ellas, y como un estado resumido (carga, integridad, funciones) el resto del tiempo.

## Implementación
- **Fase 1:** sesiones mínimas con el modelo común para un oficio mortal (cocina o herrería de aldea): pasos, ruido de control, física simple, producto con calidad y origen. Encaja con la economía mínima.
- **Fase 3:** medicina y remedios mortales, venenos y antídotos conocidos por la aldea; habilidad que sale de la práctica; aprendices.
- **Fase 4:** alquimia con hornos, fuegos (tierra, propio), tensión, toxicidad residual y señales; talismanes simples; mercado de píldoras.
- **Fase 5-6:** forja y refinación de artefactos con inscripciones y vínculo; formaciones como grafos sobre el campo; salones de secta, gremios, encargos, marcas.
- **Fase 7:** recetas que nacen, se pierden y se redescubren en la historia; ruinas con formaciones vivas; fuegos extraños como tesoros.

## Tests
- **Conservación:** en cada sesión, materia y esencia de entrada = producto + subproductos + `released` + lo que absorbió el recipiente. El metal reforjado conserva su masa menos la escoria registrada.
- **Determinismo:** misma sesión, mismos pasos y mismo seed dan el mismo producto.
- **Ninguna decisión del artesano lee `WorkState`:** solo `PerceivedWorkState`.
- **Ningún producto sin insumos ni `originEventId`.**
- **Escenario controlado:** con la misma receta, un maestro produce mejor calidad promedio y menos estallidos que un aprendiz; con una receta con un defecto, ambos lo heredan, pero el maestro lo corrige más seguido si lo percibe.
- **Escenario controlado:** un fuego mortal no funde un metal espiritual (inversión), un fuego espiritual en proporción sí.
- **Escenario controlado:** una formación de reunir qi baja el qi de las celdas vecinas en lo mismo que concentra (menos pérdidas).
- **Escenario controlado:** romper una barrera es más barato con el elemento que la vence y por su nodo débil que por fuerza.
- **Agregado:** las tasas de calidad y de accidentes por taller en tier 0 coinciden en promedio con las sesiones individuales.

## Decisiones tomadas en este borrador (revisables)
- Un solo modelo de sesión por pasos para todos los oficios, mortales y espirituales; cambian los materiales, los fuegos y los sentidos.
- El resultado lo calcula la ley (física mundana + `interact` + tensión); no hay tablas de éxito ni de grados.
- La habilidad es control, sentidos, juicio y repertorio, y sale de la práctica percibida.
- La toxicidad de una píldora es su tensión residual (elements §4); las señales visibles (vetas, aroma) correlacionan con el grado pero no lo son.
- Las funciones de una formación salen de su grafo sobre el campo real, no de una lista elegida.
- Las recetas son creencias con defectos; tener la receta no da la mano.

## Preguntas abiertas
- Calibración: tasas de estallido y de calidad por nivel de habilidad, para que un maestro sea claramente mejor sin que un aprendiz sea inútil.
- Calibración: velocidad de aprendizaje por práctica y techo por cultivo en cada oficio.
- Calibración: duración de cargas (talismanes, formaciones sin fuente, píldoras inestables) y desgaste de artefactos por combate.
- Calibración: cuánto de una sesión ve el jugador por defecto (cuántos momentos de decisión en una alquimia de días) para que sea jugable sin volverse tedioso.
