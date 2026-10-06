# Tecnología mortal

> Estado: **borrador de diseño**. Lo que los mortales saben hacer y cómo cambia: procesos que la ley del mundo permite (no un árbol tecnológico), saber cómo hacerlos (en personas y soportes) vs adoptarlos (una decisión con utilidad), prerrequisitos físicos (temperaturas, materiales, conceptos) y no de menú, dominios (agricultura, ganadería, metalurgia, cerámica, textiles, construcción, energía, transporte, escritura, imprenta, medición, química, medicina, guerra), infraestructura como saber hecho cosa, difusión por contacto, comercio, migración, conquista y libros, secretos y monopolios, pérdida y regresión, la relación con el cultivo (sectas que no necesitan innovar, o que reprimen, e híbridos de qi y técnica), y lo que la tecnología cambia en la sociedad y el ambiente.

Depende de: [discovery.md](discovery.md) (la tecnología se descubre con el mismo mecanismo: hipótesis, experimentos, errores con forma, descubrimiento múltiple, pérdida), [crafts.md](crafts.md) (cada proceso es una sesión por pasos que resuelve la ley; metalurgia mortal, oficios mortales, recetas con defectos), [economy.md](economy.md) (producción, hogares, inversión, gremios, monopolios, precios), [information.md](information.md) (difusión como creencia, medios, alfabetización, secretos), [living-world.md](living-world.md) (el conocimiento es físico, culturas por geografía, rutas), [planet-gen.md](planet-gen.md) (suelos, minerales, agua, clima: lo que hay cerca), [metaphysics.md](metaphysics.md) (qué procesos permite cada mundo), [elements.md](elements.md) (física de fuego, agua, metal; interacción con el qi), [causality.md](causality.md) (nada sin causa, conservación, presiones), [organizations.md](organizations.md) (gremios, talleres, sectas que guardan y reprimen), [state.md](state.md) (obras públicas, difusión por edicto, monopolios de estado), [social-structure.md](social-structure.md) (quién trabaja, qué oficios dan estatus), [body-health.md](body-health.md) (medicina mortal, nutrición, enfermedades por oficio), [deep-history.md](deep-history.md) (técnicas perdidas, ruinas que nadie sabe reconstruir). Lo usan: [economy.md](economy.md) (rendimientos de la agricultura, metal por cultura), [crafts.md](crafts.md) (procesos mortales que se descubren y difunden), [discovery.md](discovery.md) (catálogo de procesos mortales), [state.md](state.md) (obras públicas, difusión por edicto), [war.md](war.md) (armas, fortificación, pólvora si el mundo la permite), [information.md](information.md) (escritura, papel, imprenta), [divination.md](divination.md) (calendarios, astronomía), y el futuro crónica (historiografía y archivos).

## Principios
1. **No hay árbol tecnológico.** Hay **procesos que la ley del mundo permite**: fundir cobre a tal temperatura, alear con estaño, hacer papel con fibras maceradas. Un proceso se puede hacer cuando existen los materiales, la energía y los conceptos que pide, no cuando se "investigó" lo anterior en un menú. Las secuencias históricas salen de la física y de la geografía, y por eso varían entre culturas y entre seeds.
2. **Saber no es usar.** Que alguien sepa hacer algo no cambia nada hasta que alguien decide **adoptarlo**: un campesino pobre no cambia de arado si no puede pagarlo, si no confía en él o si su aldea lo ve mal. La adopción es una decisión de utilidad de hogares y organizaciones, con costo, riesgo y normas.
3. **El saber vive en personas y soportes.** Una técnica existe en la memoria y las manos de quien la practica, en manuales, en aprendices, en las cosas construidas. Si todos los que la saben mueren y no queda soporte legible, se pierde (living-world §7). Las ruinas pueden guardar cosas que nadie sabe volver a hacer.
4. **Difundir es transmitir información.** Las innovaciones viajan por los mismos canales que los rumores (information): contacto, comercio, migración, conquista, artesanos cautivos, libros, edictos. Se deforman, se copian mal, se mezclan con mitos, y se encuentran con resistencias.
5. **La geografía decide mucho.** Una cultura sin estaño no hace bronce; sin bosques no tiene carbón de leña; sin ríos no tiene molinos de agua. Lo que hay cerca (planet-gen) marca qué se descubre primero y qué nunca.
6. **Las leyes del mundo mandan.** Cada mundo (metaphysics) tiene su química y su física: en uno la pólvora detona, en otro el qi del aire la vuelve inestable o inútil; un metal puede no existir; un mineral espiritual puede reemplazar al hierro. Las recetas del mundo real no valen por sí solas: valen las del mundo.
7. **El cultivo deforma la tecnología.** Donde un cultivador hace en un día lo que mil obreros en un año, los mortales tienen menos incentivo para inventar y los poderosos pueden reprimir lo que los amenaza; a la vez, aparecen híbridos (granos espirituales, formaciones de riego, talismanes de taller). Cuánto pesa cada fuerza depende del mundo.
8. **Todo tiene consecuencias.** Más comida es más gente; el hierro barato arma levas; la imprenta multiplica herejías y aspirantes a examen; el carbón de leña tala montes; el riego saliniza suelos. La tecnología cambia las presiones del mundo, y esas presiones se descargan.
9. **Determinista.** `rng.fork("tech", processId, agentId, eventId)` para experimentos e invención individual; `rng.fork("diffusion", processId, cellId, period)` para difusión y adopción en agregado.

## 1. Procesos

Un **proceso** es una forma de transformar el mundo que la ley permite y que alguien puede aprender. Es contenido del mundo (en `content/`, por familia de mundo, con variantes por seed), no una entrada de menú.

```ts
interface ProcessDef {
  id: ProcessId;
  domain: TechDomain;                        // agricultura, metalurgia, escritura... (§3)
  requires: {
    materials: MaterialReq[];                // cobre y estaño, arcilla con tal composición, fibras, salitre
    energy?: { kind: EnergyKind; temperature?: number; power?: number };  // un horno que llegue a 1100°, un molino
    concepts: ConceptId[];                   // ideas previas: la rueda, la palanca, la fermentación, el número posicional
    tools: ProcessId[];                      // herramientas que a su vez son productos de otros procesos
    scale?: number;                          // personas o capital mínimo para que funcione (un alto horno no lo opera una familia)
  };
  steps: CraftStepTemplate[];                // se resuelve como una sesión de crafts (§1 de crafts): pasos, habilidad, defectos
  outputs: OutputDef[];                      // lo que produce, con calidad que depende de la ejecución
  effects: TechEffect[];                     // cómo cambia la producción, el transporte, la información (§4)
  worldLaw: LawConditionId[];                // condiciones de la metafísica del mundo; si no se cumplen, el proceso no existe
  sideEffects: SideEffectDef[];              // humo tóxico, suelos agotados, enfermedades del oficio (§9)
}

type TechDomain =
  | "agriculture" | "husbandry" | "food" | "metallurgy" | "ceramics_glass" | "textiles" | "construction"
  | "hydraulics" | "energy" | "transport" | "navigation" | "writing" | "printing" | "measurement"
  | "chemistry" | "medicine" | "military" | "custom";
```

- **Prerrequisitos físicos, no de menú.** El bronce pide cobre, estaño (o arsénico) y un horno que funda; el hierro de forja pide una temperatura que deja de ser rara cuando se inventa el fuelle; el papel pide fibras, agua y la idea de macerar. Si los requisitos están, el proceso **es posible**; si alguien lo descubre es otra cosa (discovery).
- **Conceptos.** Algunas cosas se apoyan en ideas más que en materiales: la rueda, la palanca, la fermentación controlada, la numeración posicional, la escritura fonética. Un concepto se descubre una vez en una cultura y habilita muchos procesos.
- **Variantes por mundo.** Las proporciones, temperaturas y materiales del catálogo pueden variar con el seed dentro de lo que la metafísica permite. Lo que funciona en un mundo puede fallar en otro, y así el saber del mundo real del jugador no es una guía segura (Decisiones).
- **Procesos espirituales** (alquimia, forja de artefactos, formaciones, talismanes) son los de crafts. Este doc cubre los mortales y los híbridos (§7).

## 2. Saber y adoptar

### Saber cómo
```ts
interface ProcessKnowledge {
  holder: PersonId;
  process: ProcessId;
  fidelity: number;                          // cuánto de la receta real conoce; la parte que falta o está errada produce defectos (discovery §5)
  skill: number;                             // práctica: control, sentidos, juicio (crafts §1)
  source: EventId;                           // la invención, el aprendizaje con un maestro, el manual leído, el espionaje
  secret: boolean;                           // si lo guarda (§6)
}

interface PopulationTech {                   // en agregado, por asentamiento o celda
  process: ProcessId;
  knownBy: number;                           // fracción de la población (o de los hogares del oficio) que lo sabe hacer
  adoptedBy: number;                         // fracción que lo usa
  meanFidelity: number;
  meanSkill: number;
  carriers: SupportId[];                     // manuales, inscripciones, talleres, cosas construidas que lo encarnan
  arrivedEventId: EventId;                   // cuándo y cómo llegó (invención local, comerciante, conquista)
}
```

- **Saber hacer se aprende haciendo.** Leer un manual da `fidelity` pero poco `skill`; el aprendizaje con un maestro da los dos, despacio. Los oficios con mucho saber tácito (forja, cerámica fina, vidrio) se difunden casi solo con personas.
- **Copias con errores.** Cada transmisión puede bajar la fidelidad (information §3): un paso omitido, una proporción mal leída. Los defectos de un proceso se heredan y a veces se vuelven "la forma de hacerlo" de una región.

### Adoptar
La adopción es una decisión de utilidad (npc-psychology, economy) de un hogar, un taller, un señor o un estado:
- **Costo:** herramientas nuevas, animales, capital, tiempo para aprender, producción perdida mientras se aprende.
- **Ganancia esperada:** lo que el que decide **cree** que va a rendir (no lo que rinde): depende de lo que vio en el vecino, de quién se lo cuenta y de su aversión al riesgo. Un campesino al borde del hambre no arriesga la cosecha con un método nuevo.
- **Complementos:** un arado pesado necesita bueyes; un molino necesita un río y alguien que lo mantenga; la imprenta necesita papel barato y lectores.
- **Escala:** algunos procesos solo convienen con mucha producción (un alto horno, una flota mercante): los adopta quien tiene capital u organización.
- **Normas y estatus:** "eso no lo hacen los nuestros", un tabú religioso, un gremio que prohíbe, un oficio que da mala reputación (social-structure). Las normas cambian despacio y a veces se rompen de golpe.
- **Imitación:** cuando suficientes vecinos adoptan y se ve que funciona, la creencia de ganancia sube y la adopción se acelera (la curva en S sale de esto, no se programa).

## 3. Dominios

| Dominio | Ejemplos de procesos | Qué cambia |
|---|---|---|
| **Agricultura** | Azada, arado de madera y de hierro, arado de vertedera, riego por canales y norias, terrazas, rotación, barbecho, abono, selección de semillas, cultivos nuevos traídos de lejos | Rendimiento por superficie y por trabajador, qué tierras se pueden cultivar, cuánta gente sostiene una celda (economy §3) |
| **Ganadería** | Domesticación, cría selectiva, collera y yugo, herraduras, ordeñe, lana | Fuerza de tiro, transporte, abono, guerra montada, enfermedades compartidas con animales (body-health) |
| **Alimentos** | Fermentación, salazón, ahumado, molienda, conservas, destilación | Almacenamiento (resistencia a hambrunas), comercio de largo alcance, raciones de guerra |
| **Metalurgia** | Cobre nativo, fundición, bronce, hierro de forja, acero por cementación, crisol, temple, alto horno, fundición de hierro | Herramientas, armas, dinero de metal (economy §11), dependencia de minas y carbón |
| **Cerámica y vidrio** | Alfarería, torno, hornos de alta temperatura, vidriado, porcelana, vidrio | Almacenar, cocinar, comerciar bienes de lujo, lentes |
| **Textiles** | Hilado, telar, tintes, seda, algodón | Vestido, comercio, trabajo de hogares, secretos célebres (la seda) |
| **Construcción** | Adobe, piedra tallada, arco, bóveda, morteros y cementos, puentes, cúpulas | Ciudades, murallas, templos, obras públicas (state §11) |
| **Hidráulica** | Pozos, canales, diques, esclusas, acueductos, cisternas | Agricultura de regadío, ciudades grandes, inundaciones con causa humana |
| **Energía** | Músculo humano y animal, molino de agua, molino de viento, carbón de leña, carbón mineral | Qué trabajo se puede mecanizar; tala y minería |
| **Transporte** | Rueda, carro, caminos, barcos de remo y de vela, timón, puertos | Costo de mover bienes (economy §7, war §3), alcance del estado (state §2) |
| **Navegación** | Pilotaje costero, estrellas, brújula si el mundo la permite, cartas náuticas | Rutas oceánicas, mapas (information §5) |
| **Escritura** | Marcas de conteo, pictogramas, logogramas, silabarios, alfabetos; soportes (arcilla, bambú, seda, papiro, papel) | Registros (state §3), leyes escritas (law), contratos, técnicas en manuales, memoria larga |
| **Imprenta** | Sellos, xilografía, tipos móviles | Costo de copiar (§5), difusión de ideas, alfabetización, exámenes masivos, herejías |
| **Medición** | Calendarios, pesos y medidas, ábaco, contabilidad, agrimensura, astronomía | Comercio honesto o estafa, catastros, predicción de estaciones (living-world §5) |
| **Química** | Tintes, jabón, curtido, salitre, ácidos; pólvora solo si la ley del mundo la permite | Oficios, armas, medicina |
| **Medicina mortal** | Herbolaria, cirugía, vendajes, cuarentena, inoculación si se descubre | Mortalidad, epidemias (body-health) |
| **Militar** | Armas y armaduras de cada metal, arco compuesto, ballesta, estribo, máquinas de asedio, fortificación | Quién puede pelear y cuánto cuesta (war §2, §9) |

La lista es abierta: el catálogo vive en `content/` y crece por familia de mundo.

## 4. Efectos sobre el mundo

Los efectos **no son bonos fijos**: cambian los parámetros de los sistemas que ya existen.

```ts
type TechEffect =
  | { kind: "yield"; crop: CropId; soilFactor: Fn; laborFactor: Fn }      // agricultura: el rendimiento real depende del suelo y el clima
  | { kind: "arable"; terrain: TerrainKind }                               // terrazas, drenaje, riego abren tierras nuevas
  | { kind: "transport_cost"; mode: TransportMode; factor: number }
  | { kind: "storage"; good: GoodKind; spoilage: number }
  | { kind: "copy_cost"; medium: MediumKind; factor: number }              // escritura, papel, imprenta
  | { kind: "energy"; source: EnergyKind; output: number }
  | { kind: "material"; produces: MaterialId; quality: Fn }
  | { kind: "craft_unlock"; process: ProcessId }                            // habilita otros procesos
  | { kind: "custom"; system: SystemId; param: string; fn: Fn };
```

- **Agricultura → demografía.** Más rendimiento sostiene más gente por celda; la población crece hasta que la tierra vuelve a apretar. La tecnología no saca a nadie del hambre para siempre: corre la frontera.
- **Transporte → mercados y estados.** Bajar el costo de mover bienes integra mercados (los precios de lejos se acercan), alarga el alcance del estado y cambia dónde se puede hacer la guerra.
- **Escritura e imprenta → información.** Cada medio nuevo baja el costo de copiar y sube la fidelidad de lo que viaja (information §4, §6): más registros, más leyes escritas, más manuales, más rumores impresos, más herejías.
- **Metal → poder.** El hierro barato arma a muchos; el bronce caro arma a pocos (war §2, social-structure). Cambiar de metal puede cambiar quién manda.

## 5. Escritura, papel e imprenta

Merecen sección propia porque mueven el sistema de información entero.
- **Sistemas de escritura:** cada cultura tiene uno (o ninguno) con su costo de aprendizaje: miles de logogramas exigen años (y hacen de la alfabetización un privilegio y un examen), un alfabeto se aprende en meses. El sistema decide cuánta gente puede leer (information §6).
- **Soportes:** arcilla, madera, bambú, seda, papiro, pergamino, papel, tablillas de jade para cultivadores. Cada uno tiene costo, peso y duración (living-world §7). El papel barato multiplica todo lo escrito.
- **Copiar:** a mano, cada copia cuesta trabajo de escriba y mete errores (information §3). Con xilografía, el costo baja para tiradas grandes de un mismo texto; con tipos móviles, baja para muchos textos distintos (si el sistema de escritura tiene pocos signos, mucho más).
- **Consecuencias:** textos canónicos fijos (y discusiones sobre ediciones), calendarios y almanaques en cada casa, manuales de oficio y de cultivo básico circulando (las sectas lo odian: §7), propaganda del estado, panfletos, exámenes con más candidatos que puestos, lenguas que se estandarizan.

## 6. Difusión, secretos y monopolios

- **Por dónde viaja:** comerciantes que ven algo y lo cuentan (saber que, poca fidelidad); artesanos que migran o son llevados (saber cómo, alta fidelidad); libros y manuales; aprendices que vuelven a casa; conquistadores que imponen sus métodos o se llevan a los artesanos del vencido; edictos de estado que mandan adoptar (state §11); sectas y templos que enseñan.
- **Ver no es saber hacer.** Comprar una espada de acero no enseña a hacer acero: se puede estudiar (experimentar sobre el producto: discovery §4), y a veces deducir el proceso, a veces no. Por eso el secreto de un oficio puede durar siglos.
- **Secretos:** gremios, familias y estados guardan procesos (information §7). Un secreto de oficio vale mientras pocos lo saben; robarlo es espionaje, sobornar a un artesano o capturarlo. La seda sacada de contrabando en bastones huecos es una historia que el sistema tiene que poder producir.
- **Monopolios:** el estado puede reservarse la sal, el hierro, la moneda o el papel (economy §10, state §4); un gremio puede limitar quién aprende. Los monopolios frenan la difusión dentro y aceleran el contrabando de saber hacia afuera.
- **Resistencias:** campesinos que no confían, gremios que pierden con el cambio, sacerdotes que lo llaman impío, sectas que lo prohíben. Toda resistencia es una creencia o un interés de personas concretas.
- **Frentes de difusión:** en agregado, un proceso avanza por las rutas como un frente de noticias (information §4) con velocidad según contacto, comercio y fricción cultural; las montañas y los mares frenan, las capitales aceleran.

## 7. Tecnología y cultivo

- **Desplazamiento:** si una secta riega los campos con una formación, nadie construye canales. Si un cultivador corta piedra con la mano, nadie inventa la sierra hidráulica. En mundos con muchos cultivadores, la tecnología mortal puede estancarse durante milenios, no por falta de ingenio sino porque no conviene.
- **Represión:** lo que les quita ventaja a los poderosos puede ser prohibido o destruido: armas que hieren cultivadores, imprentas que copian manuales de cultivo, astronomía que contradice la doctrina de una secta. Es una decisión de organizaciones con su costo y su karma (heaven-karma), no una regla del mundo.
- **Híbridos:** granos espirituales que crecen con qi, bestias menores de tiro, molinos movidos por una vena, talismanes de taller producidos en serie por cultivadores de reino bajo, hornos que usan fuego espiritual, cosechas protegidas por formaciones. Son procesos con requisitos de los dos mundos y cambian economías enteras.
- **Mortales que miran:** el saber de los cultivadores (alquimia, formaciones) se filtra en versiones mortales: herbolaria que viene de la alquimia, geomancia que viene de las formaciones, artes marciales que vienen de técnicas. Con errores y con mitos.
- **Mundos sin cultivo fuerte:** donde el poder sobrenatural es raro o débil, la tecnología mortal pesa más y puede llegar más lejos. Hasta dónde llega (pólvora, imprenta, relojes, ¿más?) es una pregunta de cada mundo y de su historia.

## 8. Pérdida y regresión

- **Cadenas de oficio:** un proceso complejo depende de muchos otros (el acero necesita carbón, fuelles, minas, comercio de estaño o de aditivos, demanda). Cuando una guerra, una plaga o un colapso (state §13) rompe la cadena, los artesanos dejan de practicar y el saber se pierde en una o dos generaciones.
- **Población mínima:** los oficios especializados necesitan suficiente gente para sostener especialistas. Una población que se achica (aislada en una isla, diezmada por una plaga) pierde procesos aunque nadie lo decida.
- **Ruinas que nadie entiende:** acueductos, cúpulas, cementos, mapas: lo construido sobrevive al saber. Una cultura puede vivir entre obras que no sabe hacer y atribuirlas a gigantes o inmortales (living-world §4, deep-history).
- **Redescubrir:** lo perdido se vuelve a descubrir (discovery §11) o se recupera estudiando una ruina o un manual encontrado. La historia tecnológica de un mundo no es una línea que sube.

## 9. Consecuencias y ambiente

- **Recursos:** el carbón de leña tala montes enteros; la minería agota vetas y envenena ríos; el riego mal drenado saliniza; el pastoreo intensivo erosiona. Todo eso es estado del mundo (planet-gen, living-world §1) y produce desastres con causa: deslaves, sequías locales, sedimentación de puertos.
- **Enfermedades del oficio:** mineros con pulmones rotos, tintoreros envenenados, herreros sordos, alfareros con plomo (body-health).
- **Sociales:** los oficios nuevos crean grupos nuevos (fundidores, impresores, mercaderes de papel), destruyen otros (copistas), mueven el estatus (social-structure) y la riqueza (economy). Las innovaciones que ahorran trabajo pueden dejar gente sin sustento y producir revueltas.
- **Políticas:** el estado que domina una tecnología (hierro, canales, imprenta) gana alcance y fuerza; el que la pierde, se debilita. Las innovaciones militares cambian equilibrios entre vecinos (war).

## 10. El jugador y el narrador
- **El jugador sabe lo que sabe su personaje.** Su `ProcessKnowledge` es la de alguien de su mundo, su cultura y su oficio. Puede aprender, robar, comprar o inventar procesos con el mecanismo de discovery: hipótesis, materiales, experimentos, fallas.
- **El saber del autor no es del personaje.** El jugador humano sabe cosas del mundo real; puede proponer una hipótesis ("mezclo salitre, azufre y carbón"), y el personaje puede intentarla como experimento si tiene los materiales y una razón plausible de pensarla. El resultado lo decide la ley **de este mundo** (que puede tener otra química), la ejecución sale de la habilidad del personaje, y lograr algo útil pide pruebas, tiempo y errores. Nunca hay atajos: el LLM no "sabe" que funciona ni da recetas ganadoras (Decisiones).
- **Introducir una innovación es jugar con todo el mundo:** convencer a otros (información, reputación), encontrar materiales, entrenar aprendices, enfrentar gremios y sectas, protegerla o venderla, y vivir sus consecuencias.
- **El narrador** describe la tecnología como la ve el personaje: el molino que nunca vio, el libro impreso que le parece brujería, el acero de otra ciudad. Nunca nombra procesos o explicaciones que el personaje no conoce.

## 11. Escala (LOD)
- **Tier 0 (historia agregada):** `PopulationTech` por cultura o región: fracciones que saben y adoptan, fidelidad media, invención como proceso de riesgo sobre las presiones (necesidad, materiales, contacto, población, cultura epistémica: discovery §13), difusión como frentes por rutas, pérdida cuando cae la población o se rompen cadenas.
- **Tier 1-2:** asentamientos con talleres, maestros y aprendices concretos; adopción por hogares como decisión agregada por tipo de hogar.
- **Tier 3-4:** el inventor, el artesano y el campesino cerca del jugador como personas con su `ProcessKnowledge`, sus experimentos y sus decisiones.
- **Materialización:** un artesano que aparece toma de la distribución de su asentamiento lo que sabe, con qué fidelidad y de quién lo aprendió.

## Implementación
- **Fase 3:** catálogo inicial de procesos mortales en `content/` (agricultura, alimentos, metalurgia básica, cerámica, textiles, escritura) con requisitos y efectos sobre producción; `ProcessKnowledge` por persona; aprendizaje con maestro.
- **Fase 5:** `PopulationTech` por asentamiento, adopción por hogares con utilidad sobre creencias, difusión por rutas y comerciantes.
- **Fase 7:** invención y pérdida en la historia agregada; tecnología distinta por cultura según geografía; ruinas con procesos perdidos; desplazamiento por cultivo según la era.
- **Fase 8:** imprenta y su efecto en información y exámenes; secretos de oficio y espionaje; monopolios; represión de sectas; híbridos qi–técnica; consecuencias ambientales.

## Tests
- **Geografía:** en una corrida headless, una cultura sin estaño accesible no produce bronce mientras no comercie con quien lo tiene.
- **Saber ≠ adoptar:** un proceso conocido en una aldea pobre con hogares al borde del hambre se adopta más despacio que en una aldea con reservas.
- **Curva en S:** la adopción de un proceso rentable sigue una curva acelerada por imitación sin que haya una curva programada.
- **Pérdida:** una población aislada que cae por debajo de cierto tamaño pierde procesos complejos y conserva los simples.
- **Ley del mundo:** un proceso con `worldLaw` no cumplido no produce su resultado aunque se ejecute bien.
- **Imprenta:** la fidelidad media de un texto difundido es mayor y su alcance más rápido con imprenta que con copia a mano.
- **Desplazamiento:** con todo igual, una región con mucho riego por formaciones de secta construye menos canales.
- **Conservación:** los procesos consumen sus materiales y su energía; nada se produce sin insumos.
- **Determinismo:** mismo seed, mismas acciones → mismas invenciones, difusiones y pérdidas.

## Decisiones tomadas en este borrador (revisables)
- No hay árbol tecnológico: hay procesos con prerrequisitos físicos y conceptuales, y lo posible depende de la geografía y la ley del mundo.
- Saber y adoptar son cosas distintas; la adopción es una decisión de utilidad sobre creencias.
- La tecnología usa el mismo mecanismo de descubrimiento que la ley espiritual (discovery), con catálogo de procesos mortales.
- El catálogo de procesos varía por seed dentro de lo que permite la metafísica, así que el saber del mundo real no es una receta segura.
- El jugador puede proponer hipótesis que vienen de su propio saber, pero el personaje las prueba como experimentos y el resultado lo decide la ley del mundo.
- Los efectos de la tecnología cambian parámetros de sistemas existentes (producción, transporte, información), no dan bonos.

## Preguntas abiertas
- Calibración: tasas de invención según población, contacto, necesidad y cultura epistémica.
- Calibración: velocidad de difusión por ruta y fricción cultural; umbral de imitación en la adopción.
- Calibración: población mínima para sostener oficios por complejidad.
- Calibración: cuánto frena el cultivo a la tecnología mortal según la densidad de cultivadores (que haya mundos estancados y mundos que avanzan).
- Calibración: variación de recetas por seed (cuánto se parecen al mundo real).
