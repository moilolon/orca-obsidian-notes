<div align="center">

# 📝 Obsidian Notes para Orca

**Tu bóveda de Obsidian en la barra lateral de Orca, con la nota abierta ocupando todo el panel**

[![Plugin de Orca](https://img.shields.io/badge/Orca-plugin-7C5CDC?style=for-the-badge)](https://github.com/stablyai/orca)
[![Sin compilación](https://img.shields.io/badge/TypeScript-sin%20compilaci%C3%B3n-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#-cómo-funciona)
[![Obsidian](https://img.shields.io/badge/Lee-bóvedas%20de%20Obsidian-7C3AED?style=for-the-badge&logo=obsidian&logoColor=white)](https://obsidian.md/)

<img src="assets/cover.png" alt="El nombre del plugin junto a un panel lateral con una nota cuyas secciones abren con bandas de color" width="820">

</div>

---

## ✨ Qué es

| | Función | Qué hace |
|---|---|---|
| 📖 | **Lectura a panel completo** | La nota abierta ocupa todo el panel; el árbol y la búsqueda se abren desde la barra |
| 🧾 | **El Markdown de Orca** | Listas anidadas, enlaces, tablas, código y casillas |
| 🪨 | **Entiende Obsidian** | Oculta el front matter, dibuja los avisos y lista los `[[enlaces]]` como botones que los abren |
| 🎨 | **Secciones que se distinguen** | Cada `##` abre con una banda de su color, y sus subtítulos van en ese color |
| 🗂️ | **Varias bóvedas** | Se añaden con el selector de carpetas o pegando la ruta, y se cambia de una a otra |
| 🔎 | **Búsqueda** | Por nombre y por contenido |
| ↗️ | **Abrir en Obsidian** | Abre la nota en la app, aunque la carpeta añadida sea una subcarpeta de la bóveda |
| 🌍 | **En el idioma de Orca** | Inglés o español |

---

## 🧭 Cómo funciona

- **Dos partes.** El panel corre dentro de Orca, sin acceso al disco; el worker corre en
  Node y es lo único que lee las bóvedas. Hablan por un contrato en `src/protocol.ts`.
- **Sin compilación.** Orca carga los `.ts` y `.tsx` tal cual; `node_modules` solo trae
  los tipos de desarrollo.
- **Copia fija.** Orca instala una copia de la carpeta, así que un cambio solo llega al
  volver a instalar. Los tests pueden pasar aunque el panel no se dibuje: cada cambio se
  mira en el propio panel o con `orca plugin shot`.

---

## 🔐 Qué toca

- **Solo lectura.** Nunca escribe en una bóveda; lo único que guarda es la lista de bóvedas.
- **Solo las bóvedas añadidas.** El worker rechaza cualquier ruta que se salga de una.
- **Nada sale del equipo.** No hace llamadas de red.

---

## 🚀 Puesta en marcha

Desde la carpeta del repositorio, con `node_modules` fuera:

```bash
orca plugin install .
```

Orca enseña los permisos y el comando para aprobarlos. Después se abre el panel
**Obsidian** en la barra lateral derecha y se elige la carpeta de la bóveda en los ajustes.

---

<div align="center">
<sub><a href="https://moilolon.com">moilolon.com</a> · <a href="https://github.com/moilolon">@moilolon</a></sub>
</div>
