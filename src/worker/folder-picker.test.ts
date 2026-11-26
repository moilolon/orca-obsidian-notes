import { assert, test } from 'orca/testing'
import { pickedPath, pickerCommand } from './folder-picker'

test('uses the folder dialog of each platform', () => {
  const windows = pickerCommand('win32')
  assert.equal(windows.command, 'powershell.exe')
  assert.ok(windows.args.includes('-STA'))
  assert.ok(windows.args.join(' ').includes('FolderBrowserDialog'))
  assert.deepEqual(pickerCommand('darwin'), { command: 'osascript', args: ['-e', 'POSIX path of (choose folder)'] })
  assert.equal(pickerCommand('linux').command, 'zenity')
})

test('reads a chosen path and treats an empty answer as a cancel', () => {
  assert.equal(pickedPath('C:\\Vaults\\Notes\r\n'), 'C:\\Vaults\\Notes')
  assert.equal(pickedPath(''), null)
  assert.equal(pickedPath('  \n'), null)
})
