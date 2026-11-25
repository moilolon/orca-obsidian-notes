# Obsidian Notes para Orca — Memoria del proyecto

Plugin de Orca que muestra una bóveda de Obsidian en la barra lateral: un panel de componentes
(`src/panel/`) y su worker de Node (`src/worker/`). Qué hace cada parte, cómo se instala y cómo
se desarrolla está en `README.md`.

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
  `README.md`, sección *Instalar*.
