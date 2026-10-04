# Mantenimiento y recuperación

## Recuperar una conversación

1. Abre `RESTAURAR.cmd` en Windows, o ejecuta `node dist/backups.mjs` desde la carpeta del ZIP.
2. La utilidad muestra las copias. Pega el ID del respaldo que quieres extraer.
3. Verifica el hash, descomprime los JSON y crea `COMO-RESTAURAR.txt` en la carpeta de recuperación. No cambia OpenCode todavía.
4. Cierra OpenCode. Comprueba que los IDs no existen actualmente: importar encima de una sesión viva no es una restauración segura.
5. Abre el archivo de instrucciones y ejecuta los comandos indicados. Usa PowerShell en Windows; en Linux/macOS, tu terminal.
6. Inicia OpenCode de nuevo y revisa el chat recuperado.

El formato es el de `opencode export`: `{ info, messages }`. El importador agrega la conversación al proyecto desde el que se ejecuta. Si la ruta original desapareció, elige conscientemente un nuevo directorio. El plugin no recrea carpetas de proyectos.

Se recuperan metadatos compatibles, mensajes y partes. No se garantiza reconstruir eventos internos de ejecución, tareas pendientes, snapshots Git, archivos enlazados o enlaces compartidos. Para una recuperación integral necesitas una copia completa de la base y, cuando corresponda, de sus archivos auxiliares.

Los estados de los manifiestos son:

| Estado | Significado |
|---|---|
| `backed-up` | La copia existe; no hay confirmación de borrado |
| `deleted` | Se verificó que la familia desapareció |
| `skipped` | Cambió o quedó protegida después de la copia |
| `error` | Hubo un fallo; puede haber borrado parcial, revisar antes de importar |

## Eliminar respaldos que ya no necesitas

`PURGAR-RESPALDOS.cmd` revisa copias de más de 30 días correspondientes a familias cuya eliminación se confirmó. Lista las copias antes de pedir escribir `PURGAR`. No elimina copias marcadas con error, omitidas o sin confirmación.

Desde una terminal puedes cambiar el umbral:

```sh
node dist/purge.mjs 60
```

La eliminación de esas copias es definitiva. La herramienta no borra el contenido extraído en `recovered/`, copias completas SQLite ni archivos de proyectos. Revisa esas ubicaciones aparte si también quieres liberar su espacio.

## Mantenimiento fuera de línea seguro (`MANTENIMIENTO-OFFLINE.cmd` / `offline-vault.ts`)

Herramienta de mantenimiento autónomo para inspeccionar la base de datos de OpenCode, simular planes de limpieza respetando perfiles y candados, y ejecutar limpiezas fuera de línea con respaldo previo verificable y compactación `VACUUM`.

### Modos y comandos CLI

```sh
# Inspección de solo lectura (tamaño, páginas libres, integridad, esquema)
node dist/offline-vault.mjs inspect

# Generar plan de limpieza (modo simulado / dry-run: NO modifica la base de datos)
# Si el alcance configurado en Vault es 'project', se requiere '--project <id>'
node dist/offline-vault.mjs plan [--project <id>] [--max <n>] [--out vault-plan.json]

# Aplicar limpieza con respaldo previo y compactación (requiere confirmación explícita)
node dist/offline-vault.mjs apply --plan vault-plan.json
```

En Windows también puedes ejecutar directamente **`MANTENIMIENTO-OFFLINE.cmd`** para acceder al menú interactivo.

### Garantías de seguridad y requerimientos

1. **Requisitos de entorno y capacidades:** Requiere Node.js 22.6 o posterior con módulo nativo `node:sqlite` habilitado y archivos compilados en `dist/`. El lanzador `MANTENIMIENTO-OFFLINE.cmd` verifica estas capacidades de forma estricta antes de iniciar.
2. **El comando `plan` nunca borra:** La fase de planificación evalúa perfiles, políticas de retención, candados y jerarquías completas de familias de sesiones, generando un archivo JSON firmado criptográficamente con una huella SHA-256. Es 100% de solo lectura.
3. **Confirmación obligatoria para `apply`:** La aplicación del plan exige aprobación explícita (escribir `CONFIRMAR` en la terminal o pasar `--confirm`).
4. **Respaldo previo verificable y espacio requerido:** Antes de cualquier modificación, se crea una copia completa de seguridad `.sqlite` mediante `VACUUM INTO` y se comprueba su integridad con `PRAGMA quick_check`. Este respaldo conserva todos los bytes originales en disco y no se elimina automáticamente. Se requiere disponer en disco de al menos **el doble del tamaño de la base de datos más margen (2x + 16 MiB)** para alojar el respaldo y permitir la compactación.
5. **Disciplina de escritor único y no reapertura:** OpenCode **debe permanecer completamente cerrado** durante todo el procedimiento. El sistema comprueba de forma fail-closed la ausencia de procesos de OpenCode al inicio, antes de confirmar la transacción de borrado y antes de ejecutar la compactación. En modo SQLite WAL, `BEGIN EXCLUSIVE` no excluye lectores externos concurrentes ni cubre la brecha entre el commit y `VACUUM`; por tanto, no se debe abrir OpenCode ni clientes concurrentes hasta concluir el proceso.
6. **Protección contra planes manipulados o stale:** Se valida el esquema y los límites del plan (IDs únicos, correspondencia estricta de miembros de familia), se recomputa la huella digital SHA-256, se verifica el hash de snapshot de sesiones e historial de mensajes hijos (detectando cambios que `session.time_updated` no refleja), y se revalida bajo bloqueo transaccional exclusivo que ninguna mutación ocurrió entre la creación del respaldo y el borrado.
7. **Validación estricta de esquema y cascadas foráneas:** Se verifica la presencia de claves foráneas con `ON DELETE CASCADE` en tablas dependientes conocidas (`message`, `part`, `todo`, etc.) y se rechaza cualquier tabla desconocida con columnas relacionadas (`session_id`, `message_id`) que carezca de cascada configurada, evitando orfandad de registros.

## Inspeccionar SQLite sin modificarlo

Esta utilidad opcional necesita Python 3 con SQLite; no es un requisito para instalar o usar el plugin.

Ruta habitual en Windows, salvo ajustes XDG u otras versiones:

```powershell
py scripts/vacuum.py "$env:USERPROFILE\.local\share\opencode\opencode.db"
```

Linux/macOS:

```sh
python3 scripts/vacuum.py ~/.local/share/opencode/opencode.db
```

Siempre exige una ruta existente. No crea una base vacía si te equivocas. Comprueba la cabecera SQLite y la tabla `session`; muestra tamaño, número de filas y páginas libres.

## Compactar para reducir el archivo

Primero cierra OpenCode y mantenlo cerrado durante todo el mantenimiento. Añade `--vacuum` al comando anterior. Por ejemplo:

```powershell
py scripts/vacuum.py "$env:USERPROFILE\.local\share\opencode\opencode.db" --vacuum
```

La utilidad comprueba procesos reconocibles, pide escribir `CERRADO`, verifica integridad, crea una **copia completa SQLite** y solo entonces compacta. Comprueba integridad de nuevo al terminar. No borra filas de sesiones.

Necesita espacio temporal; reserva aproximadamente tres veces el tamaño de la base para copia y reconstrucción. La copia completa queda junto al archivo original. Hasta mover o eliminar esa copia puede que el espacio libre total no aumente. No borres la copia antes de verificar que OpenCode abre correctamente.

El control de procesos no reconoce todos los posibles nombres de binarios o servicios externos. No abras otro cliente durante el mantenimiento. En sistemas Unix necesita `pgrep`; en Windows usa `tasklist`.

## Operación interrumpida

Si aparece «Otra operación está en curso» después de un cierre inesperado:

1. Cierra todas las instancias de OpenCode.
2. Ejecuta `REPARAR-BLOQUEO.cmd` o `node dist/unlock.mjs`.
3. Si confirma que el proceso registrado ya no existe, escribe `CERRADO`.
4. Reinicia OpenCode y revisa respaldos/historial antes de volver a limpiar.

No borres `state.json` para resolverlo: allí están tus candados y cupos. El reparador solo quita `operation.lock`.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| No aparece `/session-vault` | Reinicia OpenCode, verifica versión y que se editó el tui.json activo |
| «No se encuentra node» | Instala Node.js 22.6 o posterior y vuelve a abrir el instalador |
| Terminal demasiado pequeña | Maximiza o reduce la fuente; mínimo 70 × 30 |
| No borra hasta llegar exactamente al cupo | Revisa candados, actividad reciente, archivadas, sesiones abiertas y límite por lote |
| Todos los tamaños muestran `—` | Abre una fila con `i` para calcular su exportación lógica |
| Inventario incompleto/jerarquía inválida | Repara el historial con OpenCode; no se eliminan registros incompletos a ciegas |
| Vista previa cambió | Pulsa `r` o vuelve a abrir la previa; hubo actividad o cambios de configuración |
| Carpeta antigua ya no disponible | El host puede fallar al consultar ese directorio; resuelve el proyecto/ruta antes de limpiar |
| Automático no hace nada | Comprueba que esté activo, haya pasado el intervalo, no haya diálogo abierto y exista una sola instancia local |
| Conexión remota | Esta versión permite consulta, pero bloquea la limpieza remota |
