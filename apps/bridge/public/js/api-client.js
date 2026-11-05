export class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Cliente de la API v1 del panel: CSRF en mutaciones, errores uniformes
 * (`{ error: { code, message } }`) y sin caché.
 */
export function createApiClient() {
  const request = async (path, options = {}) => {
    const method = options.method || 'GET'
    const headers = {}
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (method !== 'GET') headers['X-HM-CSRF'] = '1'
    const response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
      const payload = data && data.error ? data.error : null
      throw new ApiError(
        (payload && payload.message) || `Error HTTP ${response.status}`,
        response.status,
        (payload && payload.code) || null,
      )
    }
    return data
  }

  return {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    del: (path) => request(path, { method: 'DELETE' }),
  }
}
