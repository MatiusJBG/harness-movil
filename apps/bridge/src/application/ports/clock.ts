/** Reloj inyectable: el dominio y los casos de uso nunca leen la hora global. */
export interface Clock {
  now(): Date
  nowMs(): number
}
