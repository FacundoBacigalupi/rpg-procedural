# Culturas

> Principio: **una cultura no es una etiqueta sino lo que la gente hace, cree y se enseña.** Cada costumbre vive en personas concretas que la aprendieron de alguien, la practican con más o menos ganas y se la pasan a sus hijos, cambiada. "La cultura del valle" es el nombre que se le da a un parecido entre muchas de esas personas. Por eso cambia, se mezcla, se pierde y se inventa, y cada rasgo tiene una historia que lo explica.

> Estado: **borrador** (2026-10-06).

Depende de: [living-world.md](living-world.md) §3, §4, §5 (la geografía hace a las culturas, mitos, calendarios), [deep-history.md](deep-history.md) (pueblos que se separan, secuencias de estilos, embudo de legados), [npc-psychology.md](npc-psychology.md) §2, §10, §13, §14, §16 (valores y esquemas, períodos sensibles, pertenencia, multitudes, gustos), [information.md](information.md) §1, §3, §9 (creencias, deformación, conocimiento colectivo), [social-structure.md](social-structure.md) §2, §3, §4, §11 (estatus, percibir la posición, etiqueta, género y etnia), [perception.md](perception.md) (marcadores que se ven y se oyen), [technology.md](technology.md) (difusión y prerrequisitos), [economy.md](economy.md) (demanda, comercio), [weather.md](weather.md) §4 (estaciones, calendarios), [planet-gen.md](planet-gen.md) (lo que hay y lo que crece).
Lo usan: [law.md](law.md) (códigos por cultura), [social-structure.md](social-structure.md) (estatus, etiqueta, normas de género y edad), [property.md](property.md) (formas de tenencia), [family-lineage.md](family-lineage.md) (parentesco, matrimonio, herencia, luto), [settlements.md](settlements.md) §4 (trazados y estilos), [crafts.md](crafts.md) (estilos, recetas, gusto), [spirits.md](spirits.md) (funerales, ofrendas), [dialogue.md](dialogue.md) §10, §13 (cara, humor, malentendidos), [elements.md](elements.md) §9 (teorías culturales), [language.md](language.md), [religion.md](religion.md), [narration.md](narration.md) (léxico y lo que al personaje le parece normal), [chronicle.md](chronicle.md).

---

## Principios

1. **Los rasgos viven en las personas.** Cada uno tiene prevalencia en una comunidad y fuerza en cada persona. La cultura de un lugar es la distribución de esos rasgos, no una lista fija.
2. **Todo rasgo tiene origen:** una adaptación al lugar, un evento, una imitación, un invento de alguien o una deriva sin función. Queda en `originEventId`.
3. **Se transmite con sesgos:** de padres, mayores, maestros, pares e instituciones, y se copia más lo que hacen los prestigiosos, lo que hace la mayoría y lo que funciona.
4. **Cambia siempre:** por invento, por moda, por generación, por golpes (guerra, hambre, epidemia), por imposición y por contacto.
5. **Identidad y etnicidad son creencias:** quién cree uno que es, quién creen los otros que es, y qué marcas lo muestran. La verdad (genoma, historia) puede no coincidir.
6. **Los sistemas leen la cultura de cada persona,** no la de su región: el juez aplica la norma que conoce, la cocinera cocina lo que aprendió.

---

## 1. El modelo

```ts
interface CulturalTrait {                    // content/culture/traits/
  id: TraitId;
  domain: TraitDomain;                       // §2
  variants: TraitVariant[];                  // formas que puede tomar (entierro, cremación, exposición, entierro celeste…)
  params?: ParamSpec[];                      // cuántos días de luto, cuántas reverencias, qué edad para casarse
  requires?: Requirement[];                  // recursos, técnicas, otros rasgos (no hay cocina de arroz sin arroz ni comercio que lo traiga)
  conflictsWith?: TraitId[];
  salience: number;                          // cuánto marca identidad (la ropa y la comida mucho; la forma de arar, poco)
  stickiness: number;                        // cuánto resiste el cambio (parentesco y ritos, mucho; modas, nada)
  readBy: SystemRef[];                       // qué sistemas lo consultan
}

interface TraitHolding {                     // en una persona (tier 2+) o como prevalencia en una comunidad
  trait: TraitId;
  variant: VariantId;
  params?: ParamValues;
  strength: number;                          // cuánto lo practica o lo cree
  outward: boolean;                          // lo muestra en público
  inward: boolean;                           // lo cree o lo siente propio (se puede practicar sin creer y creer sin practicar)
  learnedFrom: AgentId[] | InstitutionRef[];
  since: Time;
}

interface CommunityCulture {                 // agregado
  community: CommunityId;                    // aldea, barrio, clan, gremio, secta, diáspora, banda de pastores
  prevalence: Record<TraitId, VariantDistribution>;
  institutions: InstitutionRef[];            // escuela, templo, consejo de ancianos, salón del clan: lo que enseña y vigila
  originEventId: EventId;
}

interface Culture {                          // nombre de un racimo de comunidades que se parecen
  id: CultureId;
  communities: CommunityId[];
  core: TraitId[];                           // los rasgos que definen el racimo
  parent?: CultureId;                        // de qué cultura se separó
  splitEventId?: EventId;
  names: { endonym: LexemeRef; exonyms: Record<CultureId, LexemeRef> };   // cómo se llaman y cómo los llaman ([language.md](language.md) §9)
  styleSequence: StyleStageId[];             // secuencia de estilos (deep-history §3)
  originEventId: EventId;
}
```

- **`Culture` es un agregado con nombre,** útil para la historia, la arqueología y el narrador. La sim decide con `TraitHolding` (personas) y `CommunityCulture` (comunidades).
- **Las fronteras son difusas:** entre dos culturas hay aldeas mezcladas, familias de dos orígenes y gente que habla los dos idiomas.
- **Subculturas:** cada clase, gremio, secta, puerto, generación y oficio tiene sus rasgos propios sobre la base común (el habla de los barqueros, la etiqueta de la corte, la jerga de los discípulos).

## 2. Dominios de rasgos

| Dominio | Ejemplos | Lo leen |
|---|---|---|
| Comida | Cereal base, especias, formas de cocinar, comidas prohibidas, cuántas comidas por día, quién come primero, hospitalidad | economy (demanda), body-health (nutrición), crafts (cocina) |
| Ropa y adorno | Telas, cortes, colores, peinados, tatuajes, joyas; qué se cubre | perception (marcas), social-structure §2 (suntuarias), body-health §7 (abrigo) |
| Vivienda y espacio | Formas de casa, quién duerme dónde, patio, altar, separación de sexos | settlements §4, §5 |
| Parentesco y familia | Linaje por padre o madre, residencia tras el casamiento, matrimonio (monogamia, concubinas, dote, precio de novia), adopción, herencia | family-lineage, property |
| Ritos de paso | Nacimiento y nombre, mayoría de edad (冠礼), boda, iniciación en un oficio o una secta, vejez | npc-psychology §10, organizations |
| Funerales y luto | Entierro, cremación, exposición, entierro celeste; duración del luto (守孝 que saca a un funcionario de su cargo); tumbas y ofrendas | spirits, family-lineage §11, deep-history (tumbas), state |
| Fiestas | Cosecha, año nuevo, día de los muertos, aniversario de una victoria, el santo del lugar | weather §4, economy, npc-psychology (ánimo) |
| Normas y tabúes | Qué no se hace y qué sanción trae (habladurías, vergüenza, expulsión, ley) | law, npc-psychology (disonancia) |
| Valores | Sesgo sobre los valores de npc-psychology §2 (familia, tradición, libertad, fuerza…) y esquemas frecuentes | npc-psychology |
| Etiqueta y cara | Saludos, reverencias, formas de tratamiento, regalos, modales de mesa, quién habla primero | social-structure §4, dialogue §10 |
| Humor | De qué se ríe la gente: juegos de palabras, burla del poderoso, lo escatológico, la ironía | dialogue |
| Estética y arte | Colores, formas, materiales preferidos, escalas musicales, formas poéticas, secuencia de estilos | crafts, economy (valor del arte), deep-history §3 |
| Saber práctico | Cómo se ara, se pesca, se cura, se cuenta; teorías de los elementos y de la geomancia | technology, elements §9, settlements §4 |
| Género y edad | Qué puede hacer cada uno, a qué edad | social-structure §11 |
| Propiedad | Formas de tenencia, prescripción | property §4 |
| Cosmovisión | Qué hay después de la muerte, qué es el Cielo, quién manda la lluvia | [religion.md](religion.md), spirits, weather §10 |
| Calendario | Desde qué evento se cuentan los años, términos solares, días fastos y nefastos | living-world §5, weather §4, divination |

## 3. De dónde sale cada rasgo

- **Adaptación:** la comida sale de lo que crece y de lo que llega por comercio; la casa, del clima y los materiales; muchos tabúes son ecológicos con mecanismo (living-world §4). La adaptación es real pero imperfecta: la cultura acierta a veces sin saber por qué.
- **Eventos:** una victoria se vuelve fiesta, una epidemia cambia los funerales (quemar a los muertos), un cultivador demoníaco deja una prohibición de técnicas de sangre (law §1).
- **Imitación de prestigio:** lo que hace la corte, la secta poderosa o la ciudad rica se copia hacia abajo y hacia afuera.
- **Invento:** alguien concreto inventa un plato, un estilo, un baile, una canción (discovery, crafts) y se difunde si gusta.
- **Deriva:** cambios sin función, como en las lenguas: un adorno que se pone de moda, una palabra de saludo que se acorta.
- **Arrastre:** un rasgo cuya función desapareció sigue por tradición (la costumbre de una aldea que ya no tiene el problema que la hizo nacer). La gente le inventa razones nuevas.

## 4. Transmisión

- **Vertical:** de padres y abuelos a hijos, sobre todo en los períodos sensibles (npc-psychology §10). Lo que se aprende de chico (comida, lengua, modales, miedos) pesa toda la vida.
- **Oblicua:** maestros, ancianos, sacerdotes, escuelas del estado, salones de clan, sectas. Las instituciones enseñan y vigilan, y cambian lo que se transmite.
- **Horizontal:** pares y modas, sobre todo entre jóvenes y en las ciudades.
- **Sesgos de copia:** se copia lo que hace la mayoría (conformidad), lo que hace el admirado (prestigio, npc-psychology §9c: imitación y legado), lo que da resultado (una semilla mejor, una técnica de pesca) y lo que es fácil de recordar o emociona (contenido).
- **Por fuera y por dentro:** una persona puede practicar en público lo que no cree (el converso forzado que sigue rezando a escondidas) o creer lo que no practica. Las dos cosas se transmiten distinto: los hijos ven lo de afuera y a veces descubren lo de adentro.
- **Sanciones informales:** el chisme, la burla, la vergüenza, la exclusión del mercado o del matrimonio. La comunidad vigila más que la ley, y vigila según lo que cree que el otro hizo (information).

## 5. Cambio

- **Moda en ciudades:** las élites usan marcas para distinguirse; los de abajo las copian; las élites las cambian. Ciclos que se ven en la ropa, los peinados, la poesía y la cerámica, y que la arqueología después usa para fechar (deep-history §3).
- **Generaciones:** los jóvenes que crecieron en otra situación (paz, guerra, ciudad) cambian lo que adoptan; los viejos se quejan de que todo se pierde.
- **Golpes:** guerras, hambrunas, epidemias y migraciones rompen cadenas de transmisión (mueren los que sabían) y fuerzan cambios rápidos.
- **Imposición:** edictos que obligan o prohíben una costumbre (un peinado de la dinastía conquistadora, prohibir un culto, imponer la lengua de la corte). Generan obediencia por fuera, resistencia por dentro y a veces revueltas (state, social-structure §10).
- **Revival y tradiciones inventadas:** un grupo que se siente amenazado "recupera" costumbres viejas, a veces inventadas hace poco y presentadas como milenarias. La verdad sabe cuándo nació cada una; la gente cree lo que se le dice (chronicle: historiografía).
- **Pérdida:** un saber que nadie practica se olvida (technology: pérdida y regresión); queda en textos, en ruinas o en una abuela.

## 6. Generación desde la geografía y la historia

- **En la historia profunda** (deep-history, modo agregado), cada pueblo arranca con los rasgos de su origen y los adapta a donde vive (living-world §3): la economía empuja los valores, el clima y los materiales dan comida, ropa y casa, el terreno da aislamiento o contacto.
- **Separación:** cuando un pueblo se divide (montañas, mar, migración), sus comunidades derivan por separado, como las lenguas. Culturas hermanas comparten rasgos con variantes distintas; las lejanas, casi nada.
- **Sin mínimo de diferencias** (aprobado 2026-10-06): las culturas se parecen o se distinguen según su historia y su geografía. Dos vecinos que siempre comerciaron se parecen mucho; dos separados por una montaña durante siglos, poco. No se fuerza un contraste para que se "sientan distintas".
- **Cada rasgo con su historia:** el generador no sortea "esta cultura come perro" de una tabla: el rasgo existe porque hubo un origen posible (escasez, un evento, contacto) y la deriva lo sostuvo. El RNG con clave `("culture", comunidad, época)` elige entre variantes permitidas.
- **El embudo guarda lo necesario** (deep-history): por región y época, las culturas presentes con sus rasgos centrales, su secuencia de estilos y sus contactos, para que la arqueología y los mitos tengan respuesta en la verdad.

## 7. Contacto

- **Préstamo selectivo:** se adopta rápido lo útil y visible (técnicas, cultivos, comidas, armas, palabras) y despacio lo profundo (parentesco, valores, ritos de muerte). Cada préstamo tiene vector: un mercader, un matrimonio, una conquista, un monje (travel §14).
- **Sincretismo:** dioses que se funden, fiestas que se superponen, el santo del pueblo que es el viejo espíritu del río con otro nombre ([religion.md](religion.md) §9, spirits §9).
- **Mezcla y criollización:** en puertos y fronteras nacen culturas nuevas de dos o más, con su propia identidad.
- **Aculturación y asimilación:** una minoría adopta la cultura dominante por presión, prestigio, matrimonio o conveniencia. Primero por fuera, después por dentro y al final en la identidad. Puede tardar tres generaciones o no pasar nunca.
- **Resistencia:** las comunidades amenazadas marcan más sus diferencias (comida, ropa, endogamia), y la diáspora conserva formas que en el lugar de origen ya cambiaron.
- **Malentendidos entre culturas:** el mismo gesto significa cosas distintas; el regalo correcto en una es un insulto en otra (dialogue §13, §10). Cada persona los interpreta con su propia cultura.

## 8. Identidad y etnicidad

```ts
interface IdentityBelief {                   // una creencia más (information §1)
  holder: AgentId;                           // quién cree
  about: AgentId;                            // de quién (uno mismo u otro)
  group: GroupLabel;                         // "gente del valle", "han", "bárbaros del norte", "los de la secta"
  confidence: number;
  basis: Array<"birth" | "upbringing" | "markers" | "speech" | "genealogy" | "claim" | "rumor">;
}
```

- **Identidad propia y adscripta:** lo que uno cree ser y lo que los demás creen que es. Pueden no coincidir: el hijo de inmigrantes que se siente local y al que el pueblo sigue llamando extranjero.
- **Las fronteras se sostienen con marcas** más que con contenido: ropa, acento, comida, peinado, nombres. Se perciben (perception, social-structure §3), se pueden ocultar y se pueden imitar para pasar por otro.
- **Estereotipos** son creencias sobre grupos (information): se transmiten y se deforman como cualquier rumor y sesgan las decisiones (npc-psychology: sesgo de grupo). Algunos tienen una base estadística real y la mayoría la exagera.
- **Etnogénesis:** identidades nuevas nacen de eventos (una rebelión, una migración, una secta que se vuelve pueblo, una frontera que separa a los que antes eran uno) y se dan un mito de origen (living-world §4).
- **Pureza:** los grupos que se creen puros casi nunca lo son. El genoma (family-lineage §1) guarda la mezcla real; el inspector la muestra; la gente cree su genealogía.
- **Pertenencia** (npc-psychology §13): sentirse parte de un grupo da sentido; perderlo (exilio, conversión, asimilación) duele y empuja decisiones.

## 9. Costumbres en detalle

- **Comida:** platos con receta (crafts: cocina) que salen de los ingredientes locales y comerciados; comidas de fiesta, de luto y de pobreza; hospitalidad con reglas (cuántos días se aloja a un extraño, qué se le debe); cultivadores que ayunan de granos (辟谷) y lo leen como pureza.
- **Ropa:** materiales del lugar y del comercio, cortes por clima, marcas de estatus, edad, estado civil y luto; leyes suntuarias (social-structure §2).
- **Ritos de paso:** cambian el estatus reconocido (social-structure) y abren derechos: el joven que hizo su rito puede casarse, heredar o ir a la guerra. Saltarse uno tiene costo social.
- **Funerales:** la forma (entierro, cremación, exposición) decide qué queda para la arqueología y qué pasa con el cuerpo. Si el rito importa para el alma depende de la ley del mundo (spirits §0, §8) (aprobado 2026-10-06): en la familia xianxia, un rito bien hecho ayuda un poco a cruzar y su ausencia sube la chance de quedarse anclado; en otros mundos el rito solo consuela a los vivos.
- **Fiestas:** juntan gente (mercados, romances, peleas, contagios: body-health), mueven la economía (demanda de comida, ropa, incienso) y el ánimo; se fijan en el calendario de la cultura (weather §4).

## 10. Estética, arte y humor

- **Gusto cultural:** sesgo sobre los gustos personales (npc-psychology §16): colores, formas, sabores, músicas. El valor de una pieza de arte es una creencia cultural que fija precios (economy).
- **Secuencias de estilo:** cada cultura cambia sus estilos en secuencia (deep-history §3). Los artesanos copian a sus maestros e innovan un poco, y a veces imitan lo antiguo a propósito.
- **Arte con intención** (discovery): un poema, una pintura o una canción expresa algo y la cultura lo lee con sus claves; afuera puede no entenderse.
- **Humor:** un chiste es un acto de habla (dialogue) cuya recepción depende de compartir lengua, referencias y límites. El mismo chiste hace reír en la taberna y ofende en la corte. El LLM verbaliza el chiste; la sim decide quién lo entiende y cómo cae.

## 11. Culturas de los cultivadores

- **Sectas como subculturas** (organizations §7, §8): jerarquía de veteranía (师兄, 师姐), respeto a la fuerza, jerga, ritos de entrada, normas propias que chocan con las de los mortales de alrededor.
- **El jianghu (江湖)**: la cultura de los que viven fuera de la ley común, con códigos de honor, deudas de gratitud, venganza y lealtad. Es contenido por mundo y región.
- **El abismo cultural:** un cultivador que vivió siglos ve a los mortales como de otra cultura, y los mortales le atribuyen costumbres que no tiene (social-structure §6).

## 12. El jugador y el narrador

- **El personaje se cría en una cultura:** sus `TraitHolding` vienen de su infancia (player-loop) y deciden qué le parece normal, qué le da asco y qué sabe hacer sin pensar. El narrador describe lo ajeno como ajeno desde esa mirada.
- **Libertad total:** el jugador puede adoptar costumbres de otro pueblo, romper las suyas, fingir ser de otro lado, inventar un rito o fundar una tradición. Todo con las mismas reglas de transmisión y con las sanciones que correspondan.
- **Cambiar la cultura de un lugar** (aprobado 2026-10-06): con las mismas palancas que cualquiera (prestigio, instituciones, imposición si tiene poder, discípulos que copian su ejemplo). Es lento, y la gente puede obedecer por fuera y resistir por dentro.
- **Conocer una cultura es saber:** familiaridad con esa cultura (skills, clave `culture`), conocimiento de sus normas (lo que vio, lo que le contaron) y errores de etiqueta cuando no la conoce. Un extranjero torpe es perdonado o castigado según quién lo vea.
- **Sin lista de costumbres propias** (aprobado 2026-10-06): las del personaje se notan en cómo narra el narrador, en lo que le da asco o le parece raro y en cómo reaccionan los demás. Un comando fuera del personaje muestra lo que el personaje cree de cada pueblo, incluidos sus estereotipos, sin corregirlos.

## 13. Escala (LOD)

| Resolución | Qué hay |
|---|---|
| Escena y local | `TraitHolding` por persona (tier 2+), transmisión individual, sanciones concretas |
| Regional | `CommunityCulture` con prevalencias; personas que se materializan sorteando de la distribución de su comunidad y su familia |
| Mundo | Culturas como racimos con rasgos centrales, contactos por ruta y difusión agregada |
| Historia | Culturas por época con deriva, separación, contacto, imposición y asimilación; secuencias de estilos; el embudo guarda lo central |

- **Coherencia al materializar** (simulation §6): una persona nueva hereda los rasgos de su familia y su comunidad, y las prevalencias del agregado se respetan.

## 14. Implementación por fase

- **Fase 1:** una cultura para la aldea desde `content/`, con los rasgos que leen los demás sistemas (comida, ropa, funerales, fiestas, etiqueta, sesgo de valores, normas de género y tenencia).
- **Fase 2:** `TraitHolding` por persona; transmisión a los hijos en los períodos sensibles; identidad como creencia; sesgo de grupo y sanciones informales.
- **Fase 3:** fiestas y ritos en la vida fuera de escena y en la economía; modas en el pueblo; prevalencias por comunidad.
- **Fase 5:** culturas vecinas en la región; extranjeros, marcas que se perciben, errores de etiqueta; préstamos por contacto con vector.
- **Fase 6:** subculturas de sectas, gremios y corte; imposición por edicto y resistencia.
- **Fase 7:** generación desde la geografía y la historia; separación y deriva; sincretismo, asimilación, tradiciones inventadas; secuencias de estilos; etnogénesis.

## Implementación (Fase 1, 2026-10-07)

- `sim/culture`: `TraitDef` en `content/culture-traits/` (dominio, variantes, saliencia, tenacidad, `readBy`, comidas requeridas con referencia validada) y `CultureDef` en `content/cultures/` (por rasgo: peso de cada variante, números, **origen** y la razón que la gente le da). `seedCulture` (en `create`, con causa en el evento de los fundadores) escribe `COMMUNITY_CULTURE` por asentamiento: prevalencia normalizada por rasgo. Lectores: `dominantVariant`, `traitParam`, `villageCulture`. Los `StatusDef` y `TenureDef` ahora referencian su cultura (una cultura inexistente impide arrancar).
- La aldea trae 17 rasgos de 17 dominios. **Hoy los lee** `etiquette.address` (`by_rank`: el oyente trata de usted a quien tiene más rango; `uniform` lo apaga). El resto está declarado con su `readBy` y lo irán leyendo los sistemas que les toquen (funerales y luto con familia/espíritus, fiesta con economía y clima, valores con psicología, normas de robo con ley, residencia con familia).
- Falta: `TraitHolding` por persona y transmisión (Fase 2), cambio y modas (Fase 3), culturas vecinas y marcas percibidas (Fase 5).

## Tests

- **Todo rasgo tiene origen** y sus requisitos se cumplen (no hay cocina de arroz sin arroz ni comercio que lo traiga).
- **Determinismo:** misma seed → mismas culturas y mismos rasgos.
- **Agregado contra individual:** las prevalencias de una comunidad coinciden con la suma de sus personas materializadas, con tolerancia.
- **Asimilación:** una minoría con presión y matrimonios mixtos pierde rasgos visibles antes que los profundos.
- **Separación:** dos comunidades separadas divergen más con el tiempo que dos en contacto.
- **Secuencia de estilos:** el estilo de una pieza permite ubicarla en su época con el error esperado.

## Decisiones (aprobado 2026-10-06)
- **Diferencias entre culturas solo desde su historia y geografía,** sin mínimo forzado (§6).
- **Costumbres propias sin lista:** se notan en la narración y las reacciones; los estereotipos, en un comando fuera del personaje (§12).
- **El jugador puede cambiar la cultura de un lugar** con las palancas de cualquiera, lento y con resistencia (§12).
- **Funerales y alma según la ley del mundo;** en xianxia el rito ayuda un poco a cruzar (§9).

## Decisiones tomadas en este borrador (revisables)

- **Rasgos en las personas y prevalencias en comunidades;** `Culture` es un agregado con nombre.
- **Catálogo de rasgos en `content/`** con variantes y parámetros; la historia elige variantes con causa.
- **Por fuera y por dentro** como dos ejes de cada rasgo.
- **Identidad como creencia** con marcas perceptibles.

## Preguntas abiertas

- Calibración: velocidad de deriva por dominio; peso de los sesgos de copia; generaciones típicas de asimilación; frecuencia de modas en ciudades; cuántos rasgos por cultura hacen falta para que se sientan distintas.
