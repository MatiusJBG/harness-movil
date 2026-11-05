/** Cookie firmada del host Harness: vive solo en memoria de la PC. */
export interface SessionCookieStore {
  exchange(input: { port: number; token: string }): Promise<void>
  clear(): void
  header(): string | undefined
}
