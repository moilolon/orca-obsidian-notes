// The panel's texts in each language Orca can show it in. English is the fallback: a locale
// whose language has no table here reads English. No imports, so the panel and tests load it.

const en = {
  toolbar: 'Notes',
  treeButton: 'Notes',
  treeTooltip: 'Notes tree',
  searchButton: 'Search',
  noteButton: 'Note',
  noteTooltip: 'Back to the note',
  openInObsidian: 'Open in Obsidian',
  reload: 'Reload',
  retry: 'Try again',
  vaultsButton: 'Vaults',
  vaultSelect: 'Vault',
  errorTitle: 'Something went wrong',
  addVaultTitle: 'Add a vault',
  addVaultDescription: 'Pick a folder of notes, such as your Obsidian vault.',
  useVault: 'Use {name}',
  useVaultTooltip: 'Open this vault',
  removeVault: 'Remove {name}',
  removeVaultTooltip: 'Remove from the list (deletes nothing)',
  folderPath: 'Folder path',
  folderPlaceholder: 'C:\\path\\to\\vault',
  add: 'Add',
  browse: 'Browse…',
  orPastePath: 'or paste its path',
  addAnotherVault: 'Add another vault',
  readingVault: 'Reading the vault',
  noNotesTitle: 'No notes',
  noNotesDescription: 'This folder has no .md files.',
  notesTree: 'Notes tree',
  truncated: 'This vault is very large: only the first {count} entries are listed.',
  searchLabel: 'Search',
  searchPlaceholder: 'Search names and text',
  noResults: 'No results.',
  results: 'Results',
  chooseNoteTitle: 'Pick a note',
  chooseNoteDescription: 'Open one from the tree or the search.',
  backlinks: 'Linked from',
  linkMissing: 'There is no such note in this vault',
  properties: 'Properties',
  propertiesCount: 'Properties ({count})',
  loadingImage: 'Loading the image',
  searchTruncated: 'Only the first {count} results are shown.',
  noLinkedNote: 'There is no note "{target}" in this vault',
  notAFolder: 'That path is not a folder',
  notAVault: 'That folder is not in the vault list',
  notANote: 'That file is not a note in this vault',
  noteTooLarge: 'The note is larger than 1 MiB',
  noteMissing: 'That note no longer exists',
  pickerUnavailable: 'The folder dialog is not available on this system: paste the path instead'
}

export type MessageKey = keyof typeof en

const es: Record<MessageKey, string> = {
  toolbar: 'Notas',
  treeButton: 'Notas',
  treeTooltip: 'Árbol de notas',
  searchButton: 'Buscar',
  noteButton: 'Nota',
  noteTooltip: 'Volver a la nota',
  openInObsidian: 'Abrir en Obsidian',
  reload: 'Recargar',
  retry: 'Reintentar',
  vaultsButton: 'Bóvedas',
  vaultSelect: 'Bóveda',
  errorTitle: 'Algo ha fallado',
  addVaultTitle: 'Añade una bóveda',
  addVaultDescription: 'Elige una carpeta de notas, por ejemplo tu bóveda de Obsidian.',
  useVault: 'Usar {name}',
  useVaultTooltip: 'Abrir esta bóveda',
  removeVault: 'Quitar {name}',
  removeVaultTooltip: 'Quitar de la lista (no borra nada)',
  folderPath: 'Ruta de la carpeta',
  folderPlaceholder: 'C:\\ruta\\a\\la\\bóveda',
  add: 'Añadir',
  browse: 'Examinar…',
  orPastePath: 'o pega su ruta',
  addAnotherVault: 'Añadir otra bóveda',
  readingVault: 'Leyendo la bóveda',
  noNotesTitle: 'No hay notas',
  noNotesDescription: 'Esta carpeta no tiene ficheros .md.',
  notesTree: 'Árbol de notas',
  truncated: 'La bóveda es muy grande: solo se listan las primeras {count} entradas.',
  searchLabel: 'Buscar',
  searchPlaceholder: 'Buscar en nombre y contenido',
  noResults: 'Sin resultados.',
  results: 'Resultados',
  chooseNoteTitle: 'Elige una nota',
  chooseNoteDescription: 'Ábrela desde el árbol o la búsqueda.',
  backlinks: 'Enlazada desde',
  linkMissing: 'No hay ninguna nota así en esta bóveda',
  properties: 'Propiedades',
  propertiesCount: 'Propiedades ({count})',
  loadingImage: 'Cargando la imagen',
  searchTruncated: 'Solo se muestran los primeros {count} resultados.',
  noLinkedNote: 'No hay ninguna nota "{target}" en esta bóveda',
  notAFolder: 'Esa ruta no es una carpeta',
  notAVault: 'Esa carpeta no está en la lista de bóvedas',
  notANote: 'Ese fichero no es una nota de esta bóveda',
  noteTooLarge: 'La nota ocupa más de 1 MiB',
  noteMissing: 'Esa nota ya no existe',
  pickerUnavailable: 'El selector de carpetas no está disponible en este sistema: pega la ruta'
}

const TABLES: Record<string, Record<MessageKey, string>> = { en, es }

/** The table for a BCP-47 locale (`es-ES`, `en`), by its language; English when there is none. */
export function messagesFor(locale: string): Record<MessageKey, string> {
  const language = String(locale || '').toLowerCase().split(/[-_]/)[0]
  return TABLES[language] || en
}

/** A message with its `{name}` placeholders filled in. */
export function format(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
}

/** Worker errors travel as their code; these are the ones the panel knows how to word. */
export const WORKER_ERRORS: Record<string, MessageKey> = {
  not_a_folder: 'notAFolder',
  not_a_vault: 'notAVault',
  not_a_note: 'notANote',
  note_too_large: 'noteTooLarge',
  note_missing: 'noteMissing',
  picker_unavailable: 'pickerUnavailable'
}
