import { wireApplication, type WiredApplication, type WiringOptions } from './wiring.js'

/** Alias histórico del grafo: `wireApplication` es la implementación única. */
export type BuildApplicationOptions = WiringOptions
export type BuiltApplication = WiredApplication

export async function buildApplication(options: BuildApplicationOptions): Promise<BuiltApplication> {
  return wireApplication(options)
}
