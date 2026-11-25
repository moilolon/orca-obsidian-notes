// The operating system's folder dialog, for the worker: Orca gives plugins no folder picker.
// Resolves to the chosen folder, or null when the person cancels.
import { execFile } from 'node:child_process'

/** How long the dialog may stay open before the worker gives up on it. */
const PICKER_TIMEOUT_MS = 115000

// PowerShell's own folder dialog. The owner form keeps it in front of Orca; UTF-8 output keeps
// accented paths intact.
const WINDOWS_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.ShowNewFolderButton = $false',
  "if ($dialog.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($dialog.SelectedPath) }",
  '$owner.Dispose()'
].join('; ')

type PickerCommand = { command: string; args: string[] }

/** The dialog command for a platform; a cancel prints nothing on every one of them. */
export function pickerCommand(platform: string): PickerCommand {
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoProfile', '-STA', '-Command', WINDOWS_SCRIPT] }
  if (platform === 'darwin') return { command: 'osascript', args: ['-e', 'POSIX path of (choose folder)'] }
  return { command: 'zenity', args: ['--file-selection', '--directory'] }
}

/** The chosen path as the dialog printed it, or null for a cancel (an empty answer). */
export function pickedPath(output: string): string | null {
  const path = output.trim()
  return path ? path : null
}

function unavailable(): Error {
  return Object.assign(new Error('picker_unavailable'), { code: 'invalid_params' })
}

export function pickFolder(platform: string = process.platform): Promise<string | null> {
  const { command, args } = pickerCommand(platform)
  return new Promise((resolvePick, rejectPick) => {
    execFile(command, args, { timeout: PICKER_TIMEOUT_MS, windowsHide: false, encoding: 'utf8' }, (error, stdout) => {
      const missing = error && (error as NodeJS.ErrnoException).code === 'ENOENT'
      if (missing) return rejectPick(unavailable())
      // A cancel exits non-zero on macOS and Linux: it is still a cancel, not a failure.
      resolvePick(pickedPath(String(stdout || '')))
    })
  })
}
