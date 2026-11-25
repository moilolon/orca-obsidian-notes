<div align="center">

# 📝 Obsidian Notes for Orca

**Your Obsidian vault in Orca's sidebar, with the open note filling the panel**

[![Orca plugin](https://img.shields.io/badge/Orca-plugin-7C5CDC?style=for-the-badge)](https://github.com/stablyai/orca)
[![No build](https://img.shields.io/badge/TypeScript-no%20build-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#-development)
[![Obsidian](https://img.shields.io/badge/Reads-Obsidian%20vaults-7C3AED?style=for-the-badge&logo=obsidian&logoColor=white)](https://obsidian.md/)
[![Read only](https://img.shields.io/badge/Vaults-read%20only-2EA043?style=for-the-badge)](#-what-it-touches)

<img src="assets/cover.png" alt="The plugin name beside a sidebar panel showing a note whose sections open on colored bands" width="820">

[Features](#-features) ·
[Install](#-install) ·
[What it touches](#-what-it-touches) ·
[Structure](#-structure) ·
[Development](#-development)

</div>

---

## ✨ Features

| | Feature | What it does |
|---|---|---|
| 📖 | **Full-panel reading** | The open note takes the whole panel; the tree and the search open from the toolbar and step aside when you open a note |
| 🧾 | **Orca's own Markdown** | Nested lists, links, tables, code and checkboxes, drawn by Orca's Markdown component |
| 🪨 | **Speaks Obsidian** | Hides the YAML front matter, draws callouts (`> [!warning] …`) as callouts, and lists the note's `[[links]]` as buttons that open them |
| 🎨 | **Sections that stand apart** | Each `##` opens on a band of its own color with room above; `###` and `####` take their section's color, each level smaller |
| 🗂️ | **Several vaults** | Added through the system folder dialog (**Browse…**) or by pasting a path, and switched with a drop-down |
| 🔎 | **Search** | Finds notes by name and by text |
| ↗️ | **Open in Obsidian** | Opens the note through `obsidian://open?path=…`, so it works even when the added folder is a subfolder of the vault |
| 🌍 | **In Orca's language** | English, or Spanish when Orca is in Spanish |

Based on the idea of [Obsidian for Orca](https://github.com/vrwolf1004/orca-obsidian) by
vrwolf1004 (MIT), rewritten as a panel of Orca's native components.

---

## 🚀 Install

From the repository folder:

```bash
orca plugin install .
```

Orca shows the access the plugin asks for and a command with `--approve <fingerprint>` to
grant it. Then open the **Obsidian** panel in Orca's right sidebar, press the settings
button and pick the vault folder with **Browse…**, or paste its path.

> [!TIP]
> Orca installs a fixed copy of the folder, so a code change reaches it only after
> `orca plugin install .` again. Move `node_modules` (development typings only) out of the
> folder first, or the copy carries it. When the access does not change, Orca keeps the
> approval.

---

## 🔐 What it touches

| Grant | Why |
|---|---|
| **trusted-worker** | The worker (`src/worker/worker.ts`) runs in a Node process with your user's access, because it reads the note folders |
| **storage:own** | Keeps the list of vaults |

- **Read only.** It never writes to a vault; the only thing it stores is the vault list.
- **Only the vaults you add.** The worker refuses any folder that is not on the list, and
  any path that climbs out of one.
- **The folder dialog** is the system's, opened by the worker: PowerShell on Windows,
  `osascript` on macOS and `zenity` on Linux. Where it is missing, paste the path.
- **Nothing leaves the machine.** No network calls.

---

## 📁 Structure

```text
orca-obsidian-notes/
├── 🧩 orca-plugin.json        Manifest: the panel and the worker, the icon and the cover
├── 📜 src/
│   ├── 🤝 protocol.ts         The contract between panel and worker
│   ├── 🪟 panel/              Runs in Orca's panel, with no access to Node
│   │   ├── panel.tsx          The panel: toolbar, tree, search, vaults and the note
│   │   ├── panel.check.ts     The scenarios `orca plugin check` draws
│   │   ├── markdown.ts        An Obsidian note as Orca's Markdown: front matter, callouts,
│   │   │                      [[links]], headings and their colors, chunks under 16 KiB
│   │   └── i18n.ts            The panel's texts per language, and the worker's error codes
│   └── ⚙️ worker/             Runs in Node: the only part that touches the disk
│       ├── worker.ts          Reads the vaults and answers the panel
│       ├── vault.ts           Path rules: inside the vault, keys, order, [[link]] lookup,
│       │                      the Obsidian URL
│       └── folder-picker.ts   The system folder dialog
└── 🖼️ assets/
    ├── icon.png, cover.png
    └── draw-images.ps1        Draws both from shapes, with no screenshot
```

Each module has its tests next to it (`*.test.ts`, `*.test.tsx`). The panel cannot import
Node modules: everything it reads from disk it asks the worker for, through
`src/protocol.ts`.

---

## 🛠 Development

There is no build step: Orca loads the `.ts` and `.tsx` files as they are.

```bash
npm install           # typings only (TypeScript and @types/node)
npm run typecheck     # tsc, no output
npm test              # orca plugin test .
npm run check         # orca plugin check: draws each scenario of src/panel/panel.check.ts
orca plugin dev watch . --check --shot .orca/shots   # reloads on save and takes screenshots
```

> [!IMPORTANT]
> The tests can pass while the panel does not draw in Orca: check each change with
> `orca plugin shot` or in the panel itself.

To redraw the icon and the cover:

```bash
powershell -NoProfile -File assets/draw-images.ps1
```

Adding a language is one more table in `src/panel/i18n.ts`, with every key of the English one.
