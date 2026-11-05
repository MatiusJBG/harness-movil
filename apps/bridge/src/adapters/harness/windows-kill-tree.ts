import { spawn } from 'node:child_process'

/** En Windows mata el árbol completo (`taskkill /T /F`); en POSIX, SIGTERM. */
export async function killTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    process.kill(pid, 'SIGTERM')
    return
  }
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.once('exit', () => {
      resolve()
    })
    killer.once('error', () => {
      resolve()
    })
  })
}
