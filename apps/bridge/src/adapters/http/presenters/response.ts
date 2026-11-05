import type { ServerResponse } from 'node:http'

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  })
  res.end(payload)
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  })
  res.end(body)
}

export function sendBytes(
  res: ServerResponse,
  status: number,
  body: Uint8Array,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-length': body.byteLength,
    ...extraHeaders,
  })
  res.end(body)
}

export function redirect(res: ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { location, 'cache-control': 'no-store', 'content-length': 0 })
  res.end()
}

export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string }
}

export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  const body: ErrorBody = { error: { code, message } }
  sendJson(res, status, body)
}
