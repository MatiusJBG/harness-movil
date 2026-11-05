import type { Server } from 'node:http'

export async function listen(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`El puerto ${String(port)} ya está en uso. Cambialo en config.json y volvé a intentar.`))
        return
      }
      if (error.code === 'EACCES') {
        reject(new Error(`No hay permiso para escuchar en ${host}:${String(port)}.`))
        return
      }
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

export async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
}
