# Familia y linaje

> Estado: **borrador de diseño**. De dónde sale cada persona y a quién pertenece: genoma y herencia de rasgos (también del talento de cultivo), deseo y sexualidad, concepción, embarazo y parto, fertilidad baja en cultivadores, parentesco como verdad y como creencia (paternidad dudosa, hijos ilegítimos, adopción), matrimonio y sus formas, el hogar y la crianza, herencia de bienes, puestos, deudas y técnicas, cultivo dual, clanes y genealogías, linajes de sangre que se diluyen y despiertan.

Depende de: [causality.md](causality.md) (todo ser nace de padres concretos; la población cambia solo por nacimientos, muertes y migraciones), [body-health.md](body-health.md) (genoma, embarazo y parto, enfermedades hereditarias, envejecimiento, nutrición), [npc-psychology.md](npc-psychology.md) (herencia del temperamento, lo adquirido por la crianza, relaciones, `attraction`, celos, cara colectiva, rencor entre generaciones, anclas de los longevos), [cultivation.md](cultivation.md) (aptitud y raíces espirituales, constituciones, rasgos latentes, cultivo dual, longevidad), [elements.md](elements.md) (afinidades, polaridad yin–yang), [contracts.md](contracts.md) (matrimonio, esponsales, adopción y deber filial como compromisos; herencia de deudas), [economy.md](economy.md) (el hogar como unidad, dote, tierra, herencia de riqueza), [organizations.md](organizations.md) (clanes, ingreso por nacimiento y matrimonio, sucesión, matrimonios de alianza), [information.md](information.md) (secretos, rumores, genealogías y testamentos como documentos), [perception.md](perception.md) (parecido físico, identificar personas, leer la sangre), [spirits.md](spirits.md) (el alma llega con la concepción, ancestros y ofrendas), [heaven-karma.md](heaven-karma.md) (karma de parentesco, deudas que pasan al linaje), [deep-history.md](deep-history.md) (linajes como legados entre épocas), [metaphysics.md](metaphysics.md) (especies, linajes como forma de acceso al poder). Lo usan: [organizations.md](organizations.md) (genealogía de clanes, sucesión hereditaria), [economy.md](economy.md) (herencia), [cultivation.md](cultivation.md) (talento heredado), [body-health.md](body-health.md) (enfermedades hereditarias), [social-structure.md](social-structure.md) (castas por nacimiento, hijos de concubinas y sirvientes), [law.md](law.md) (herencia, adulterio, incesto como crimen), [state.md](state.md) (dinastías, crisis de sucesión), [divination.md](divination.md) (leer el destino de un linaje), y [chronicle.md](chronicle.md) (descendencia en el epílogo).

## Principios
1. **Nadie aparece: todos nacen.** Toda persona (y toda bestia que se reproduce) tiene un evento de nacimiento con dos padres biológicos concretos, una concepción y un parto. Las excepciones (espíritus de lugar, seres creados por un poder, condiciones iniciales del seed) tienen su propio `originEventId`. La población cambia solo por nacimientos, muertes y migraciones (causality, Ley 2).
2. **La sangre es verdad; el parentesco es creencia.** Quién es hijo biológico de quién está en `WorldTruth`. Quién es hijo de quién **para la familia, el clan y la ley** es una creencia social que puede no coincidir: hijos de otro criados como propios, bastardos reconocidos, adoptados, impostores que reclaman un linaje.
3. **La herencia biológica es estadística con seed.** El genoma del hijo sale de los de los padres con `rng.fork("genetics", childId)`: los hijos se parecen a los padres en promedio, con varianza real. Un genio puede nacer de dos mediocres, y dos genios pueden tener un hijo común.
4. **La herencia social la decide la cultura.** Qué se hereda (tierra, puesto, nombre, deudas, enemigos, técnicas) y quién lo hereda (el primogénito, todos los hijos, el clan, el discípulo) son normas culturales en `content/`. Las disputas salen de que las normas son ambiguas y las creencias distintas.
5. **El deseo es psicología; la familia es una institución.** Quién atrae a quién sale del temperamento, la historia y la cultura; con quién se casa uno lo deciden muchas veces otros. La distancia entre las dos cosas es una fuente enorme de drama (amor contra deber, adulterio, fugas).
6. **Conservación.** La dote es plata que sale de una familia y entra en otra; la herencia reparte bienes que existen; el feto se nutre de lo que come la madre (y de su esencia, si cultiva). Nada se crea por casarse ni por nacer.
7. **El narrador no es explícito.** Lo íntimo existe en la simulación como eventos con consecuencias (concepción, celos, escándalo, vínculo kármico); la narración lo cuenta con elipsis, como hace cultivation con el cultivo dual.
8. **Determinista.** Genética, concepción y parto usan sub-streams del RNG con el id de los involucrados; nada más es azar.

## 1. Genoma

```ts
interface Genome {
  id: GenomeId;
  species: SpeciesId;
  additive: Record<TraitKey, number>;     // rasgos poligénicos: ejes de temperamento, aptitudes, talla, constitución, aptitud de cultivo
  loci: Record<LocusId, [AlleleId, AlleleId]>;   // genes discretos: enfermedades recesivas, color de ojos, rasgos raros
  bloodlines: Array<{ line: BloodlineId; share: number; awakened: boolean }>;  // sangre de un ancestro, de bestia, de dragón (§9)
  mutations: Array<{ locus: LocusId | TraitKey; eventId: EventId }>;            // nuevas en este individuo
  parents: [GenomeId, GenomeId] | null;   // null solo en condiciones iniciales del seed
  originEventId: EventId;                 // la concepción
}
```

- **Rasgos poligénicos** (`additive`): valor del hijo = promedio de los padres + varianza de segregación, con una **heredabilidad** por rasgo (`content/`): ~0.5 para temperamento (npc-psychology §1), más alta para talla y constitución, más baja para la aptitud de cultivo (§4). El resto lo pone el ambiente (nutrición, crianza, qi del lugar).
- **Genes discretos** (`loci`): dos alelos, dominancia simple. Sirven para enfermedades hereditarias (body-health §6), rasgos visibles que ayudan a reconocer parientes (perception §7) y rasgos raros. Los recesivos dañinos se concentran con la **consanguinidad** (§9).
- **Mutaciones:** raras, con `rng.fork("genetics", childId)`; más frecuentes cerca de qi caótico, zonas malditas o padres con esencia desordenada (elements §4: tensión). Algunas son las raíces mutadas de cultivation y elements §5.
- **Lo que no está en el genoma:** lo adquirido (esquemas, valores, hábitos, habilidades), las heridas, el cultivo alcanzado. Un cultivador de Alma Naciente no transmite su reino; transmite su genoma, y su esencia puede marcar el embarazo (§3).
- **El genoma es verdad oculta.** Nadie lo lee. Se ve en el cuerpo (perception), se mide con instrumentos que tienen error (piedras de prueba: cultivation §3) y se infiere del parecido.

## 2. Deseo, atracción y sexualidad
- **Orientación y deseo** son rasgos innatos con distribución generada por especie (no un binario fijo), más lo que la historia y la cultura moldean. `attraction` es una dimensión de la relación (npc-psychology §6) que sube con lo que a cada uno le atrae (rasgos físicos, estatus, fuerza, carácter, familiaridad) y con la interacción.
- **Normas culturales sobre el deseo** (`content/`): qué uniones son aceptables (entre clases, entre sectas, del mismo sexo, antes del matrimonio, con viudas), qué es tabú (incesto en grados que cada cultura define), qué es escándalo y qué se tolera en silencio. Romper una norma no es imposible: es caro (cara, reputación, castigo) y se esconde (information §7: secretos).
- **Relaciones fuera del matrimonio:** amantes, concubinas (cuando son institución, §6), prostitución (un servicio con precio: economy), romances prohibidos entre sectas rivales. Generan celos (`jealousy`), secretos, chantaje e intrigas (schemes: rival afectivo).
- **Violencia sexual** existe en el mundo como crimen con consecuencias reales (trauma en npc-psychology, vendetta, ley, karma) y se registra como evento. La cometen NPCs, y **también puede cometerla el personaje del jugador si el jugador lo escribe**: el juego no ofrece menús de opciones, así que nunca aparece como sugerencia, pero el intérprete no la bloquea. Se resuelve como cualquier acción (resistencia, testigos, fuerza relativa) y **nunca se narra de forma explícita**: el narrador cuenta el hecho con elipsis y se queda en lo que deja (§13). **Límite duro:** si la víctima es menor según su especie, el intérprete rechaza la intención y la acción no ocurre.
- **Decidir una unión** es una acción con utilidad: atracción, afecto, necesidad social, objetivos (un hijo, una alianza, un ascenso), riesgo creído (escándalo, castigo, embarazo) y valores.

## 3. Concepción, embarazo y parto

```ts
interface Conception {
  id: EventId;
  mother: AgentId; father: AgentId;
  union: EventId;                         // la unión que la causó (matrimonio, amantes, violencia, cultivo dual)
  probability: number;                    // la que tenía (registrada para el inspector)
  genome: GenomeId;                       // el genoma resultante
  soul?: SoulId;                          // el alma que llegó desde las Fuentes (spirits §3b)
  twins?: GenomeId[];
}
```

- **Probabilidad de concepción** por unión: `f(fertilidad de los dos, día del ciclo, salud, nutrición, edad, compatibilidad de esencia, anticonceptivos)`. La fertilidad cae con la edad, el hambre (body-health §5), la enfermedad y ciertas sustancias; en cultivadores, con la distancia de reino (§4).
- **Anticoncepción y aborto** existen como saber (hierbas, técnicas, métodos populares), con eficacia real (la ley) y creída (discovery: supersticiones). Muchos métodos populares no funcionan; algunos envenenan.
- **El alma llega con la concepción.** Las almas en las Fuentes esperan un cuerpo concebido (spirits, decisión 2026-10-05); las fuertes eligen (linaje, afinidad, cercanía a lo que las ata). Por eso en un clan con una sangre fuerte pueden renacer almas fuertes, y un alma vieja puede buscar a su propio linaje.
- **Embarazo y parto** son estados del cuerpo con riesgo (body-health §6): hemorragia, fiebre puerperal, mala posición, muerte de la madre o del niño, abortos espontáneos. Dependen de nutrición, edad, partera, medicina disponible y, en cultivadoras, de su esencia.
- **El feto se nutre de la madre.** Con comida (conservación de la nutrición) y, si la madre cultiva, con su esencia: un embarazo le cuesta a una cultivadora esencia real y tiempo de cultivo (no puede romper umbrales sin riesgo para el feto). Un vientre rico en esencia y un lugar con qi alto mejoran el ambiente prenatal (§4). Los padres que gastan tesoros en el embarazo están invirtiendo en el talento del hijo, con efecto real pero acotado.
- **Nacer es el evento más importante de la vida.** Es el `originEventId` del cuerpo, del temperamento, de la aptitud y del parentesco. Registra lugar, asistentes y circunstancias (un parto en una noche de tribulación, en una aldea sitiada): todo eso puede alimentar creencias ("nació bajo una estrella mala") que el mundo trata como verdad social.

## 4. Talento heredado y fertilidad de los cultivadores

### Talento
- La **aptitud de cultivo** (cultivation §3: raíces, `meridianBase`, `comprehension`, `soulBase`, constitución) sale del genoma con heredabilidad **baja-media**: hijos de cultivadores tienen más chances de raíces, pero no muchas más. El ambiente prenatal y de la primera infancia (esencia de la madre, qi del lugar, tesoros) suma; la sangre despierta (§9) puede sumar mucho.
- **Las raíces se heredan por elemento:** la afinidad a cada elemento es un rasgo aditivo; la pureza (`rootQuality`) sale de cuántos elementos superan el umbral (muchos elementos medianos = raíz mezclada).
- **Constituciones especiales** son combinaciones raras de rasgos o loci recesivos: aparecen más en linajes cerrados (a costa de enfermedades) y a veces en hijos de dos linajes lejanos.
- **Consecuencia social:** las sectas compran, adoptan y casan talento; los clanes cultivadores son más grandes en ambición que en número; un genio en una familia campesina es una lotería que cambia la vida de todos (y que una secta viene a llevarse).

### Fertilidad de los cultivadores
Es **ley del mundo** (generada por el seed, `content/` para cada familia de mundo) y tiene un mecanismo, no un dial:
- **El cuerpo refinado concibe menos.** La probabilidad de concepción cae con la densidad de esencia de cada padre (umbral de reino) y con la diferencia entre los dos: `fert = base × g(reino_madre) × g(reino_padre) × compatibilidad(esencia_madre, esencia_padre)`. Dos cultivadores fuertes de elementos compatibles conciben poco; uno fuerte con un mortal, todavía menos (el cuerpo mortal no aguanta la esencia).
- **El embarazo cuesta más cuanto más alto el reino** (el feto absorbe esencia), y la gestación puede alargarse (la ley decide cuánto, por especie y reino).
- **Por qué importa:** los cultivadores fuertes tienen pocos hijos, tarde y caros. Los clanes se sostienen con ramas mortales o de cultivo bajo, con concubinas de reino bajo y con adopciones. Un ancestro de mil años puede no tener ningún descendiente directo vivo: solo bisnietos lejanos que no conoce (npc-psychology: anclas, memoria de siglos).
- **Variación por mundo:** en algunos mundos la caída es suave, en otros casi total; la sangre (§9) puede compensarla. La calibración da la forma de las pirámides de población de cultivadores.

## 5. Parentesco: verdad y creencia

```ts
interface KinLink {
  from: AgentId; to: AgentId;
  kind: "biological" | "legal" | "recognized" | "claimed" | "fostered";
  role: KinRole;                          // parent, child, sibling (completo, medio), spouse, in_law…
  truth: boolean;                         // si el vínculo biológico es real (solo para biological / claimed)
  originEventId: EventId;                 // nacimiento, adopción, reconocimiento, reclamo
}
```
- **Biológico** (verdad): sale de la concepción. **Legal**: lo que la cultura reconoce (adopción, matrimonio, reconocimiento formal; contracts §11). **Reconocido**: el padre que acepta como suyo a un hijo (aunque no lo sea). **Reclamado**: alguien que dice ser hijo de (puede ser cierto o un impostor). **Criado**: quien crió sin vínculo legal.
- **Cada uno cree su propio árbol.** El parentesco que alguien conoce es un conjunto de creencias (`relation`/`attr`, information §1). La maternidad casi siempre es segura; la **paternidad es una creencia** que se forma con lo que el padre cree de la fidelidad, el tiempo, el parecido (perception §7) y los rumores.
- **Pruebas de sangre.** Cada cultura tiene las suyas: algunas no funcionan (la gota de sangre en el cuenco de agua, 滴血认亲, que la ley del mundo no respalda) y otras sí (técnicas de lectura de sangre o de karma de parentesco, que existen si la ley lo permite y alguien las descubrió). Un juicio de paternidad con una prueba falsa es un error con forma.
- **Hijos ilegítimos.** Son secretos con peso (information §7) para la madre, el padre y la familia. Su exposición mueve reputación, cara, herencias y venganzas. El bastardo con talento de una rama secundaria es un clásico que sale solo: tiene motivos (resentimiento, ambición), y los herederos legítimos, motivos para temerle.
- **Adopción y crianza.** Adoptar es un compromiso (contracts §11) que da parentesco legal: herederos para quien no tiene, talento para un clan, un huérfano que una secta toma. El adoptado puede ignorar su origen; descubrirlo es un evento de identidad (npc-psychology §9c).
- **El karma de parentesco** (heaven-karma: `kinship`) sigue a la **sangre**, no a la ley: el Cielo sabe quién es hijo de quién. Una técnica de lectura kármica puede revelar una paternidad oculta.

## 6. Matrimonio
El matrimonio es un compromiso de `status: spouse` entre los cónyuges **y** entre sus familias (contracts §1, §11). La cultura define su paquete de deberes (`content/`).

```ts
interface MarriageForm {                   // por cultura
  structure: "monogamy" | "polygyny" | "polyandry" | "group";
  ranks?: Array<"principal" | "secondary" | "concubine">;   // esposa principal, secundarias, concubinas: derechos distintos
  residence: "patrilocal" | "matrilocal" | "neolocal" | "dual";
  transfers: Array<"dowry" | "bride_price" | "groom_service" | "none">;
  arrangedBy: Array<"parents" | "clan_head" | "matchmaker" | "self" | "sect">;
  dissolution: Array<"repudiation" | "mutual" | "court" | "none">;
  widowhood: Array<"remarry" | "levirate" | "chastity" | "return_to_kin">;
  mourningYears?: number;
  sameSexUnions: "recognized" | "tolerated" | "hidden" | "punished";
}
```

- **Quién decide.** En muchas culturas, no los novios: el jefe del hogar o del clan decide con la utilidad de la familia (alianza, dote, talento, cara, deudas) y las preferencias de los hijos pesan según su poder y el afecto que se les tiene. Cuando el amor choca con el arreglo: obediencia con resentimiento, fuga, suicidio, adulterio, o un padre que cede.
- **Celestinas y matrimonios por conveniencia.** El casamentero es un oficio (con su reputación y sus sobornos). Las familias se evalúan con creencias: riqueza, salud, talento de los hijos, reputación. Mentir sobre la novia o el novio es una estafa con consecuencias.
- **Transferencias con conservación:** la dote sale del patrimonio de la familia de la novia (y a veces es su parte de la herencia); el precio de la novia, del de la familia del novio. Una dote alta arruina hogares; sin dote, una hija no se casa bien. Todo es economía real (economy §14).
- **Residencia** cambia de hogar a alguien (economy §3) y a veces de clan (organizations §2: ingreso por matrimonio). La nuera que entra a una casa ajena empieza con poca posición y la construye (o no) con hijos, trabajo y alianzas internas.
- **Esposas y concubinas.** Donde la poligamia es institución, el rango de cada esposa decide los derechos de sus hijos (herencia, rango en el clan): rivalidades entre esposas e hijos que son facciones dentro de un hogar.
- **Compañeros del Dao (道侣)** son una forma de unión propia de los cultivadores: un compromiso entre iguales para recorrer el camino juntos, a veces sin matrimonio formal, muchas veces con cultivo dual (§10). Lo valida la secta y lo pesa el Cielo (vínculo kármico fuerte).
- **Matrimonios de alianza** entre organizaciones (organizations §10): los cónyuges son, de hecho, rehenes y emisarios. Un matrimonio así se rompe cuando la alianza se rompe, y quien quedó del otro lado sufre.
- **Disolución y viudez:** repudio (con o sin causa reconocida), retorno a la familia de origen, segundas nupcias o castidad impuesta, levirato. Cada norma deja gente en posiciones frágiles: la viuda sin hijos varones, la repudiada sin dote.
- **Adulterio** es romper el compromiso con las consecuencias que la cultura y las personas apliquen: desde nada hasta la muerte. Es una de las grandes fuentes de secretos, chantaje y venganzas.

## 7. El hogar y la crianza
- **El hogar** (economy §3) es la familia que comparte presupuesto: padres, hijos, abuelos, nueras, sirvientes. Su composición cambia con nacimientos, muertes, casamientos y separaciones (una rama que se va con su parte).
- **Crianza.** Los padres (o quien críe) forman lo adquirido de los hijos (npc-psychology §2): su estilo sale de su temperamento y sus valores (cálido o frío, exigente o permisivo, presente o ausente), y de la situación (pobreza, guerra, un padre en reclusión). Un niño criado por una abuela, por un maestro o por la calle sale distinto con el mismo genoma.
- **Hermanos.** Orden de nacimiento (primogenitura según la cultura), comparación ("tu hermano ya formó su base"), alianzas y rivalidades que duran toda la vida y se vuelven facciones cuando hay herencia.
- **Deber filial** (contracts §2, norma): obedecer, mantener a los padres en la vejez, darles descendencia, honrarlos muertos. Su peso varía por cultura y por persona; romperlo es una falta grave en culturas donde es central.
- **La cara es familiar** (npc-psychology §9c): lo que hace un hijo avergüenza o enorgullece a toda la casa. Por eso la familia controla y por eso castiga.
- **Huérfanos y abandonados:** nacen de muertes, pobreza, ilegitimidad. Son mano de obra barata, discípulos baratos, mendigos o bandidos; algunos tienen talento oculto y nadie que lo mida.

## 8. Herencia
```ts
interface InheritanceRule {                // por cultura y por tipo de bien; el estatuto de un clan puede cambiarla
  scope: "land" | "movables" | "position" | "name" | "techniques" | "debts" | "feuds" | "cave" | "all";
  heirs: Array<"eldest_son" | "youngest" | "all_sons" | "all_children" | "widow" | "clan" | "adopted" | "disciple" | "designated">;
  shares?: "equal" | "eldest_double" | "by_mother_rank" | "by_testament";
  testament: "binding" | "advisory" | "none";
}
```
- **Qué se hereda:** tierra y casa, bienes muebles, puestos (organizations §12), nombre y rango, técnicas familiares (un secreto que pasa de boca en boca: information §7), cuevas de cultivo, deudas (contracts §10), enemigos y vendettas (memoria contada: npc-psychology §9c), karma enorme (heaven-karma §2).
- **Conservación:** al morir alguien, todo lo suyo pasa a alguien o queda sin dueño en un lugar concreto. Nada desaparece. El anillo espacial de un cultivador sin heredero queda donde murió, sellado (abajo): un tesoro con causa.
- **Testamentos** son documentos (contracts §3): se escriben, se esconden, se falsifican, se pierden. Un testamento oral ante testigos depende de su memoria y su lealtad.
- **Disputas de herencia** (contracts §7): hijos de distintas esposas, hermanos con normas distintas en la cabeza, un hijo ilegítimo que aparece, el clan que reclama, el discípulo que dice que el maestro le prometió todo. Se resuelven por mediación, tribunal, facciones o fuerza, y dejan rencores.
- **Lo sellado del cultivador:** los anillos espaciales, los manuales con sello de alma y los artefactos vinculados (crafts) están cerrados para quien no es su dueño. El heredero tiene que romper el sello (con fuerza, saber o la llave que le dejaron) y a veces no puede: una fortuna que existe y no se puede usar.
- **Divisiones.** Repartir la tierra entre todos los hijos la achica en cada generación (presión: pobreza, migración, hijos a la secta); la primogenitura concentra y deja segundones sin nada (presión: ambición, bandidaje, secta, ejército). Cada regla produce su sociedad.

## 9. Linajes, clanes y sangre

### Genealogías
```ts
interface Genealogy {                      // el libro del linaje (族谱): un documento, no la verdad
  clan: OrgId;
  entries: Array<{ person: AgentId | PhantomRef; parents: AgentId[]; branch: BranchId; generationName?: string; notes: string }>;
  author: AgentId[]; revisions: EventId[];
  media: MediumRef[];                      // dónde está escrito (y sus copias, con errores)
}
```
- **El libro del linaje es una creencia escrita.** Registra lo que el clan quiere recordar: omite bastardos y desterrados, inventa un ancestro ilustre (una entidad fantasma, information §1), corrige la paternidad que conviene. Falsificar una genealogía para entrar a un clan o reclamar un título es una intriga posible.
- **Ramas.** Línea principal y ramas secundarias, con derechos distintos (organizations §13: clan). Una rama se separa con un evento (una disputa, una migración, un ancestro que fundó otra casa) y lleva consigo su parte (o no).
- **Nombres de generación** (字辈) y nombres de clan en `content/` por cultura; dicen a qué generación pertenece alguien sin preguntar.
- **El salón ancestral** guarda las tablillas, recibe ofrendas ([spirits.md](spirits.md) §6-§11: qué reciben de verdad, ancestros que se quedan, qué pasa si el linaje deja de ofrendar) y es donde se juran los compromisos más solemnes del clan.
- **Consanguinidad.** Los clanes cerrados (para no repartir la sangre, la tierra o un secreto) concentran recesivos: más enfermedades hereditarias y, a veces, constituciones raras. La cultura puede prohibir o promover casarse entre primos.

### Linajes de sangre
- **Sangre de ancestro, de bestia o de dragón** (`bloodlines`): una contribución hereditaria que se diluye a la mitad por generación (en promedio, con varianza) y puede **despertar** si se dan condiciones: concentración suficiente, un evento (borde de la muerte, contacto con la esencia del ancestro, un tesoro de la misma sangre), o una técnica de activación. Despertar es un evento con costo (body-health §12: refinamiento del cuerpo) que cambia la aptitud.
- **De dónde sale un linaje:** de un ancestro que transformó su cuerpo (un cultivador de cuerpo legendario), de una unión con una bestia despierta o un ser de otra especie (metaphysics: especies), de una bendición o maldición con causa. Siempre con `originEventId` (deep-history: los linajes como legado).
- **Maldiciones de sangre** existen igual: una maldición puesta sobre un linaje (con mecanismo real: una atadura sobre la sangre, contracts §8) o una enfermedad hereditaria que la cultura cree maldición.
- **Los clanes viven de su sangre** cuando tienen una: casan para conservarla, castigan al que la "ensucia", y buscan entre las ramas al que despierte. Cuando la sangre se diluye y nadie despierta, el clan decae aunque nada más haya cambiado.

## 10. Cultivo dual
- **Es una técnica** (cultivation §10, conocimiento con autor y defectos): un intercambio de esencia entre dos cultivadores durante una unión, con conservación (elements §3: la polaridad yin–yang de elements libera esencia ordenada cuando los dos son compatibles).
- **Simbiótico:** los dos ganan (más de lo que ganarían solos por la esencia ordenada que libera la polaridad, nunca más de lo que entra); crea un vínculo kármico fuerte y suele formar compañeros del Dao (§6).
- **Parasitario** (horno, 炉鼎): uno drena al otro, que pierde esencia, salud y años. Es explotación; mucho karma; las víctimas son casi siempre de reino bajo o sin poder para negarse ([social-structure.md](social-structure.md) §6). Las sectas demoníacas lo practican; las justas lo condenan en público (y a veces lo practican en privado: máscaras).
- **Fertilidad:** la técnica define si favorece o evita la concepción (un parámetro de la técnica, evaluado por la ley).
- **Narración:** sin detalle explícito; el narrador cuenta el efecto (la esencia que circula, el vínculo que queda), nunca el acto.

## 11. Muerte, luto y longevidad en la familia
- **Duelo** (npc-psychology: emociones, memoria intensa) y **luto** como norma cultural: años de luto, prohibición de casarse, ropa, retiro de un cargo. Romper el luto es una falta social.
- **Huérfanos y viudas** cambian de hogar, de posición y de recursos; son los momentos donde la familia muestra si es una red o un depredador (el tío que se queda con la tierra de los sobrinos).
- **El cultivador que sobrevive a los suyos:** ve envejecer y morir a esposa mortal, hijos y nietos (npc-psychology: anclas). Algunos se apartan del mundo; otros cuidan a sus descendientes durante siglos como ancestro protector; otros los usan.
- **Ancestros que siguen ahí:** un ancestro en reclusión o como espíritu ([spirits.md](spirits.md) §8) es parte de la familia: se le ofrenda, se le consulta, se le teme.

## 12. Otras especies y casos raros
- **Especies** (metaphysics §7): la reproducción, la gestación, la fertilidad y la herencia son por especie (`content/`). Uniones entre especies son fértiles solo si la ley lo permite; de ahí salen los mestizos y los linajes de sangre de bestia.
- **Bestias** se reproducen con el mismo modelo simplificado (living-world: poblaciones con rasgos heredables).
- **Posesión y robo de cuerpos:** un alma que ocupa el cuerpo de otro (cultivation §14, spirits) lleva un genoma ajeno: sus hijos son hijos de ese cuerpo, no de su alma. Y su familia "nueva" cree que el hijo sigue siendo el mismo.

## 13. El jugador y el narrador
- **Nacés en una familia.** El personaje del jugador tiene padres, hermanos, hogar, quizás clan, generados por la sim (no inventados para él): sus padres se casaron por algo, su talento sale de su genoma, su hogar tiene deudas y vecinos.
- **Lo que sabés de tu familia es creencia.** Podés ser adoptado sin saberlo, hijo de otro padre, heredero de una sangre dormida, o el bastardo de un anciano de secta. Se descubre como todo: por percepción, rumores, documentos, una técnica de lectura de sangre o alguien que te reconoce.
- **Casarte, tener hijos y criarlos** son acciones con el mismo modelo que los NPCs: con quién (y si la familia lo acepta), la dote, la residencia, la crianza que les das (que forma lo adquirido de tus hijos).
- **Una sola vida.** Al morir, el jugador **no** continúa como su hijo (VISION, principio 8). Su descendencia aparece en el epílogo y en la crónica ([chronicle.md](chronicle.md) §7): qué fue de ellos, qué heredaron, qué recuerdan de él.
- **El narrador** recibe solo el árbol que cree el personaje y lo que percibe; nunca la paternidad real ni el genoma. Lo íntimo se narra con elipsis.
- **Si el personaje comete violencia sexual** (§2), las consecuencias son las del mundo, sin atajos ni indulgencia: la víctima la recuerda con trauma y deseo de venganza (npc-psychology), se vuelve rumor si hubo testigos o si ella habla (information), la ley de la cultura y de las sectas la castiga (contracts, organizations), deja una deuda kármica pesada que alimenta tribulaciones y demonios internos (heaven-karma), y puede dejar un embarazo con su propia historia (§3, §5). El narrador no la describe; cuenta el antes, el después y lo que cambia.

## 14. Escala (LOD)
- **Tier 3-4:** individuos con genoma completo, uniones, concepciones, embarazos y partos como eventos, crianza día a día.
- **Tier 2:** genoma resumido (solo los rasgos que importan para el agente), nacimientos y matrimonios como eventos con decisión simplificada.
- **Tier 0-1:** demografía por cohortes: tasas de nupcialidad, fertilidad por edad y reino, mortalidad infantil y materna, adopción, ilegitimidad; calibradas contra el modo individual. Las genealogías de clanes importantes se guardan comprimidas (líneas principales y personas notables).
- **Materialización:** cuando hace falta un individuo (o un ancestro), se genera coherente con la cohorte y con los padres registrados; su genoma sale del de los padres con el mismo sub-stream, así que es el mismo cada vez que se materializa. Los padres no materializados tienen un genoma resumido derivado de su población.

## Implementación
- **Fase 1:** el jugador nace con padres y hogar generados por la sim; genoma mínimo (temperamento, aptitudes, talla) heredado de los padres.
- **Fase 3:** familias completas: atracción y uniones, matrimonio como compromiso con normas culturales (forma, dote, residencia), concepción, embarazo y parto con riesgo, crianza que forma lo adquirido, hogares que se arman y se parten, herencia de bienes y deudas con disputas, paternidad como creencia, hijos ilegítimos como secretos, enfermedades hereditarias.
- **Fase 4:** herencia de la aptitud de cultivo y de las raíces por elemento, ambiente prenatal, fertilidad de cultivadores, compañeros del Dao y cultivo dual, sellos sobre la herencia de cultivadores.
- **Fase 6:** clanes con genealogías como documentos, ramas, salón ancestral, matrimonios de alianza, sucesión hereditaria, linajes de sangre que despiertan.
- **Fase 7:** demografía por cohortes en la historia, linajes que se diluyen y reaparecen, genealogías falsas de dinastías.
- **Fase 8:** dinastías, crisis de sucesión de estado ([state.md](state.md) §9), especies y mestizos.

## Tests
- **Procedencia:** toda persona tiene un evento de nacimiento con dos padres biológicos (salvo condiciones iniciales y orígenes especiales con su propio evento); todo genoma tiene padres o es inicial.
- **Conservación:** la población cambia solo por nacimientos, muertes y migraciones; dote, precio de la novia y herencia son transferencias que no crean ni destruyen bienes.
- **Determinismo:** mismos padres, mismo seed y mismo id de hijo dan el mismo genoma, también al materializar.
- **Heredabilidad:** sobre miles de nacimientos, la correlación padres–hijos de cada rasgo coincide con su heredabilidad configurada.
- **Consanguinidad:** un clan cerrado durante varias generaciones muestra más enfermedades recesivas que uno abierto.
- **Fertilidad de cultivadores:** la tasa de concepción cae con el reino y con la diferencia de reino según la ley del mundo.
- **Verdad vs creencia:** un hijo de otro padre criado como propio aparece en la genealogía y en las creencias como hijo del marido, y en el karma de parentesco como hijo del biológico. El narrador nunca recibe la paternidad real si el personaje no la sabe.
- **Escenario controlado:** con primogenitura, los segundones de hogares sin tierra suficiente salen del hogar más seguido (secta, ejército, bandidaje) que con reparto igualitario, y con reparto igualitario las parcelas se achican por generación.
- **Agregado:** las pirámides de población y la proporción de cultivadores por reino en tier 0 coinciden en promedio con las del modo individual.

## Decisiones tomadas en este borrador (revisables)
- Genoma con rasgos aditivos con heredabilidad por rasgo, genes discretos para enfermedades y rasgos visibles, linajes de sangre que se diluyen y despiertan, y mutaciones raras con causa.
- La paternidad es creencia; el parentesco legal y el biológico se guardan aparte; el karma de parentesco sigue a la sangre.
- La aptitud de cultivo se hereda poco; el ambiente prenatal (incluida la esencia de la madre) suma con costo real para ella.
- La fertilidad baja de los cultivadores es ley del mundo con mecanismo (densidad y compatibilidad de esencia), variable por mundo.
- Matrimonio, adopción y deber filial son compromisos de contracts.md; las formas de matrimonio y las reglas de herencia son normas culturales en `content/`.
- Lo íntimo existe como eventos con consecuencias y se narra con elipsis. La violencia sexual existe como crimen: el jugador puede hacer que su personaje la cometa (nunca se le sugiere) y carga con todas las consecuencias, pero nunca se narra explícita, y la intención se rechaza si la víctima es menor (decisión del usuario, 2026-10-05).
- Al morir, el jugador no continúa como su descendiente; los hijos aparecen en el epílogo y la crónica.

## Preguntas abiertas
- Calibración: heredabilidad por rasgo (sobre todo de la aptitud de cultivo) para que los clanes cultivadores tengan ventaja sin que el talento sea casta.
- Calibración: curva de fertilidad por reino y por diferencia de reino (pocos hijos de los fuertes sin que los clanes cultivadores se extingan solos).
- Calibración: tasas de ilegitimidad, adulterio descubierto y disputas de herencia por cultura.
- Calibración: dilución y probabilidad de despertar de los linajes de sangre (que un despertar sea raro pero que los clanes con sangre lo vean cada pocas generaciones).
- Calibración: mortalidad materna e infantil por medicina disponible (que el parto sea peligroso en un mundo mortal sin vaciar las aldeas).
