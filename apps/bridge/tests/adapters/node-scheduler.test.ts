import { describe, expect, it } from '../helpers/testkit.js'
import { nodeScheduler } from '../../src/adapters/runtime/node-scheduler.js'

describe('temporizador real', () => {
  it('programa y cancela sin lanzar', () => {
    const handle = nodeScheduler.setInterval(() => undefined, 60_000)
    expect(handle !== null && handle !== undefined).toBe(true)
    nodeScheduler.clearInterval(handle)
  })
})
