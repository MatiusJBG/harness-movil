'use strict'

const $ = (id) => document.getElementById(id)
const LABELS = {
  inactive: 'Desactivada',
  starting: 'Arrancando…',
  active: 'Activa',
  stopping: 'Deteniendo…',
  error: 'Error',
}

const state = {
  session: null,
  status: null,
  devices: [],
  pairing: null,
  diagnostics: null,
  busy: false,
}

let refreshing = false
let bannerTimer = null

function show(id, visible) {
  const node = $(id)
  if (node) node.hidden = !visible
}

function setText(id, text) {
  const node = $(id)
  if (node) node.textContent = text
}

function showBanner(text) {
  const node = $('banner')
  node.textContent = text
  node.hidden = false
  if (bannerTimer) clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => {
    node.hidden = true
  }, 5000)
}

function showError(text) {
  const node = $('error')
  node.textContent = text
  node.hidden = false
}

function clearError() {
  const node = $('error')
  node.hidden = true
  node.textContent = ''
}

async function api(path, options = {}) {
  const headers = { 'X-HM-CSRF': '1' }
  let body
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body,
    cache: 'no-store',
    credentials: 'same-origin',
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    const error = new Error((data && data.error) || `Error HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}

function deviceName() {
  const ua = navigator.userAgent || ''
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  const android = /Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|\))/.exec(ua)
  if (android && android[1]) return android[1].trim().slice(0, 40)
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'PC'
  return 'Teléfono'
}

function relativeTime(iso) {
  if (!iso) return 'nunca'
  const delta = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(delta)) return 'desconocido'
  const seconds = Math.round(delta / 1000)
  if (seconds < 60) return 'hace instantes'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `hace ${hours} h`
  return `hace ${Math.round(hours / 24)} días`
}

function render() {
  const session = state.session || { paired: false, admin: false, active: false, state: 'inactive' }
  const status = state.status
  const activationState = (status && status.state) || session.state || 'inactive'

  setText('status-pill', LABELS[activationState] || activationState)
  $('status-pill').dataset.state = activationState

  show('welcome', !session.paired && !session.admin)
  show('ca-card', !session.paired && !session.admin)
  show('pair-card', !session.paired && !session.admin)
  show('admin-pair-card', Boolean(session.admin))
  show('console', Boolean(session.paired || session.admin))
  show('devices-card', Boolean(session.paired || session.admin))
  show('admin-card', Boolean(session.admin))

  if (session.admin) {
    renderPairing()
    renderDiagnostics()
  } else if (session.paired) {
    show('admin-pair-card', false)
  }

  renderConnection(activationState, status)
  renderDevices(session)
  renderFooter(status)
  if (!session.admin) show('logout', Boolean(session.paired))
}

function renderConnection(activationState, status) {
  const detail = $('connection-detail')
  const activate = $('activate')
  const deactivate = $('deactivate')
  const open = $('open-harness')
  const activationError = $('activation-error')

  if (activationState === 'active') {
    const port = status && status.port ? `puerto interno ${status.port}` : 'host local'
    detail.textContent = `Conectado al host Harness de la PC (${port}). Este dispositivo puede usar toda la interfaz.`
  } else if (activationState === 'starting') {
    detail.textContent = 'Arrancando el host Harness en la PC. Puede tardar hasta un minuto…'
  } else if (activationState === 'stopping') {
    detail.textContent = 'Deteniendo el host Harness…'
  } else if (activationState === 'error') {
    detail.textContent = 'La conexión falló o el host Harness se cerró.'
  } else {
    detail.textContent = 'La conexión está desactivada. Al activarla, la PC arranca un host Harness dedicado.'
  }

  const starting = activationState === 'starting' || activationState === 'stopping'
  activate.disabled = state.busy || starting
  deactivate.disabled = state.busy || starting
  activate.hidden = activationState === 'active' || activationState === 'starting'
  deactivate.hidden = activationState !== 'active'
  open.hidden = activationState !== 'active'

  if (status && status.error) {
    activationError.textContent = status.error
    activationError.hidden = false
  } else {
    activationError.hidden = true
  }

  const sessions = $('sessions-detail')
  if (status && status.sessions) {
    sessions.hidden = false
    sessions.textContent =
      status.sessions.mode === 'shared'
        ? 'Sesiones compartidas con la app de escritorio: cerrá una sesión en escritorio antes de abrirla en el teléfono.'
        : 'El teléfono usa un historial de sesiones propio y aislado, así no choca con la app de escritorio.'
  } else {
    sessions.hidden = true
  }
}

function renderDevices(session) {
  const list = $('devices')
  list.textContent = ''
  if (state.devices.length === 0) {
    const item = document.createElement('li')
    item.textContent = 'Sin dispositivos activos.'
    list.appendChild(item)
    return
  }
  for (const device of state.devices) {
    const item = document.createElement('li')
    const meta = document.createElement('div')
    meta.className = 'device-meta'
    const name = document.createElement('span')
    name.className = 'device-name'
    name.textContent = device.name
    const sub = document.createElement('span')
    sub.className = 'device-sub'
    const self = session.device && session.device.id === device.id
    sub.textContent = `${self ? 'Este dispositivo · ' : ''}${relativeTime(device.lastSeenAt)}${
      device.lastIp ? ` · ${device.lastIp}` : ''
    }`
    meta.append(name, sub)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'revoke'
    button.textContent = self ? 'Olvidar' : 'Revocar'
    button.addEventListener('click', () => revokeDevice(device, self))
    item.append(meta, button)
    list.appendChild(item)
  }
}

function renderPairing() {
  const pairing = state.pairing
  if (!pairing) return
  $('pair-qr').src = pairing.qrDataUrl
  setText('pair-code-display', pairing.code)
  const expires = new Date(pairing.expiresAt).getTime() - Date.now()
  const minutes = Math.max(0, Math.ceil(expires / 60000))
  setText('pair-expiry', minutes > 0 ? `Vence en ${minutes} min` : 'Vencido: generá uno nuevo')
  const link = $('pair-link')
  link.href = pairing.url
  link.hidden = false
}

function renderDiagnostics() {
  const node = $('diagnostics')
  if (!state.diagnostics) {
    node.textContent = 'Cargando…'
    return
  }
  const d = state.diagnostics
  node.textContent = JSON.stringify(
    {
      version: d.version,
      node: d.node,
      plataforma: d.platform,
      perfil: d.profile,
      dsh: d.dshHome,
      bind: d.bind,
      admin: d.admin,
      certificado: d.tls,
    },
    null,
    2,
  )
}

function renderFooter(status) {
  if (status && status.version) setText('version', `v${status.version}`)
}

async function refresh() {
  if (refreshing) return
  refreshing = true
  try {
    state.session = await api('/_hm/api/session')
    if (state.session.paired || state.session.admin) {
      const [status, devices] = await Promise.all([api('/_hm/api/status'), api('/_hm/api/devices')])
      state.status = status
      state.devices = devices.devices || []
      if (state.session.admin) {
        state.pairing = await api('/_hm/api/pairing')
        if (!state.diagnostics) state.diagnostics = await api('/_hm/api/diagnostics')
      }
    } else {
      state.status = null
      state.devices = []
      state.pairing = null
    }
    clearError()
  } catch (error) {
    if (error.status !== 401) showError(error.message)
    else clearError()
  } finally {
    refreshing = false
    render()
  }
}

async function activate() {
  state.busy = true
  render()
  try {
    await api('/_hm/api/activate', { method: 'POST' })
    showBanner('Activando la conexión…')
  } catch (error) {
    showError(error.message)
  } finally {
    state.busy = false
    await refresh()
  }
}

async function deactivate() {
  if (!window.confirm('¿Desactivar la conexión con Harness?')) return
  state.busy = true
  render()
  try {
    await api('/_hm/api/deactivate', { method: 'POST' })
    showBanner('Conexión desactivada.')
  } catch (error) {
    showError(error.message)
  } finally {
    state.busy = false
    await refresh()
  }
}

async function revokeDevice(device, self) {
  const message = self
    ? '¿Olvidar este dispositivo? Vas a necesitar emparejarlo de nuevo.'
    : `¿Revocar "${device.name}"?`
  if (!window.confirm(message)) return
  try {
    await api(`/_hm/api/devices/${encodeURIComponent(device.id)}`, { method: 'DELETE' })
    if (self) {
      showBanner('Dispositivo olvidado.')
      state.session = null
      state.status = null
      state.devices = []
      state.pairing = null
    } else {
      showBanner('Dispositivo revocado.')
    }
  } catch (error) {
    showError(error.message)
  }
  await refresh()
}

async function logout() {
  if (!window.confirm('¿Olvidar este dispositivo?')) return
  try {
    await api('/_hm/api/logout', { method: 'POST' })
    showBanner('Dispositivo olvidado.')
    state.session = null
    state.status = null
    state.devices = []
  } catch (error) {
    showError(error.message)
  }
  await refresh()
}

async function submitPairing(code, name, secret) {
  const body = { code, name }
  if (secret) body.secret = secret
  const result = await api('/_hm/api/pair', { method: 'POST', body })
  showBanner(`Emparejado como ${result.device.name}.`)
  history.replaceState(null, '', '/_hm/')
  await refresh()
}

async function tryAutoPair() {
  if (!location.hash.startsWith('#')) return
  const params = new URLSearchParams(location.hash.slice(1))
  const secret = params.get('p')
  if (!secret) return
  if (!state.session || state.session.paired || state.session.admin) return
  showBanner('Emparejando este dispositivo…')
  try {
    await submitPairing('', deviceName(), secret)
  } catch (error) {
    showError(error.message)
  }
}

async function refreshPairing() {
  try {
    state.pairing = await api('/_hm/api/pairing/refresh', { method: 'POST' })
    render()
  } catch (error) {
    showError(error.message)
  }
}

function copyPairingLink() {
  if (!state.pairing) return
  const url = state.pairing.url
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      () => showBanner('Enlace copiado.'),
      () => showBanner(url),
    )
  } else {
    showBanner(url)
  }
}

function bindEvents() {
  $('pair-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const code = $('pair-code').value
    const name = $('pair-name').value || deviceName()
    const button = event.submitter || event.target.querySelector('button')
    if (button) button.disabled = true
    try {
      await submitPairing(code, name)
    } catch (error) {
      showError(error.message)
    } finally {
      if (button) button.disabled = false
    }
  })

  $('pair-refresh').addEventListener('click', refreshPairing)
  $('pair-link').addEventListener('click', (event) => {
    event.preventDefault()
    copyPairingLink()
  })
  $('activate').addEventListener('click', activate)
  $('deactivate').addEventListener('click', deactivate)
  $('logout').addEventListener('click', logout)

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh()
  })
}

async function boot() {
  bindEvents()
  $('pair-name').value = deviceName()
  await refresh()
  await tryAutoPair()
  setInterval(() => {
    if (!document.hidden) void refresh()
  }, 3000)
}

boot()
