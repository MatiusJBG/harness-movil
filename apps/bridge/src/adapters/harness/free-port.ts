import { createServer } from 'node:net'

/** Reserva un puerto loopback efímero y lo libera justo antes de que dsh lo use. */
export function pickFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => {
        if (port > 0) resolve(port)
        else reject(new Error('No se pudo reservar un puerto loopback'))
      })
    })
  })
}
