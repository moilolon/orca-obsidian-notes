# Obsidian Notes para Orca — Memoria del proyecto

Plugin de Orca que muestra una bóveda de Obsidian en la barra lateral: un panel de componentes
(`src/panel/`) y su worker de Node (`src/worker/`).

`README.md` es la portada, con el formato de todos los repos de moilolon: *Qué es*, *Cómo
funciona*, *Puesta en marcha* y el pie común, sin árbol de carpetas, código largo ni roadmap. Lo
de abajo es para Claude.

## Estructura

- `orca-plugin.json`: manifiesto (panel, worker, icono y portada; permisos `trusted-worker` y
  `storage:own`).
- `src/protocol.ts`: el contrato entre panel y worker. El panel no puede importar módulos de
  Node: todo lo que lee del disco se lo pide al worker.
- `src/panel/`: `panel.tsx` (barra, árbol, búsqueda, bóvedas y la nota), `panel.check.ts` (los
  escenarios de `orca plugin check`), `markdown.ts` (propiedades, comentarios, avisos, enlaces,
  títulos y sus colores, trozos de menos de 16 KiB) e `i18n.ts` (textos por idioma y códigos de
  error del worker; un idioma nuevo es una tabla con todas las claves de la inglesa).
- `src/worker/`: `worker.ts` (lee las bóvedas, las vigila con `fs.watch`, avisa al panel con
  `notes.changed` y contesta; importa `markdown.ts` para los backlinks; copia las imágenes a
  `cache/` del plugin instalado, porque el `Image` de Orca solo enseña ficheros del plugin y sí
  sirve los que aparecen después de instalarlo), `vault.ts` (rutas
  dentro de la bóveda, orden, resolución de enlaces, la URL de Obsidian) y `folder-picker.ts`
  (PowerShell en Windows, `osascript` en macOS, `zenity` en Linux).
- Cada módulo tiene sus tests al lado (`*.test.ts`, `*.test.tsx`).
- `assets/draw-images.ps1` dibuja `icon.png` (el del plugin y el del proyecto en Orca), `cover.png`
  y `social-preview.png` (la vista previa de GitHub, que se sube a mano en Settings) a partir de formas.

## Desarrollo

```bash
npm install           # solo los tipos (TypeScript y @types/node)
npm run typecheck     # tsc, sin generar nada
npm test              # orca plugin test .
npm run check         # orca plugin check: dibuja cada escenario de panel.check.ts
orca plugin dev watch . --check --shot .orca/shots   # recarga al guardar y saca capturas
powershell -NoProfile -File assets/draw-images.ps1   # vuelve a dibujar icono, portada y vista previa
```

Los tests pueden pasar con el panel en blanco: cada cambio se comprueba con `orca plugin shot`
o en el propio panel.

## Git

- **Commits:** en inglés, como el historial, en imperativo y con la primera letra en mayúscula.
  Una línea de hasta 72 caracteres, sin prefijo ni punto final (`Center the section title in its
  color band`). Cuerpo solo si el porqué no es obvio: línea en blanco y líneas de 72. Sin
  `Co-Authored-By` ni otra atribución.
- **Ramas:** `<tipo>/<descripción-corta>`, en minúsculas y kebab-case, desde `main`. Tipos:
  `feature`, `bugfix`, `docs`, `refactor`, `chore`.
- **Pull requests:** título como un commit; cuerpo en español con «Qué cambia», «Por qué» y
  «Cómo comprobarlo». Se mergean por squash, con el título y el cuerpo del PR como commit.
- **Tras un cambio de código**, el plugin instalado en Orca no se entera hasta reinstalarlo:
  `README.md`, sección *Puesta en marcha*.
