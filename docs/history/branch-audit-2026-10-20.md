# Auditoría de ramas del 2026-10-20

Pedido: terminar trabajo pendiente, integrar a develop y retirar las ramas viejas.
Se revisaron todas las ramas locales, `git ls-remote --heads origin`, PR abiertos
y los 17 worktrees, incluidos los detached de reportes.

| Rama encontrada | Resultado del examen |
|---|---|
| `feat/f3-band-succession` | Tres commits equivalentes incorporados en #652; worktree limpio. |
| `feat/f3-cult-crafts` | Incorporada en #652; dos patch-ids cambiaron al integrar, pero núcleo/tests finales coinciden. Worktree limpio. |
| `feat/f3-funeral-cost` | Commits previos incorporados en #652; cuatro archivos sin commit de tumba física conservados en snapshot `54909ad`. Implementación completada en `8ac0fc0`, con flag persistible y presencia por hex/space; mantiene el modo anterior. |
| `feat/f3-social-continuity` | PR #652 mergeada, `e391592`; remoto ya eliminado por GitHub. |
| `feat/f3-item-claims-contract` | PR #653 mergeada, `ec05d59`; remoto ya eliminado por GitHub. |
| `feat/f3-item-claims-core` | PR #654 mergeada, `19caa62`; remoto ya eliminado por GitHub. |
| `feat/f3-itemclaims-agent` | Commit y corrección residual incorporados en #654; residual original preservado en snapshot `9a1068f`. |
| `dependabot/npm_and_yarn/develop/dependencies-5014ec308b` | PR #651 con cinco actualizaciones compatibles y dos incompatibles con los contratos actuales. Commit original preservado; conjunto compatible incorporado en `b420cc1` y PR #655, que sustituye #651. |
| `chore/deps-651-integration` | Rama auxiliar de revisión aislada, resultado idéntico al lock/package/Dependabot del lote consolidado; retirada después de integrar #655. |
| `feat/f3-funeral-tomb-integration` | Rama coordinadora temporal del lote #655; retirada después del merge y de actualizar develop. |

Los otros once worktrees ya estaban detached y limpios: no contenían trabajo
sin guardar ni ramas nuevas que integrar. Las carpetas y los junctions se
conservan. Los worktrees temáticos se dejan detached en sus commits; borrar sus
nombres de rama no borra archivos ni commits de esas instantáneas.

Respaldo local antes de limpiar:

- `sim-reports/branch-audit-2026-10-20.json`: estado original por worktree.
- `sim-reports/branches-before-cleanup-2026-10-20.bundle`: refs antes de guardar WIP.
- `sim-reports/branches-before-cleanup-with-wip-2026-10-20.bundle`: refs y WIP, verificado con `git bundle verify`.
- `sim-reports/funeral-tomb-wip-before-integration.patch`: WIP funerario original.

TypeScript 7 no se integra: dependency-cruiser 18.6.0 acepta TS <7; con TS 7.0.2
terminó 0 pero omitió las fuentes y reportó 0 módulos. Se conserva TS6 y tipos de
Node24, como el runtime. El bloqueo externo sigue en `toolchain-typescript7`;
Dependabot ignora esas majors hasta revisar sus contratos. No se considera
trabajo local abandonado ni se omiten los checks para vaciar la lista de ramas.

La primera corrida amplia encontró además un bug previo de floorDiv en el
límite negativo seguro. Contraejemplo, fix `8d161d3` y regresión fija de 13 tests
de tiempo quedan registrados en HANDOFF y ARCHITECTURE. La aprobación final de
#655 se registra en el estado vigente de HANDOFF, con SHA, log y exit reales.
