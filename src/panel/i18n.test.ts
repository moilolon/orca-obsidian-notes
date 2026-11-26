import { assert, test } from 'orca/testing'
import { format, messagesFor, WORKER_ERRORS } from './i18n'

test('picks the table by language and falls back to English', () => {
  assert.equal(messagesFor('es-ES').add, 'Añadir')
  assert.equal(messagesFor('es').add, 'Añadir')
  assert.equal(messagesFor('en-GB').add, 'Add')
  assert.equal(messagesFor('fr-FR').add, 'Add')
  assert.equal(messagesFor('').add, 'Add')
})

test('every language has every message', () => {
  const keys = Object.keys(messagesFor('en')).sort()
  assert.deepEqual(Object.keys(messagesFor('es')).sort(), keys)
})

test('fills placeholders and leaves unknown ones alone', () => {
  assert.equal(format('Remove {name}', { name: 'Work' }), 'Remove Work')
  assert.equal(format('Only {count} of {total}', { count: 4 }), 'Only 4 of {total}')
})

test('words every worker error code', () => {
  const en = messagesFor('en')
  for (const key of Object.values(WORKER_ERRORS)) assert.ok(en[key], key)
})
