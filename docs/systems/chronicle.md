# Crónica, epílogo e historiografía

> Estado: **borrador de diseño**. Dos caras de la memoria: **adentro del mundo**, las crónicas, genealogías, estelas, canciones y memorias que escriben personas con intereses (oficiales, de secta, de familia, populares), que se copian con errores, se censuran, se reescriben con cada dinastía y se queman; y **afuera**, la crónica final para el usuario, que se arma desde la verdad cuando la partida termina: la vida en capítulos elegidos por su huella causal, "lo que nunca supiste", un epílogo simulado (qué fue de tu gente, tus obras, tus enemigos, años y siglos después) y el legado medido dos veces, como lo que causaste y como lo que se recuerda de vos.

Depende de: [causality.md](causality.md) (el grafo causal: la huella de una vida son los eventos que descienden de sus actos), [deep-history.md](deep-history.md) (embudo de relevancia y olvido entre épocas: qué sobrevive del jugador), [information.md](information.md) (creencias, rumores con linaje, reputación colectiva, medios, alfabetización), [living-world.md](living-world.md) (mitos como historia deformada, el conocimiento es físico), [npc-psychology.md](npc-psychology.md) (memorias de los que te conocieron, intensidad emocional, influencia en otros), [schemes.md](schemes.md) (sección "Lo que nunca supiste"), [perception.md](perception.md) (creencias equivocadas que solo la crónica revela), [spirits.md](spirits.md) (fin de partida cuando el alma cruza o se disipa; reencarnación), [family-lineage.md](family-lineage.md) (descendencia y herencia en el epílogo, genealogías), [organizations.md](organizations.md) (archivos y memoria institucional), [state.md](state.md) (crónicas oficiales y propaganda, la nueva dinastía reescribe), [heaven-karma.md](heaven-karma.md) (karma que queda abierto después de la muerte), [technology.md](technology.md) (escritura, papel, imprenta: cuánto y cómo se escribe), [body-health.md](body-health.md) (causa de muerte), [divination.md](divination.md) (profecías cumplidas e incumplidas). Lo usan: [schemes.md](schemes.md) (revelación final de intrigas), [law.md](law.md) (juicios célebres, injusticias recordadas, la verdad del caso al final), [social-structure.md](social-structure.md) (el ascenso o la caída como arco de vida), [family-lineage.md](family-lineage.md) (descendencia en el epílogo), [state.md](state.md) (crónicas oficiales sesgadas), [organizations.md](organizations.md) (crónicas propias de cada organización), [war.md](war.md) (guerras como capítulos, versiones del vencedor), [contracts.md](contracts.md) (promesas que se recuerdan), [discovery.md](discovery.md) (escuelas que reescriben su historia), [technology.md](technology.md) (historiografía y archivos), [secret-realms.md](secret-realms.md) (expediciones como capítulos), [divination.md](divination.md) (profecías en la historia).

## Principios
1. **La historia escrita es una creencia con autor.** Adentro del mundo, toda crónica la escribe alguien que sabe lo que sabe, cree lo que cree y quiere lo que quiere. No hay historiadores neutrales; hay fuentes mejores y peores.
2. **El texto es un objeto.** Una crónica existe en un soporte (living-world §7): se copia con errores, se pierde, se quema, se esconde, se encuentra en una ruina. Lo que nadie escribió o nadie copió, el futuro no lo sabe.
3. **La crónica final lee la verdad.** Cuando la partida termina, y solo entonces, el narrador recibe la verdad del mundo sobre la vida del personaje (Regla 4 tiene esta única excepción, ya prevista en schemes). Antes, nunca.
4. **Lo que importa se mide por consecuencias.** Los capítulos de una vida no son los eventos más ruidosos sino los que más descendencia causal tuvieron: la palabra que hizo que un discípulo dejara la secta y fundara otra pesa más que cien peleas sin consecuencia.
5. **Dos legados.** Lo que causaste (la huella causal, en la verdad) y lo que se recuerda de vos (creencias en la gente y en los textos). Casi nunca coinciden, y la distancia entre los dos es parte de lo que la crónica cuenta.
6. **El epílogo es la misma simulación.** Lo que pasa después de tu muerte no se inventa: el mundo sigue corriendo sin vos, con las mismas reglas, y la crónica cuenta lo que pasó.
7. **El LLM redacta, no decide.** La simulación arma un borrador estructurado (capítulos, hechos, citas, contrastes); el narrador lo convierte en prosa sin agregar hechos.
8. **Determinista.** El epílogo continúa el mismo mundo con el mismo RNG; la selección de capítulos y la composición del borrador son funciones puras del estado.

## 1. Crónicas adentro del mundo

```ts
interface HistoricalText {
  id: TextId;
  kind: TextKind;                            // ver tabla
  author: PersonId | OrgId;                  // o "anónimo" con un autor verdadero que existe
  patron?: AgentId;                          // quien lo encargó o lo paga
  subject: EntityRef[];                      // de qué o de quién trata
  claims: Belief[];                          // lo que afirma (information): verdad, error o mentira, cada una con su relación con la verdad
  framing: FramingBias[];                    // cómo lo cuenta (§2)
  language: LanguageId;
  script: ScriptId;                          // sistema de escritura (technology §5)
  copies: SupportId[];                       // cada copia es un objeto con sus propios errores y su destino
  originEventId: EventId;                    // el encargo, la decisión de escribir, el fin de una guerra
}
```

| Tipo | Quién la escribe | Sesgo típico |
|---|---|---|
| **Crónica oficial** | Historiadores de la corte (state) | Legitimar la dinastía; la anterior cayó por merecerlo; los presagios la favorecían |
| **Crónica de secta** | Archiveros de la secta (organizations §7) | Fundadores sabios, enemigos viles, derrotas como traiciones, técnicas como revelación |
| **Genealogía** | Clanes y familias (family-lineage) | Ancestros ilustres, ilegítimos borrados, ramas pobres olvidadas, adopciones calladas |
| **Anales locales** | Magistrados, templos, monjes | Precios, cosechas, plagas, presagios; secos y a veces los más fieles |
| **Memorias** | Cualquiera que sabe escribir | Defender la propia actuación, cobrar viejas cuentas |
| **Estelas e inscripciones** | Quien pagó la piedra | Victorias, obras, donaciones; duran milenios y mienten igual |
| **Epitafios** | La familia o el discípulo | Virtudes; los defectos se entierran con el muerto |
| **Canciones, cuentos, teatro** | Poetas, cuentacuentos, el pueblo | Héroes y villanos simples, detalles inventados, moralejas; llegan a todos |
| **Textos prohibidos** | Disidentes, vencidos, herejes | La versión contraria; pueden ser más fieles o igual de interesados |

- **Quién escribe:** solo los que saben escribir y tienen soporte (information §6, technology §5). En culturas sin escritura, la historia vive en canciones, genealogías recitadas y mitos (living-world §4), con los mismos sesgos y más deformación.
- **Por qué escribe:** encargo (un soberano, una secta, una familia que paga), deber de oficio (el analista del condado), interés propio (memorias), fe o venganza. Escribir es una acción de un agente con utilidad.
- **Qué sabe:** lo que el autor cree (sus creencias, con sus errores), lo que encuentra en archivos y lo que le cuentan. Un historiador que trabaja dos siglos después escribe desde fuentes, no desde los hechos.

## 2. Sesgos y reescrituras

```ts
type FramingBias =
  | { kind: "glorify" | "vilify"; target: EntityRef }
  | { kind: "omit"; events: EventId[] }      // lo que no se cuenta (el sesgo más fuerte y menos visible)
  | { kind: "invent"; claims: Belief[] }     // hechos fabricados
  | { kind: "causal_spin"; event: EventId; attributedTo: EntityRef }  // "la sequía fue castigo del Cielo al rey anterior"
  | { kind: "moralize"; lesson: string }     // la historia como ejemplo
  | { kind: "doctrine"; dogma: DogmaId };    // la escuela que no admite su error (discovery §6)
```

- **Cada régimen reescribe:** la dinastía nueva escribe la historia de la anterior (state §9); la secta que absorbió a otra cuenta su versión; la escuela que cambió de doctrina reescribe a sus fundadores (discovery §6).
- **Censura y quema:** los textos incómodos se prohíben, se requisan, se queman. Sobreviven las copias escondidas, que se vuelven raras y valiosas.
- **Copias:** cada copia puede meter errores (information §3) e interpolaciones deliberadas; el texto que llega dentro de quinientos años no es el que se escribió.
- **Comparar fuentes:** los historiadores serios (y el jugador) pueden confrontar textos: es formar hipótesis sobre el pasado con evidencia (discovery §2-3). Las contradicciones son pistas.
- **Usos:** legitimar un reclamo (state §8), probar un linaje (family-lineage), reclamar una herencia, justificar una guerra (war §1), encontrar un reino secreto (secret-realms), recuperar una técnica perdida.

## 3. El fin de la partida

La partida termina cuando el alma del personaje **cruza al ciclo o se disipa** (spirits §3c). En ese momento:
1. Se congela la vida: el personaje y sus memorias quedan como están.
2. Se arma la **crónica** desde la verdad (§4-§6).
3. Se corre el **epílogo** (§7).
4. El usuario elige lo que sigue: un mundo nuevo o, si el alma cruzó al ciclo, renacer en este (spirits §3e).

## 4. La vida en capítulos

```ts
interface Chronicle {
  subject: PersonId;                         // el personaje
  epitaph: string;                           // la línea resumen (VISION: "Li Wei, 16–53, Mortal → Núcleo Dorado, fundador de...")
  chapters: ChronicleChapter[];
  neverKnew: NeverKnewEntry[];               // §5
  death: DeathRecord;                        // causa real y cadena (body-health: causes)
  legacy: LegacyMeasure;                     // §6
  epilogue: EpilogueSection[];               // §7
  sources: EventId[];                        // todo lo que la crónica afirma apunta a eventos reales
}

interface ChronicleChapter {
  span: { from: Tick; to: Tick };
  title: ChapterTitleSeed;                   // semilla estructurada (lugar, rol, giro) que el narrador convierte en título
  turningPoints: EventId[];                  // los eventos con más huella causal o más intensidad en la memoria del personaje
  people: PersonId[];                        // quiénes importaron en ese tramo
  arc: ArcSummary;                           // cambios de posición (social-structure), umbral (cultivation), lugar, organización, relaciones
}
```

- **Cortes de capítulo:** los cambios grandes de vida (mudarse, entrar o salir de una organización, romper un umbral, casarse, perder a alguien, cambiar de posición social, una guerra) parten la vida en tramos.
- **Puntos de giro:** dentro de cada tramo, se eligen los eventos con mayor **huella causal** (§6: cuántos eventos posteriores descienden de ellos y cuánto pesaron) y con mayor intensidad en la memoria del personaje (npc-psychology). Lo que cambió el mundo y lo que lo marcó a él.
- **Personas:** la crónica nombra a quienes más pesaron: maestros, amantes, rivales, hijos, víctimas, discípulos.
- **Todo afirmación tiene fuente:** cada frase del borrador apunta a eventos; el narrador no puede agregar hechos que no estén ahí.

## 5. Lo que nunca supiste

La sección que solo la muerte abre. Se arma comparando las creencias finales del personaje con la verdad:
- **Intrigas** que te afectaron sin que te enteraras (schemes): quién, por qué, qué previó de vos, las que fallaron.
- **Creencias equivocadas** importantes: quién era tu padre (family-lineage), quién mató a tu maestro, si tu amigo te traicionó o no, si el veneno fue accidente.
- **Casos** que viviste con la verdad que nunca salió (law): el inocente condenado, el culpable libre.
- **Consecuencias que no viste:** la aldea que desapareció por algo que hiciste, el niño que salvaste y en qué se convirtió, la bestia que dejaste vivir.
- **Lo que tenías al alcance:** el talento oculto que nunca descubriste (cultivation), la herencia en la cueva por la que pasaste, el reino secreto bajo tu casa.
- **Selección:** se eligen por peso (cuánto cambiaba tu vida si lo hubieras sabido, cuánto te afectó), no se listan todas.

## 6. El legado

```ts
interface LegacyMeasure {
  footprint: CausalFootprint;                // lo que causaste
  remembered: RememberedAs[];                // lo que se cree de vos, por grupo y por texto
  karma: KarmicBond[];                       // lo que quedó abierto (heaven-karma: deudas que pasan al linaje y a los discípulos)
  carriers: LegacyCarrier[];                 // personas, organizaciones, técnicas, obras, textos, objetos que llevan algo tuyo
}

interface CausalFootprint {
  descendants: number;                       // eventos que descienden causalmente de tus actos (con decaimiento por distancia en el grafo)
  weight: number;                            // ponderado por magnitud (vidas, riqueza, poder, organizaciones afectadas)
  topLines: EventId[][];                     // las cadenas más largas y pesadas que empiezan en vos
}

interface RememberedAs {
  group: PopulationRef | OrgId | TextId;     // una aldea, una secta, una crónica oficial
  beliefs: Belief[];                         // héroe, villano, santo, monstruo, nadie; con qué detalles
  strength: number;                          // cuánta gente y cuán vivamente (decae: deep-history)
}
```

- **Huella causal:** se calcula recorriendo el grafo de eventos hacia adelante desde los actos del personaje, con decaimiento por distancia y por la cantidad de otras causas que concurren (no sos responsable de todo lo que viene después de vos). Las cadenas más largas son las más interesantes de contar.
- **Lo recordado:** las creencias sobre el personaje en la población (information §9: reputación colectiva), en sus organizaciones, en los textos que hablan de él, en canciones y mitos. Puede ser mucho más grande o mucho más chico que la huella, y deformado (living-world §4: el mito puede atribuirte lo que hizo otro o borrarte de lo que hiciste).
- **El contraste es el centro:** "nadie recuerda que fuiste vos quien desvió el río; la ciudad entera se mudó por eso" o "la canción dice que mataste al dragón; lo mató tu discípulo y lo dejaste creer".
- **Portadores:** tus discípulos y su escuela, tus hijos, tus técnicas escritas, tu espada (spirits: espíritu de objeto), tu tumba, la secta que fundaste, la enemistad que heredaron tus nietos.

## 7. Epílogo

```ts
interface EpilogueRun {
  fromTick: Tick;                            // la muerte del personaje
  checkpoints: EpilogueCheckpoint[];         // por ejemplo: 1 año, 10 años, 100 años, y más si el legado sobrevive
  tracked: EntityRef[];                      // lo que se sigue con detalle: portadores del legado, personas cercanas, enemigos, organizaciones
  stopAt?: Tick;                             // límite si el usuario va a renacer en este mundo (§8)
}

interface EpilogueSection {
  at: Tick;                                  // "diez años después"
  facts: EpilogueFact[];                     // qué fue de cada cosa seguida, con fuentes
  rememberedAt: RememberedAs[];              // cómo se te recuerda en ese momento
}
```

- **Es la misma simulación:** el mundo sigue desde la muerte, sin el agente del personaje, con las mismas reglas. Las entidades `tracked` se mantienen en un tier alto durante los primeros años y bajan a agregado después.
- **Puntos de control:** al año (el duelo, la herencia, quién ocupa tu lugar), a los diez años (tus hijos, tus discípulos, tus enemigos, tus obras), al siglo (qué quedó), y más allá solo si algo tuyo sigue pasando el embudo de relevancia (deep-history): una secta, una técnica, un mito, una deuda de sangre que sigue cobrándose.
- **El epílogo se corta cuando ya no queda nada tuyo**: cuando ningún portador vive y nadie te recuerda, la última línea lo dice ("trescientos años después, nadie sabe quién fue Li Wei; la escuela del Río Negro enseña su técnica atribuida a un inmortal sin nombre").
- **Costo:** se corre en modo agregado con detalle solo en lo seguido; los puntos lejanos son baratos porque usan la historia agregada.

## 8. Renacer en el mismo mundo

Si el usuario elige renacer en este mundo (spirits §3e), el epílogo choca con el renacimiento: el usuario sabría el futuro.
- **Regla:** el momento del renacimiento lo decide la simulación (spirits: décadas o siglos). Si el usuario elige renacer, el epílogo **se corta en ese momento**: muestra lo que pasó hasta que el alma vuelve, y nada después.
- **Lo que ya vio del epílogo es verdad** del mundo hasta ese punto, y el usuario lo sabe aunque el personaje nuevo no (spirits §3e: saber no es poder hacer, y el mundo lo nota).
- **La elección se hace antes del epílogo**, para que nunca se vea más allá del renacimiento.

## 9. Archivo de vidas

- Cada crónica terminada se guarda: semilla del mundo, personaje, capítulos, legado, epílogo. Es el archivo de vidas pasadas (ROADMAP fase 9).
- Las vidas en un mismo mundo (por renacimiento) se encadenan: la crónica de la segunda vida puede mostrar cómo se cruzó con el legado de la primera (tu discípulo de entonces, tu tumba saqueada, tu leyenda deformada).
- El archivo es del usuario, no del mundo: ningún personaje lo lee.

## 10. El jugador y el narrador
- **En vida, el jugador vive la historiografía como cualquiera:** lee crónicas sesgadas, escucha canciones, busca genealogías, compara fuentes para descubrir algo (un linaje, un reino, un crimen viejo). Puede encargar una crónica que lo haga quedar bien, escribir sus memorias, levantar una estela, quemar textos que lo acusan, pagar a un poeta. Todo eso mueve **lo recordado**, no la huella.
- **El narrador, en vida,** cuenta los textos como los lee el personaje: lo que dicen, no lo que pasó.
- **Al final**, el narrador recibe el borrador de la crónica (con la verdad) y lo redacta. Tono: el de un cronista que sabe todo y no juzga más que los hechos; puede alternar con "como lo cuentan" (fragmentos de textos y canciones del mundo) para mostrar el contraste. No agrega hechos, no inventa citas, no suaviza ni dramatiza lo que el borrador no dice.

## 11. Escala (LOD)
- **Tier 0:** textos como agregados por cultura (cuánto se escribe, qué sobrevive, qué versión domina); reescrituras al cambiar de régimen como eventos de la historia agregada.
- **Tier 1-2:** textos concretos en archivos de organizaciones y bibliotecas cerca del jugador, con autor, sesgos y copias.
- **Tier 3-4:** el texto que el personaje lee, con sus afirmaciones legibles.
- **Crónica final:** la huella causal se calcula sobre el grafo completo con poda por peso; el epílogo sigue en detalle solo lo `tracked`.

## Implementación
- **Fase 1:** muerte → pantalla de crónica mínima: epitafio, causa de muerte real y cadena, capítulos por cortes de vida, sin epílogo.
- **Fase 2:** "Lo que nunca supiste" (intrigas y creencias equivocadas) y personas importantes por relaciones y memoria.
- **Fase 3:** epílogo corto (un año, diez años) con descendencia y herencia (family-lineage).
- **Fase 6:** textos adentro del mundo como objetos (crónicas de organización, genealogías, memorias) con sesgos; encargar y escribir.
- **Fase 7:** reescrituras por régimen, censura y quema, estelas y canciones en la historia agregada; huella causal y legado recordado con el embudo de deep-history; epílogo hasta que se apague el legado.
- **Fase 9:** archivo de vidas, encadenado de vidas en un mismo mundo, presentación en la UI web.

## Tests
- **Fuentes:** toda afirmación del borrador de la crónica apunta a eventos existentes; el narrador no recibe nada sin fuente.
- **Verdad solo al final:** el narrador no recibe ninguna proposición de la verdad fuera de la crónica final (salvo lo que el personaje cree).
- **Huella vs ruido:** un evento con muchos descendientes causales pesados aparece como punto de giro antes que uno de alta violencia sin consecuencias.
- **Dos legados:** en corridas headless hay vidas con huella grande y recuerdo chico, y al revés.
- **Epílogo coherente:** el epílogo es idéntico a seguir la simulación sin el personaje desde su muerte.
- **Corte por renacimiento:** si el usuario elige renacer, ningún hecho del epílogo es posterior al renacimiento.
- **Textos sesgados:** una crónica oficial escrita por la dinastía vencedora tiene más afirmaciones falsas sobre la dinastía anterior que unos anales locales del mismo período.
- **Determinismo:** mismo seed, mismas acciones → misma crónica estructurada y mismo epílogo.

## Decisiones tomadas en este borrador (revisables)
- La crónica final es la única ocasión en que el narrador recibe la verdad, y solo sobre lo que el borrador incluye.
- Los capítulos se eligen por huella causal e intensidad en la memoria, no por espectacularidad.
- El legado se mide dos veces (causado y recordado) y el contraste es parte central de la crónica.
- El epílogo es la misma simulación sin el personaje, con puntos de control, y termina cuando no queda nada suyo.
- Si el usuario renace en el mismo mundo, elige antes del epílogo y el epílogo se corta en el renacimiento.
- Las crónicas adentro del mundo son objetos con autor, sesgo y copias; leer historia es formar hipótesis con fuentes.

## Preguntas abiertas
- Calibración: decaimiento de la huella causal por distancia en el grafo y por causas concurrentes.
- Calibración: cantidad de capítulos y de puntos de giro por vida según su duración (que una vida de 16 años y una de 800 tengan crónicas legibles).
- Calibración: puntos de control del epílogo y umbral de relevancia para seguir más allá del siglo.
- Calibración: tasa de errores por copia y de reescritura por cambio de régimen.
- Calibración: cuántas entradas tiene "Lo que nunca supiste" y con qué criterio de peso.
