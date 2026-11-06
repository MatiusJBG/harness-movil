import QRCode from 'qrcode'
import type { AppSettings } from '../application/ports/settings.js'
import type { PairingTicket } from '../domain/pairing/pairing-ticket.js'

export interface StartupBannerInput {
  readonly settings: AppSettings
  readonly ticket: PairingTicket
  readonly version: string
}

/** Banner de arranque + QR de terminal. Vive en composición para no ensuciar main. */
export async function printStartupBanner(input: StartupBannerInput): Promise<void> {
  const { settings, ticket } = input
  const pairUrl = `${settings.network.publicUrl}_hm/#p=${ticket.secret}`
  const caUrl = `${settings.network.adminUrl}ca.cer`
  const caLanUrl = `${settings.network.publicUrl}_hm/ca.cer`
  console.log('')
  console.log('  Harness Móvil — puente listo')
  console.log('  ────────────────────────────────────────────────')
  console.log(`  Panel en la PC : ${settings.network.adminUrl}`)
  console.log(`  Panel en el tel: https://${settings.network.authority}/_hm/`)
  console.log(`  CA (PC)        : ${caUrl}`)
  console.log(`  CA (teléfono)  : ${caLanUrl}`)
  console.log(
    `  Código         : ${ticket.code}  (vence en ${String(Math.round(settings.pairing.ticketTtlSeconds / 60))} min)`,
  )
  console.log(`  Emparejar      : ${pairUrl}`)
  console.log('')
  try {
    const qr = await QRCode.toString(pairUrl, { type: 'terminal', small: true })
    console.log(qr)
  } catch {
    // Terminal sin soporte de QR: la URL alcanza.
  }
  console.log('')
}
