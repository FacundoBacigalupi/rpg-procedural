# Familia de los misterios: caminos, secuencias y pociones

> Estado: **borrador de diseño**. Una familia de mundos inspirada en *Lord of the Mysteries*: el poder viene en **caminos** con **secuencias** que se suben bebiendo **pociones** hechas con ingredientes que guardan **características** sobrenaturales. Las características se conservan, no se destruyen y se atraen entre sí. La poción se **digiere actuando el papel** de la secuencia, y si no se digiere el riesgo es **perder el control**: locura, mutación, monstruo. Hay dioses reales que ocupan la cima de los caminos con iglesias que reparten fórmulas, **nombres honoríficos** que llegan de verdad a quien nombran, misticismo (espiritualidad, adivinación, rituales, mundo espiritual, sueños), objetos sellados que cobran por su poder, sociedades secretas, cultos a **lo de afuera** y una época típica industrial de niebla, vapor y periódicos. Se toma la mecánica, no los nombres: los caminos, dioses, iglesias y organizaciones se generan por seed. Este doc también define cómo la familia del mundo inclina la **era de la humanidad** (el eje está en [technology.md](technology.md) §9b).

Depende de: [metaphysics.md](metaphysics.md) (la familia como atractor de ejes; `Essence`, `Practice`, `Law`, `Soul`), [cosmology.md](cosmology.md) (planos: el mundo espiritual, el astral, lo de afuera), [causality.md](causality.md) (conservación, presiones, nada sin causa), [crafts.md](crafts.md) (preparar la poción como sesión por pasos), [skills.md](skills.md) (actuar el papel es práctica), [npc-psychology.md](npc-psychology.md) (salud mental, demonios internos, sueños), [body-health.md](body-health.md) (mutación, heridas, sustancias), [divination.md](divination.md) (adivinación por la espiritualidad), [religion.md](religion.md) (iglesias de dioses reales), [organizations.md](organizations.md) (iglesias, sociedades secretas, agencias), [information.md](information.md) (secretos, rumores, saber peligroso), [economy.md](economy.md) (mercado negro de ingredientes y fórmulas), [law.md](law.md) (cazadores oficiales, crimen sobrenatural), [technology.md](technology.md) (la era industrial típica), [deep-history.md](deep-history.md) (épocas de dioses y cataclismos), [heaven-karma.md](heaven-karma.md) (la ley superior de esta familia no es el Cielo), [spirits.md](spirits.md) (almas, espíritus del mundo espiritual), [secret-realms.md](secret-realms.md) (espacios sellados), [game-modes.md](game-modes.md) (dedos de oro que encajan en esta familia). Lo usan: [metaphysics.md](metaphysics.md) (tabla de familias), [cosmology.md](cosmology.md) §3, [technology.md](technology.md) §9b, y los sistemas que leen la familia del mundo.

## Principios
1. **Es una familia más, con la misma física.** Todo lo que sigue se expresa con los conceptos genéricos de [metaphysics.md](metaphysics.md): la **esencia** se presenta como espiritualidad y como características; la **práctica** es el camino; la **ley** son la conservación, la convergencia y la unicidad, más los dioses que ocupan la cima; el **alma** tiene un cuerpo espiritual. No hay un motor aparte.
2. **Las características se conservan.** El poder sobrenatural de un camino está hecho de una cantidad finita de característica, que pasa de criaturas a ingredientes, de ingredientes a pociones, de pociones a personas y de los muertos a lo que dejan. Nunca se crea ni se destruye; solo se mueve, se concentra y se separa. El ledger de cada camino cierra (causality).
3. **Lo que el personaje sabe es creencia.** Las fórmulas, los nombres de las secuencias, el método de actuación, qué camino es vecino de cuál y qué dios existe de verdad son conocimiento con errores, secretos y falsificaciones. La verdad está en la ley del mundo; el inspector y la crónica la muestran.
4. **El poder cobra.** Cada secuencia tiene un precio mental y corporal. Perder el control no es mala suerte de tabla: es una presión que se acumula con causas (poción sin digerir, ingredientes malos, traumas, susurros) y se descarga cuando pasa un umbral.
5. **Nombrar es tocar.** En esta familia la palabra precisa llega a quien describe. Rezar con el nombre honorífico correcto abre un canal real, y por eso saber ciertos nombres es peligroso. Es una regla de la ley del mundo con su física (§8), no magia narrativa.
6. **Nada se copia de la obra.** Los caminos, los dioses, las iglesias, las épocas y los objetos sellados se generan por seed con su origen en la historia profunda. La obra es la inspiración de la forma, no del contenido.
7. **Libertad total con consecuencias.** El jugador puede buscar cualquier camino, robar fórmulas, inventar rituales, rezarle a lo que quiera, cazar a otros por sus características o fundar una sociedad. La sim resuelve qué pasa, y lo que pasa suele cobrar.
8. **Determinista.** `rng.fork("potion", personId, potionLotId, eventId)` para beber; `rng.fork("control", personId, tick)` para la presión de pérdida de control; `rng.fork("convergence", pathwayId, period)` para la atracción en agregado.

## 1. El modelo

```ts
interface Pathway {                          // un camino; contenido del mundo generado por seed
  id: PathwayId;
  theme: ThemeDef;                           // de qué trata: lo oculto, la muerte, la tormenta, el engaño, la luz... generado desde la mitología del mundo
  sequences: SequenceDef[];                  // de la 9 (la más baja) a la 0 (la cima); el número es convención de este diseño, cada cultura lo nombra a su modo
  group: ConvergenceGroupId;                 // los caminos vecinos (§4): pueden intercambiarse en ciertas secuencias
  totalCharacteristic: number;               // cuánta característica de este camino hay en el mundo; fija desde el origen (§3)
  originEventId: EventId;                    // de dónde salió el camino (§12): el cuerpo roto de un ser primordial, un pacto, una ley que se partió
  names: Map<CultureId, LexemeId>;           // cómo lo llama cada tradición (language)
}

interface SequenceDef {
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  role: RoleDef;                             // el papel que hay que actuar para digerir (§6)
  powers: PowerDef[];                        // lo que da: modos de verbos del catálogo de acciones, sentidos, cuerpo (§5)
  formula: PotionFormula;                    // la receta verdadera (§2)
  characteristicMass: number;                // cuánta característica condensa una dosis de esta secuencia
  mentalLoad: number;                        // presión base que agrega mientras no se digiere
  lossForms: LossFormDef[];                  // cómo se ve perder el control en esta secuencia (§7): obsesión, mutación, criatura
  bodyChanges: BodyChangeDef[];              // lo que cambia el cuerpo al subir: sentidos, longevidad, rasgos
  tier: "low" | "mid" | "saint" | "angel" | "god"; // bandas de poder, para el balance y el narrador; los nombres en el mundo son otros
}

interface Extraordinary {                    // una persona con poder de camino
  person: PersonId;
  pathway: PathwayId;
  sequence: number;                          // la más alta que bebió y sobrevivió
  held: CharacteristicId[];                  // las características que lleva en el cuerpo y el espíritu
  digestion: number;                         // 0-1 de la poción actual (§6)
  control: ControlState;                     // la presión de pérdida de control y sus causas (§7)
  spirituality: { current: number; max: number };  // la reserva que gastan los poderes y el misticismo (§8)
  mutations: BodyChangeId[];                 // marcas físicas de pociones mal digeridas o de corrupción
  corruption: number;                        // contaminación de lo de afuera (§11)
  beliefsAboutSelf: BeliefId[];              // qué cree que es, qué cree que sigue, qué cree del método (skills: autoimagen)
}

interface Characteristic {                   // una unidad conservada de poder de un camino
  id: CharacteristicId;
  pathway: PathwayId;
  level: number;                             // de qué secuencia es
  amount: number;
  holder: EntityRef;                         // un vivo, un cadáver, una criatura, un ingrediente, un objeto sellado (§9), un lugar
  history: EventId[];                        // por dónde pasó: el ledger permite seguirla desde el origen
}
```

- **Extraordinario** es la palabra de este diseño. Cada mundo tiene la suya, y cada cultura puede tener varias (los de la iglesia, los herejes, los "tocados").
- **Mortal vs extraordinario:** en las secuencias bajas la diferencia es menor que en xianxia. Una bala mata a un extraordinario de secuencia 9 y un grupo armado con un buen plan puede con uno de secuencia 7. Desde las secuencias medias el abismo crece y en las altas aparecen semidioses (§5).
- **Una persona, un camino.** Beber de un camino que no es el suyo ni un vecino en el punto de intercambio (§4) es una mezcla de características incompatibles: pérdida de control casi segura. Es física y no una regla de menú: el jugador puede intentarlo.

## 2. Fórmulas y pociones

```ts
interface PotionFormula {
  main: IngredientReq[];                     // ingredientes principales: llevan la característica de la secuencia (partes de criaturas, plantas, minerales, la característica de un muerto)
  auxiliary: IngredientReq[];                // ingredientes que estabilizan y dan forma: comunes o raros, sin característica
  ritual?: RitualReq;                        // en secuencias medias y altas: una condición que hay que cumplir al beber (un lugar, un momento, un acto)
  steps: CraftStepTemplate[];                // la preparación como sesión por pasos (crafts §1)
}

interface FormulaKnowledge {                 // lo que alguien cree que es la fórmula
  holder: PersonId | OrgId;
  pathway: PathwayId; level: number;
  believed: PotionFormula;                   // puede estar incompleta, mal copiada o falsificada a propósito
  fidelity: number;                          // cuánto coincide con la verdadera; la sim lo sabe, el portador no
  source: EventId;                           // la iglesia que la dio, el libro robado, la subasta, el muerto que la llevaba
}
```

- **Las fórmulas son el recurso más caro del mundo.** Las iglesias y organizaciones guardan las de sus caminos y las reparten según mérito y lealtad. Se compran, se roban, se heredan en linajes y se venden falsas. Una fórmula sin su método de actuación (§6) es una trampa.
- **Ingredientes con origen.** Un ingrediente principal viene de una criatura con característica (que alguien cazó), de una planta o mineral donde la característica se concentró, o del **cadáver de un extraordinario**. Es un lote con origen (economy) y su característica se cuenta en el ledger.
- **Preparar es un oficio.** La sesión de crafts resuelve calidad y defectos; un paso mal hecho da una poción con más carga mental o con efectos laterales. Una poción vieja o mal guardada pierde estabilidad.
- **Beber** es un evento con riesgo que depende de la fidelidad de la fórmula, la calidad de la poción, la digestión de la secuencia anterior (§6), el estado mental del que bebe y su cuerpo. El resultado sale de `rng.fork("potion", ...)` sobre esas causas: subir limpio, subir con carga extra, mutar o perder el control en el acto.
- **Saltarse secuencias** es posible y casi siempre mortal: la característica de una secuencia alta en un cuerpo que no aguantó las anteriores.
- **La característica de un muerto** sirve como ingrediente principal de la misma secuencia. Eso hace que matar a un extraordinario sea, entre otras cosas, cosechar. Es la economía oscura de esta familia (§13).

## 3. Conservación de las características

- **Ni se crean ni se destruyen.** Cada camino tiene una cantidad total fija desde su origen (§12). Toda poción bebida, toda criatura que nace con característica y todo objeto sellado mueve una parte de ese total, y el ledger lo registra con el evento.
- **Al morir, salen.** Cuando un extraordinario muere, sus características dejan el cuerpo en un tiempo que depende de la secuencia: se condensan en el cadáver (un cristal, un órgano, una mancha) o se van a un objeto cercano, a un animal, a un lugar. Si nadie las recoge, pueden **crear algo**: una criatura, un objeto sellado espontáneo, un lugar maldito.
- **Las criaturas sobrenaturales** del mundo tienen su característica por la misma regla: nacieron donde una se depositó, o descienden de algo que la tenía. Cazarlas es la fuente honesta de ingredientes, y su población es un recurso finito que se agota (living-world).
- **Sin pérdidas:** no hay "característica perdida". Lo que nadie encuentra sigue en algún lugar del ledger y puede salir a la luz siglos después en una ruina, un pantano o un objeto subastado (deep-history).

## 4. Convergencia, vecinos y unicidad

- **Las características se atraen.** Las de un mismo camino tienden a juntarse: un extraordinario es atraído (por casualidades, por intuición, por oportunidades) hacia otros de su camino y hacia sus características sueltas, y cuanto más alta la secuencia, más fuerte la atracción. En la sim es un **sesgo en la utilidad y en los encuentros** (travel: cruces de entidades existentes) proporcional a la masa de característica y a la distancia, nunca una teletransportación. Produce lo que en la obra parece destino: los del mismo camino se cruzan.
- **Vecinos.** Los caminos forman grupos de convergencia. En ciertas secuencias (generadas por seed, típicamente las altas), un camino puede pasar a uno vecino: se bebe la poción del vecino y la característica se acepta. Fuera de esos puntos, mezclar es veneno.
- **Unicidad en la cima.** La secuencia 0 de cada camino tiene una sola plaza. Ocuparla exige reunir la **unicidad** del camino (una concentración de característica que no se divide) y, a menudo, que nadie más la tenga. Quien está arriba quiere que nadie suba demasiado; quien quiere subir necesita que el de arriba caiga. Es una presión con la forma exacta de una guerra de dioses (§10).
- **La presión de reunión.** Las características de un grupo tienden a reunirse en un solo portador a lo largo de las épocas. Es la **presión de largo plazo** de esta familia (causality): sin nadie que la frene, termina en un ser que se acerca a lo que era antes del origen (§12), y eso suele ser un cataclismo. Los dioses, las iglesias y los sabios lo saben a medias y lo temen.

## 5. Poderes

- **Los poderes son modos de verbos** del catálogo de acciones ([actions.md](actions.md)): percibir con la espiritualidad, ocultarse, engañar los sentidos, controlar el fuego, hablar con los muertos, adivinar, maldecir. Cada secuencia agrega o mejora modos. La sim los resuelve con las mismas operaciones de siempre (`interact` para los efectos elementales, percepción para los sentidos, contienda para lo opuesto).
- **Bandas:** las secuencias 9-7 dan sentidos y habilidades que un mortal muy entrenado casi iguala; las 6-5 son claramente sobrehumanas; las 4-3 (las "santas" de este diseño) cambian la escala de un combate y viven siglos; las 2-1 son semidioses que mueven una ciudad; la 0 es un dios.
- **Coste en espiritualidad.** Los poderes gastan la reserva espiritual (§8). Agotada, el extraordinario queda débil y más expuesto a perder el control.
- **Armas mortales importan.** En la era industrial (§14) un rifle, un explosivo o una máquina siguen siendo amenazas reales para las secuencias bajas y medias. Los extraordinarios las usan también.
- **Cuerpo:** subir cambia el cuerpo según el camino: sentidos, resistencia, longevidad creciente desde las secuencias medias, rasgos raros (ojos, temperatura, sombra). Lo lleva body-health como cambios con causa.

## 6. Digerir: actuar el papel

```ts
interface RoleDef {
  principles: RolePrinciple[];               // lo que hace alguien que "es" esa secuencia: un vidente que guía, un ladrón que toma, un juez que dicta
  antiPrinciples: RolePrinciple[];           // lo que va contra el papel y frena la digestión
}

interface RolePrinciple {
  actionTags: ActionTag[];                   // qué acciones del catálogo cuentan (actions: verbos con modos y etiquetas)
  context?: ContextCondition;                // en qué situación cuenta: ante otros, en secreto, contra alguien de cierto tipo
  weight: number;
}
```

- **La poción no se absorbe sola.** La característica bebida queda como una carga que presiona la mente. Se **digiere** viviendo el papel de la secuencia: cada acción que encaja con sus principios en el contexto correcto avanza `digestion`; actuar contra el papel la frena y suma presión.
- **Es práctica, no un botón.** El jugador no ve una barra: actúa como quiera, y la sim mide cuánto de lo que hizo coincide con el papel. Si nunca descubrió el método, digiere solo por casualidad, despacio.
- **El método es saber.** La mayoría de los extraordinarios no lo conocen: beben, sobreviven como pueden y pierden el control más tarde. Las iglesias y las organizaciones viejas lo guardan como su mayor secreto; un extraordinario puede descubrirlo solo, como hipótesis con evidencia (discovery §2): "cuando hago tal cosa me siento más estable".
- **Digerido del todo,** la característica se asienta: la presión baja, los poderes se sienten propios y la siguiente poción es mucho menos riesgosa.
- **Actuar no es ser.** Un papel bien actuado durante años cambia a la persona: la autoimagen (skills), los hábitos y los valores derivan hacia el papel (npc-psychology). Quien actúa al juez termina juzgando a sus amigos. Es parte del costo.

## 7. Perder el control

```ts
interface ControlState {
  pressure: number;                          // la presión acumulada; pasa a pérdida de control al cruzar el umbral
  threshold: number;                         // depende de la voluntad, la salud mental y la digestión
  causes: Array<{ kind: "undigested" | "bad-potion" | "mixed-pathways" | "trauma" | "overuse" | "whispers" | "corruption" | "near-higher"; amount: number; event: EventId }>;
}
```

- **Una presión con causas,** como cualquier otra (causality): poción sin digerir, ingredientes malos, gastar de más la espiritualidad, traumas, estar cerca de un ser de secuencia mucho más alta, oír susurros de lo de afuera, características de caminos distintos. La salud mental (npc-psychology) la sube o la baja.
- **Señales antes:** obsesiones del papel, voces, alucinaciones, cambios del cuerpo, impulsos que no son propios. El personaje las percibe como síntomas, no como un número; puede leerlas bien o negarlas.
- **La descarga:** al cruzar el umbral, el extraordinario se transforma según `lossForms` de su secuencia: una locura que lo convierte en el papel sin la persona, una mutación en criatura, o un estallido que mata a todos cerca. Lo que queda es una criatura con su característica (§3), un problema para los vecinos y un ingrediente para los cazadores.
- **Frenarla:** digerir, descansar, rituales de calma, objetos que estabilizan, compañía, ayuda de un sacerdote del camino. También medicina y psicología mundanas. Nada de eso es gratis ni seguro.
- **Muerte del jugador:** perder el control termina la vida como persona. Según la ley del mundo, el alma puede quedar atrapada en la criatura, disiparse o cruzar (spirits); la partida sigue las mismas reglas de morir (player-loop).

## 8. Misticismo

- **Espiritualidad.** Es la esencia de esta familia en la persona: todos tienen un poco, los extraordinarios mucho más. Sirve para percibir lo invisible (ver auras, sentir el peligro), para adivinar y para hacer rituales. Se gasta y se recupera con descanso y sueño.
- **Adivinación** ([divination.md](divination.md)): por sueños, péndulos, espejos, cartas o la escritura automática. Lee a través del mundo espiritual las presiones y los hechos reales, con la interpretación sesgada de siempre. Adivinar sobre algo protegido por un ser más alto devuelve nada, mentiras o su atención.
- **Rituales.** Un ritual es una sesión de crafts con materiales, un lugar, un orden y una **dirección**: a quién se pide. Puede pedir fuerza a la propia espiritualidad (poco efecto, poco riesgo) o a un ser.
- **Nombres honoríficos.** Rezarle a un ser con una descripción precisa de lo que es (tres frases que solo le corresponden a él) abre un canal real hacia ese ser, si existe. Es física del mundo: la descripción funciona como dirección. Consecuencias:
  - el ser **oye** y puede responder, ignorar o castigar; los dioses reciben miles de rezos y atienden a casi ninguno, con su atención finita;
  - rezarle a algo que uno no entiende puede abrir la puerta a lo de afuera (§11);
  - **saber un nombre honorífico es peligroso:** pensarlo, escribirlo o pronunciarlo puede llamar la atención del ser, y los seres altos pueden sentir cuando se habla de ellos. Ciertas palabras, por eso, son tabú (language §7) y ciertos libros matan;
  - un nombre mal formado no llega a nadie o llega a quien no debería.
- **El mundo espiritual** es una capa superpuesta al mundo físico ([cosmology.md](cosmology.md) §3), con criaturas espirituales, corrientes y profundidades. Los rituales, la adivinación y algunos poderes pasan por ahí. Se puede **proyectar** el espíritu (viaje astral) con riesgo de perderse o de encontrarse con algo.
- **Sueños:** el sueño (npc-psychology) toca el mundo espiritual. Los sueños pueden traer mensajes reales, ataques, o ser solo sueños. Algunos caminos actúan en sueños ajenos.
- **Espacios por encima:** un mundo puede tener lugares sellados en el mundo espiritual: un salón antiguo sobre una niebla, una biblioteca fuera del tiempo, que alguien puede encontrar y tomar. Tienen creador y causa (secret-realms) y son raros. En modo novela pueden ser el origen de un dedo de oro (game-modes §4).

## 9. Objetos sellados

```ts
interface SealedArtifact {
  id: EntityId;
  characteristics: CharacteristicId[];       // de dónde viene su poder: un muerto, una criatura, una pérdida de control
  powers: PowerDef[];                        // lo que hace para quien lo usa
  toll: ArtifactTollDef[];                   // lo que cobra: la locura del papel que lo formó, frío, mala suerte, hambre, voces
  danger: number;                            // la escala con que lo clasifica la organización que lo guarda (creencia: puede estar mal)
  containment?: ContainmentDef;              // cómo se guarda para que no dañe: caja de plomo, reglas, un custodio
  originEventId: EventId;
}
```

- **Nacen de características** que se depositaron en un objeto: el arma con la que murió un extraordinario, el espejo que miró una pérdida de control, una pieza hecha a propósito por un artesano del camino (crafts).
- **Siempre cobran.** El costo es parte de la característica, no un castigo: un objeto que viene de un camino del engaño obliga a mentir; uno de la muerte enfría al portador. Quien lo usa mucho absorbe parte del papel.
- **Iglesias y agencias los numeran y los guardan** con reglas de contención. Se filtran: robos, custodios que se corrompen, objetos que manipulan a sus guardianes. En el mercado negro valen fortunas.

## 10. Dioses reales y sus iglesias

- **Un dios es quien ocupa la cima** de un camino (secuencia 0) o, por encima, de un grupo entero de caminos. Es un agente real con intereses, atención finita y límites ([metaphysics.md](metaphysics.md): panteón).
- **No vive de la fe** como en la familia mitológica, o vive poco de ella: vive de su característica. La fe le da ojos, manos y control sobre quién sube por su camino.
- **Sus iglesias** son organizaciones (organizations) con clero, tierras, tribunales y escuadras de extraordinarios del camino del dios y de sus vecinos. Reparten fórmulas y método a quien obedece, cazan a los herejes de su camino (son competencia por la unicidad) y a las criaturas y cultos que amenazan el orden.
- **Doctrina vs verdad** ([religion.md](religion.md) §3): lo que la iglesia enseña del dios, de su historia y de los demás dioses es en parte verdad, en parte conveniencia y en parte error. Un dios puede haber usurpado su lugar, puede estar loco, dormido o muerto con una iglesia que no lo sabe.
- **Límites a los dioses:** ninguno baja a placer. Su intervención directa cuesta (atención, característica, el equilibrio con otros dioses, pactos viejos) y deja rastros. Prefieren ángeles (secuencias 1-2), oráculos y sueños.
- **Dioses y unicidad:** la cima tiene una plaza, y alguien siempre la quiere. Hay guerras ocultas entre dioses por caminos vecinos, conspiraciones para hacer subir a un candidato, y planes de siglos (schemes) que la sim corre en agregado.
- **Falsos dioses:** cultos que adoran a un extraordinario alto, a un objeto sellado, a un ser que no es lo que dice, o a nada. Pueden funcionar en lo social sin llegar a ningún lado en lo espiritual, o llegar a algo peor.

## 11. Lo de afuera

- **Algo vive más allá del cosmos** ([cosmology.md](cosmology.md) §10) y su atención contamina. No es un dios de un camino: no tiene secuencia, no tiene unicidad, no se puede ocupar su lugar.
- **Corrupción:** mirar, rezarle, leer sus textos o tocar sus restos sube `corruption`, que suma presión de pérdida de control y cambia la mente hacia fines que no son humanos. Una persona muy corrompida es un canal.
- **Cultos:** hay quienes lo buscan a propósito (desesperados, ambiciosos, locos, sabios que creen poder usarlo). Son el enemigo común de iglesias que en todo lo demás se odian.
- **Es una presión del mundo:** la barrera del cosmos (cosmology §5) se debilita con ciertos actos y en ciertas épocas. Si cede, entra más: plagas de locura, criaturas, regiones perdidas.

## 12. Historia: el origen de los caminos y las épocas

- **Los caminos tienen un origen** en la historia profunda ([deep-history.md](deep-history.md)): un ser primordial que se rompió, un creador que se repartió, un pacto que dividió una ley. Ese evento es el `originEventId` de cada camino y de toda su característica. Qué pasó de verdad lo sabe la sim; lo que se cuenta son mitos con sesgo.
- **Épocas con nombre.** La historia de estos mundos se cuenta por épocas separadas por cataclismos: la del ser primordial, la de los primeros dioses, la de los gigantes o los dragones, la de la guerra de los dioses, la de los humanos. Cada época deja ruinas, características enterradas, objetos sellados, textos y dioses caídos.
- **Las épocas salen de la sim:** son descargas de la presión de reunión (§4) y de las guerras por la unicidad, corridas en agregado. No se eligen de una lista; el seed elige el origen y las condiciones, y la historia hace lo demás.
- **El regreso.** Si la presión de reunión crece, aparecen profecías (divination), cultos que la esperan y dioses que la frenan o la quieren. Puede ser el fondo de toda una partida sin que el personaje lo sepa.

## 13. Sociedad y la era típica

- **La era típica es industrial** (technology §9b): ciudades enormes con niebla y hollín, vapor y ferrocarril, fábricas y pobreza masiva, periódicos y telégrafo, policía moderna, imperios coloniales, bolsas de comercio, clubes. Es una tendencia, no una regla: hay mundos de esta familia en eras anteriores (§14).
- **Lo sobrenatural es medio secreto.** Por defecto, la mayoría de los mortales no sabe casi nada: las iglesias y los estados lo ocultan porque les conviene (control de las fórmulas, orden público, unicidad). El secreto es una decisión de organizaciones con costo, no una ley: se filtra en rumores, periódicos sensacionalistas, cuentos y testigos que nadie cree. Un mundo puede salir con el secreto roto si la historia lo rompió.
- **Organizaciones** ([organizations.md](organizations.md)):
  - **iglesias** de los dioses reales, con sus escuadras de extraordinarios;
  - **agencias del estado:** policías especiales, militares, inteligencia;
  - **familias nobles y linajes** que guardan un camino como herencia;
  - **sociedades secretas** de todo tipo: estudiosos, conspiradores, comerciantes, sectarios, defensores de un dios caído;
  - **cultos a lo de afuera**;
  - **reuniones y mercados:** encuentros anónimos con máscaras donde se cambian fórmulas, ingredientes, objetos sellados y favores (economy: mercados con desconfianza alta).
- **Oficios del misterio:** detectives privados, médicos que atienden heridas raras, anticuarios, prestamistas de objetos, cazadores de recompensas, periodistas que investigan, adivinos de feria (algunos con poder real).
- **Ley:** el crimen sobrenatural tiene jurisdicción doble: la policía mortal ve un asesinato y la escuadra de la iglesia ve una pérdida de control. Los tribunales de las iglesias juzgan a su modo (law).
- **Economía de las características:** ingredientes, fórmulas y objetos son bienes con precios de creencia, falsificaciones y estafas. Matar extraordinarios por sus características es un mercado (law: crimen organizado).

## 14. Cuando la era no es la típica

- **Antigua o medieval:** los caminos existen igual, con iglesias que son el poder, templos en vez de agencias, alquimistas en vez de laboratorios, sin periódicos que filtren. Es más cercano a la fantasía oscura, con la misma física.
- **Moderna temprana:** imprentas que multiplican fórmulas falsas y herejías, navegación que encuentra islas con características, inquisiciones.
- **Industrial tardía:** electricidad, fotografía (que capta cosas que no deberían verse) y prensa masiva.
- La sociedad (§13) se adapta a lo que la era permite; las reglas de los caminos son las mismas.

## 15. Coherencia con los ejes de metaphysics

| Eje | Valor en esta familia |
|---|---|
| Fuente | Espiritualidad (difusa, en todos) + características (conservadas, condensadas) |
| Acceso | Pociones (artificio + linaje para algunos), digeridas con práctica del papel; rituales |
| Progresión | Secuencias discretas 9→0 por camino, con vecinos y unicidad |
| Costo | Pérdida de control, mutación, locura, corrupción, atención de seres altos |
| Ley superior | Panteón de quienes ocupan la cima + algo afuera |
| Almas | Por seed: ciclo, más allá gobernado por un camino de la muerte, o disolución |
| Longevidad | Crece desde las secuencias medias |
| Techo | Muy alto (dioses), pero con unicidad: arriba no cabe más de uno |
| Era típica | Industrial |

- **Validador:** cada camino con 10 secuencias, con fórmula y papel; grupos de convergencia sin caminos aislados (o con aislados explicados por la historia); el ledger de características cierra; cada dios ocupa una plaza que existe; lo de afuera tiene barrera.
- **Variaciones dentro de la familia:** cantidad de caminos (entre 12 y 30), largo de las escaleras (siempre 10 en este diseño, con bandas que varían), cuántas cimas ocupadas, cuántos dioses vivos, si lo de afuera ya entró alguna vez, cuántas épocas pasaron, el estado del secreto.

## 16. El jugador y el narrador

- **Empezar mortal.** Lo típico es nacer mortal en una ciudad de la era y encontrarse con lo sobrenatural: un asesinato raro, un pariente que no era quien decía, un objeto en una casa de empeño. Desde ahí, buscar una fórmula es la aventura: unirse a una iglesia, comprar en una reunión, robar o heredar.
- **Sin barra de digestión.** El personaje siente la carga como síntomas y la estabilidad como alivio. Si descubre el método, lo cree; si lo cree mal, digiere peor.
- **Paneles de creencias** (player-loop): lo que cree de su camino, de las secuencias que siguen, de las fórmulas que conoce, de los dioses y de los nombres que sabe. Nunca la verdad.
- **Comandos fuera del personaje:** ninguno muestra la fórmula verdadera ni el umbral de control. El inspector sí (tooling).
- **Narrador:** vocabulario del mundo (los nombres de los caminos y las secuencias en cada cultura, los nombres de los dioses) y tono de la familia: misterio, niebla, horror contenido, ironía. No nombra un ser con su nombre honorífico salvo que el personaje lo sepa y lo haya dicho. No usa términos de xianxia.
- **Modo novela:** encajan los dedos de oro de game-modes: un espacio sellado propio por encima del mundo espiritual, una fórmula verdadera completa, un método de actuación conocido de antemano, una característica alta escondida en el cuerpo. Todos con origen y efectos acotados que aplica la sim.

## 17. Escala (LOD)

| Resolución | Qué se simula |
|---|---|
| Escena | Beber una poción, perder el control, un ritual, un rezo con nombre honorífico, un combate entre extraordinarios, un objeto sellado activo |
| Local | Criaturas con característica y su caza, reuniones anónimas, una escuadra de la iglesia, digestión de los extraordinarios cercanos |
| Regional | Iglesias y sociedades, mercado de ingredientes y fórmulas, pérdidas de control como estadística con causas, convergencia entre extraordinarios |
| Mundo | Ledger de características por camino, plazas de la cima, dioses, presión de reunión, barrera contra lo de afuera |
| Historia | Origen de los caminos, épocas y cataclismos, guerras de dioses, características enterradas y objetos que quedan |

- En agregado, los extraordinarios de una región son conteos por camino y secuencia con su característica total; al materializar uno (simulation), sus características salen de ese total con hechos fijados.

## 18. Implementación por fase

- **Fases 1-6:** nada propio. Las interfaces genéricas de metaphysics no deben suponer xianxia: progresión por niveles con nombre, costo como presión, esencia conservada en lotes.
- **Fase 7:** generador de la familia: caminos desde un origen en la historia profunda, secuencias con fórmula, papel, poderes y formas de pérdida; ledger de características; dioses como agentes con plaza; iglesias; era típica industrial con el eje de era. Si se aprueba como segunda familia, entra aquí (Decisiones).
- **Fase 8:** misticismo completo (nombres honoríficos, mundo espiritual, sueños, proyección), objetos sellados, sociedades y reuniones, lo de afuera, épocas con cataclismos, presión de reunión.
- **Fase 9:** variaciones dentro de la familia, eras no típicas, narración con tono de la familia, dedos de oro de esta familia en modo novela.

## Tests

- **Conservación:** en una corrida de mil años, la característica total de cada camino es constante; toda característica tiene `history` que llega al origen.
- **Al morir:** un extraordinario que muere deja su característica en el cadáver o cerca; si nadie la recoge, termina en algo del ledger y nunca desaparece.
- **Digestión:** dos extraordinarios iguales, uno que actúa el papel y otro que lo contradice; el primero digiere y el segundo acumula presión.
- **Pérdida de control con causa:** toda pérdida de control registra causas que suman más que el umbral; sin causas, no hay pérdida.
- **Fórmula falsa:** una fórmula con `fidelity` baja produce resultados peores al beber, sin que el portador lo sepa antes.
- **Mezcla:** beber de un camino no vecino fuera del punto de intercambio casi siempre lleva a la pérdida de control.
- **Unicidad:** nunca hay dos portadores de la secuencia 0 de un mismo camino.
- **Nombres honoríficos:** rezar con el nombre de un ser que no existe no llega a nadie; con el de uno que existe, el ser recibe el evento y su atención decide.
- **Convergencia:** con todo igual, los extraordinarios de un mismo camino se cruzan más seguido que los de caminos distintos, sin teletransportes.
- **Sin fuga:** el narrador no recibe la fórmula verdadera, el umbral ni nombres que el personaje no conoce.
- **Determinismo:** mismo seed, mismas acciones → mismos caminos, mismas pociones, mismas pérdidas de control.

## Decisiones tomadas en este borrador (revisables)

- **Es una familia más** con los conceptos genéricos de metaphysics; no hay un motor aparte (principio 1).
- **Se toma la mecánica, no los nombres:** caminos, dioses, iglesias y épocas se generan por seed (principio 6).
- **Las características se conservan, se atraen y tienen unicidad en la cima** (§3, §4).
- **Digerir actuando** es la forma de práctica de esta familia; el método es saber secreto (§6).
- **Los nombres honoríficos llegan de verdad** como física del mundo, y saberlos es peligroso (§8).
- **El secreto sobre lo sobrenatural es una decisión de organizaciones,** no una regla (§13).
- **Era típica industrial,** con mundos de otras eras posibles (§13, §14; technology §9b).

## Preguntas abiertas

- Calibración: cantidad de caminos y tamaño de los grupos; masa de característica por secuencia; velocidad de digestión por coincidencia con el papel; umbral de pérdida de control; fuerza de la convergencia; tiempo en que la característica deja un cadáver; frecuencia de criaturas con característica; cuánto pesa una bala contra cada banda.
