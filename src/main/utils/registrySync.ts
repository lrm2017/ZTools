import { app } from 'electron'
import { exec } from 'child_process'

const UNINSTALL_KEY_PATHS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

function execAsync(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { encoding: 'utf-8', windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/**
 * Finds the registry subkey path where DisplayName matches the given product name.
 * Returns the full subkey path or null if not found.
 */
async function findUninstallKeyPath(productName: string): Promise<string | null> {
  for (const basePath of UNINSTALL_KEY_PATHS) {
    try {
      const output = await execAsync(
        `reg query "${basePath}" /s /v DisplayName /f "${productName}" /e`
      )
      const match = output.match(
        new RegExp(`^(${basePath.replace(/\\/g, '\\\\')}\\\\[^\\r\\n]+)`, 'm')
      )
      if (match) return match[1]
    } catch {
      // HKLM may fail without admin privileges; continue to next hive
    }
  }
  return null
}

async function getRegistryValue(keyPath: string, valueName: string): Promise<string | null> {
  try {
    const output = await execAsync(`reg query "${keyPath}" /v "${valueName}"`)
    const match = output.match(new RegExp(`${valueName}\\s+REG_SZ\\s+(.+)`))
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

async function setRegistryValue(
  keyPath: string,
  valueName: string,
  value: string
): Promise<boolean> {
  try {
    await execAsync(`reg add "${keyPath}" /v "${valueName}" /t REG_SZ /d "${value}" /f`)
    return true
  } catch {
    return false
  }
}

/**
 * Syncs the Windows registry DisplayVersion with the current app version.
 * This fixes the issue where in-app updates replace app.asar but leave
 * the NSIS-installed registry entry with the old version.
 */
export async function syncWindowsUninstallVersion(): Promise<void> {
  if (process.platform !== 'win32') return
  if (!app.isPackaged) return

  const currentVersion = app.getVersion()
  const productName = app.getName()

  try {
    const keyPath = await findUninstallKeyPath(productName)
    if (!keyPath) {
      console.log('[RegistrySync] No uninstall registry entry found (portable install?)')
      return
    }

    const registryVersion = await getRegistryValue(keyPath, 'DisplayVersion')
    if (registryVersion === currentVersion) return

    const success = await setRegistryValue(keyPath, 'DisplayVersion', currentVersion)
    if (success) {
      console.log(`[RegistrySync] Updated DisplayVersion: ${registryVersion} -> ${currentVersion}`)
    } else {
      console.warn('[RegistrySync] Failed to update DisplayVersion (insufficient permissions?)')
    }
  } catch (error) {
    console.error('[RegistrySync] Error syncing registry version:', error)
  }
}
