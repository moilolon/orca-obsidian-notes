<div align="center">

# 📝 Obsidian Notes para Orca

**Tu bóveda de Obsidian en la barra lateral de Orca, con la nota abierta ocupando todo el panel**

[![Plugin de Orca](https://img.shields.io/badge/Orca-plugin-7C5CDC?style=for-the-badge)](https://github.com/stablyai/orca)
[![Sin compilación](https://img.shields.io/badge/TypeScript-sin%20compilaci%C3%B3n-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#-desarrollo)
[![Obsidian](https://img.shields.io/badge/Lee-bóvedas%20de%20Obsidian-7C3AED?style=for-the-badge&logo=obsidian&logoColor=white)](https://obsidian.md/)
[![Solo lectura](https://img.shields.io/badge/Bóvedas-solo%20lectura-2EA043?style=for-the-badge)](#-qué-toca)

<img src="assets/cover.png" alt="El nombre del plugin junto a un panel lateral con una nota cuyas secciones abren con bandas de color" width="820">

[Funciones](#-funciones) ·
[Instalar](#-instalar) ·
[Qué toca](#-qué-toca) ·
[Estructura](#-estructura) ·
[Desarrollo](#-desarrollo)

</div>

---

## ✨ Funciones

| | Función | Qué hace |
|---|---|---|
| 📖 | **Lectura a panel completo** | La nota abierta ocupa todo el panel; el árbol y la búsqueda se abren desde la barra y se apartan al abrir una nota |
| 🧾 | **El Markdown de Orca** | Listas anidadas, enlaces, tablas, código y casillas, dibujados por el componente Markdown de Orca |
| 🪨 | **Entiende Obsidian** | Oculta el front matter YAML, dibuja los avisos (`> [!warning] …`) como avisos y lista los `[[enlaces]]` de la nota como botones que los abren |
| 🎨 | **Secciones que se distinguen** | Cada `##` abre con una banda de su propio color y espacio encima; los `###` y `####` van en el color de su sección, cada nivel más pequeño |
| 🗂️ | **Varias bóvedas** | Se añaden con el selector de carpetas del sistema (**Browse…**) o pegando la ruta, y se cambia de una a otra con un desplegable |
| 🔎 | **Búsqueda** | Encuentra notas por nombre y por contenido |
| ↗️ | **Abrir en Obsidian** | Abre la nota con `obsidian://open?path=…`, así que funciona aunque la carpeta añadida sea una subcarpeta de la bóveda |
| 🌍 | **En el idioma de Orca** | Inglés, o español cuando Orca está en español |

Basado en la idea de [Obsidian for Orca](https://github.com/vrwolf1004/orca-obsidian) de
vrwolf1004 (MIT), reescrito como panel de componentes nativos de Orca.

---

## 🚀 Instalar

Desde la carpeta del repositorio:

```bash
orca plugin install .
```

Orca enseña los permisos que pide el plugin y un comando con `--approve <huella>` para
concederlos. Después, abre el panel **Obsidian** en la barra lateral derecha de Orca, pulsa
el botón de ajustes y elige la carpeta de la bóveda con **Browse…**, o pega su ruta.

> [!TIP]
> Orca instala una copia fija de la carpeta, así que un cambio en el código solo llega al
> volver a ejecutar `orca plugin install .`. Saca antes `node_modules` de la carpeta (solo
> trae los tipos de desarrollo) o la copia lo arrastra. Si los permisos no cambian, Orca
> conserva la aprobación.

---

## 🔐 Qué toca

| Permiso | Para qué |
|---|---|
| **trusted-worker** | El worker (`src/worker/worker.ts`) corre en un proceso de Node con los permisos de tu usuario, porque lee las carpetas de notas |
| **storage:own** | Guarda la lista de bóvedas |

- **Solo lectura.** Nunca escribe en una bóveda; lo único que guarda es la lista de bóvedas.
- **Solo las bóvedas añadidas.** El worker rechaza cualquier carpeta que no esté en la
  lista y cualquier ruta que se salga de una.
- **El selector de carpetas** es el del sistema, abierto por el worker: PowerShell en
  Windows, `osascript` en macOS y `zenity` en Linux. Donde no está, se pega la ruta.
- **Nada sale del equipo.** No hace llamadas de red.

---

## 📁 Estructura

```text
orca-obsidian-notes/
├── 🧩 orca-plugin.json        Manifiesto: el panel y el worker, el icono y la portada
├── 📜 src/
│   ├── 🤝 protocol.ts         El contrato entre panel y worker
│   ├── 🪟 panel/              Corre en el panel de Orca, sin acceso a Node
│   │   ├── panel.tsx          El panel: barra, árbol, búsqueda, bóvedas y la nota
│   │   ├── panel.check.ts     Los escenarios que dibuja `orca plugin check`
│   │   ├── markdown.ts        Una nota de Obsidian como Markdown de Orca: front matter,
│   │   │                      avisos, [[enlaces]], títulos y sus colores, trozos de menos de 16 KiB
│   │   └── i18n.ts            Los textos del panel en cada idioma y los códigos de error del worker
│   └── ⚙️ worker/             Corre en Node: lo único que toca el disco
│       ├── worker.ts          Lee las bóvedas y contesta al panel
│       ├── vault.ts           Reglas de rutas: dentro de la bóveda, claves, orden,
│       │                      resolución de [[enlaces]], la URL de Obsidian
│       └── folder-picker.ts   El selector de carpetas del sistema
└── 🖼️ assets/
    ├── icon.png, cover.png
    └── draw-images.ps1        Dibuja los dos a partir de formas, sin capturas
```

Cada módulo tiene sus tests al lado (`*.test.ts`, `*.test.tsx`). El panel no puede importar
módulos de Node: todo lo que lee del disco se lo pide al worker por `src/protocol.ts`.

---

## 🛠 Desarrollo

No hay paso de compilación: Orca carga los `.ts` y `.tsx` tal cual.

```bash
npm install           # solo los tipos (TypeScript y @types/node)
npm run typecheck     # tsc, sin generar nada
npm test              # orca plugin test .
npm run check         # orca plugin check: dibuja cada escenario de src/panel/panel.check.ts
orca plugin dev watch . --check --shot .orca/shots   # recarga al guardar y saca capturas
```

> [!IMPORTANT]
> Los tests pueden pasar aunque el panel no se dibuje en Orca: comprueba cada cambio con
> `orca plugin shot` o en el propio panel.

Para volver a dibujar el icono y la portada:

```bash
powershell -NoProfile -File assets/draw-images.ps1
```

Añadir un idioma es una tabla más en `src/panel/i18n.ts`, con todas las claves de la inglesa.
