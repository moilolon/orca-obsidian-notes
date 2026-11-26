# Obsidian Notes for Orca — Project Memory

Orca plugin that shows an Obsidian vault in the sidebar: a components panel (`src/panel/`) and
its Node worker (`src/worker/`).

`README.md` is the cover for visitors, laid out like every moilolon repo: *What this is*, *How
it works*, *Getting started* and the shared footer, with no folder tree, long code or roadmap.
The details below are for Claude.

## Structure

- `orca-plugin.json`: the manifest (panel, worker, icon and cover; access `trusted-worker` and
  `storage:own`). The repo has the GitHub topic `orca-plugin`, so the Orca Community Plugins
  catalog lists each version tag (`vX.Y.Z`) on its own; a listed version never changes.
- `src/protocol.ts`: the contract between panel and worker. The panel cannot import Node
  modules: everything it reads from disk it asks the worker for.
- `src/panel/`: `panel.tsx` (toolbar, tree, search, vaults and the note), `panel.check.ts` (the
  scenarios of `orca plugin check`), `markdown.ts` (properties, comments, callouts, links,
  headings and their colors, tasks, which the panel draws with components because Orca's
  `Markdown` gives them a bullet, and pieces under 16 KiB) and `i18n.ts` (texts per language and
  the worker's error codes; a new language is a table with every key of the English one).
- `src/worker/`: `worker.ts` (reads the vaults, watches them with `fs.watch`, tells the panel
  with `notes.changed` and answers; imports `markdown.ts` for the backlinks; copies the images
  to `cache/` of the installed plugin, because Orca's `Image` only shows the plugin's own files,
  and it does serve those that appear after installing), `vault.ts` (paths inside the vault,
  ordering, link resolution, the Obsidian URL) and `folder-picker.ts` (PowerShell on Windows,
  `osascript` on macOS, `zenity` on Linux).
- Each module has its tests next to it (`*.test.ts`, `*.test.tsx`).
- `assets/draw-images.ps1` (`powershell -NoProfile -File assets/draw-images.ps1`) draws, from
  shapes, `icon.png` (the plugin's and the project's icon in Orca), `cover.png` (also the
  plugin's cover) and the GitHub social preview (`social-preview.png`, uploaded by hand in
  Settings). The base is shared by every repo (the one in `moilolon/workbench`); only the repo's
  own part changes here. It is saved as UTF-8 with BOM, or PowerShell 5.1 breaks the accents.

## Development

```bash
npm install           # only the types (TypeScript and @types/node)
npm run typecheck     # tsc, emitting nothing
npm test              # orca plugin test .
npm run check         # orca plugin check: renders each scenario of panel.check.ts
orca plugin dev watch . --check --shot .orca/shots   # reloads on save and takes shots
powershell -NoProfile -File assets/draw-images.ps1   # redraws the icon, cover and preview
```

The tests can pass with a blank panel: check each change with `orca plugin shot` or in the
panel itself.

`.github/workflows/checks.yml` runs the types, the tests and `orca plugin check` on every pull
request (Dependabot's too) with the Orca CLI of the latest release (its Linux package). The
job is `checks`, the status the `main` ruleset requires.

## Git

- **Commits:** English, imperative, sentence case, one line of at most 72 characters with no
  prefix and no trailing period (`Center the section title in its color band`). A body only
  when the why is not obvious: a blank line, then lines wrapped at 72. No `Co-Authored-By` or
  other attribution.
- **Branches:** `<type>/<short-description>`, lowercase kebab-case, off `main`. Types: `feature`,
  `bugfix`, `docs`, `refactor`, `chore`.
- **Pull requests:** title like a commit; body with *What changes*, *Why* and *How to check it*.
  Merged by squash, with the PR title and body as the commit.
- **Versions:** a version bump is its own PR (`Bump the version to X.Y.Z`), then an annotated
  tag `vX.Y.Z` on its commit and a GitHub release with the changes. Check that `main` already
  has the new version before tagging: the catalog never accepts a moved tag. The Orca
  Community Plugins catalog lists the tag on its next run, as `moilolon.notes`.
- **In Orca**, the plugin runs from this folder as a development plugin (`orca plugin dev load .`,
  `local.notes`): Orca reloads it on every file change, so what the main checkout has, its
  branch and its uncommitted edits, is what runs; nothing needs reinstalling. New access needs a
  new approval. Do not install `moilolon.notes` next to it: Orca would show two *Obsidian*
  panels.
- **`gh`:** always as `GH_TOKEN=$(gh auth token --user moilolon) gh …`, command by command. gh's
  active account is the work one, which must not act on this repo; do not switch it. `git`
  already uses `moilolon` through the `includeIf` of `C:/Developer/PERSONAL/`.
