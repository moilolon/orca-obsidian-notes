# Obsidian Notes para Orca

Panel lateral de [Orca](https://github.com/stablyai/orca) para leer las notas de una bóveda de Obsidian sin salir del editor.

- **La nota ocupa todo el panel.** El árbol y la búsqueda se abren desde la barra de arriba y se esconden al abrir una nota.
- **El visor es el Markdown de Orca:** listas anidadas, enlaces, tablas, código y casillas.
- **Entiende Obsidian:** oculta el front matter YAML, dibuja los avisos (`> [!warning] …`) como avisos y lista los `[[enlaces]]` de la nota como botones para saltar a ellos.
- **Varias bóvedas:** se añaden con el selector de carpetas del sistema (**Browse…**) o pegando la ruta, y se cambia de una a otra con un desplegable.
- **En el idioma de Orca:** inglés, o español cuando Orca está en español (`src/i18n.ts`; otro idioma es otra tabla allí).
- **Abrir en Obsidian:** abre la nota con `obsidian://open?path=…`, así que funciona también si la carpeta añadida es una subcarpeta de la bóveda.
- **Solo lectura.** El plugin no escribe nada en las bóvedas; solo guarda la lista de bóvedas en su propio almacenamiento.

Basado en la idea de [Obsidian for Orca](https://github.com/vrwolf1004/orca-obsidian) de vrwolf1004 (MIT), reescrito como panel de componentes nativos de Orca.

## Instalar

Desde la carpeta del repositorio:

```bash
orca plugin install .
```

Orca enseña los permisos que pide y un comando con `--approve <huella>` para aprobarlo. Pide:

- **trusted-worker:** el worker (`src/worker.ts`) corre en un proceso de Node con los permisos de tu usuario, porque tiene que leer las carpetas de notas.
- **storage:own:** guarda la lista de bóvedas.

Después, abre el panel **Obsidian** en la barra lateral derecha de Orca, pulsa el botón de ajustes y elige la carpeta de la bóveda con **Browse…** (o pega su ruta).

El selector de carpetas es el del sistema, abierto por el worker: PowerShell en Windows, `osascript` en macOS y `zenity` en Linux. Donde no está, se pega la ruta.

## Desarrollo

No hay paso de compilación: Orca carga los `.ts` y `.tsx` tal cual.

```bash
npm install            # solo para los tipos (TypeScript y @types/node)
npm run typecheck      # tsc sin emitir
npm test               # orca plugin test .
npm run check          # orca plugin check: dibuja el panel en cada escenario de src/panel.check.ts
orca plugin dev watch . --check --shot .orca/shots   # recarga al guardar y saca capturas
```

| Fichero | Qué hace |
| ------- | -------- |
| `src/panel.tsx` | El panel: barra, árbol, búsqueda, bóvedas y la nota |
| `src/i18n.ts` | Los textos del panel en cada idioma y los códigos de error del worker |
| `src/folder-picker.ts` | El selector de carpetas del sistema |
| `src/markdown.ts` | Convierte una nota de Obsidian en lo que dibuja el Markdown de Orca (front matter, avisos, `[[enlaces]]`, trozos de menos de 16 KiB) |
| `src/worker.ts` | Lee las bóvedas del disco y contesta al panel |
| `src/vault.ts` | Reglas de rutas: dentro de la bóveda, claves, orden, resolución de `[[enlaces]]`, URL de Obsidian |
| `src/protocol.ts` | El contrato entre panel y worker |

## Licencia

MIT. Ver [LICENSE](LICENSE).
