// @ts-nocheck
// Minimal Vitest-compatible facade over node:test, used because the DSH file
// sandbox blocks the child-process spawn that Vite/esbuild needs.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

class AssertionFailure extends Error {
  constructor(message) {
    super(message)
    this.name = 'AssertionFailure'
  }
}

function describeValue(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function expect(actual) {
  return new Expectation(actual, false)
}

class Expectation {
  constructor(actual, negated) {
    this.actual = actual
    this.negated = negated
  }

  get not() {
    return new Expectation(this.actual, !this.negated)
  }

  _check(passed, message) {
    const ok = this.negated ? !passed : passed
    if (!ok) {
      throw new AssertionFailure(`${this.negated ? 'NOT ' : ''}${message}`)
    }
  }

  toBe(expected) {
    this._check(Object.is(this.actual, expected), `expected ${describeValue(this.actual)} to be ${describeValue(expected)}`)
  }

  toEqual(expected) {
    let passed = true
    try {
      assert.deepStrictEqual(this.actual, expected)
    } catch {
      passed = false
    }
    this._check(passed, `expected ${describeValue(this.actual)} to equal ${describeValue(expected)}`)
  }

  toContain(expected) {
    const passed =
      typeof this.actual === 'string'
        ? this.actual.includes(expected)
        : Array.isArray(this.actual)
          ? this.actual.includes(expected)
          : false
    this._check(passed, `expected ${describeValue(this.actual)} to contain ${describeValue(expected)}`)
  }

  toMatch(pattern) {
    const passed = typeof this.actual === 'string' && (pattern instanceof RegExp ? pattern.test(this.actual) : this.actual.includes(pattern))
    this._check(passed, `expected ${describeValue(this.actual)} to match ${String(pattern)}`)
  }

  toBeNull() {
    this._check(this.actual === null, `expected ${describeValue(this.actual)} to be null`)
  }

  toBeUndefined() {
    this._check(this.actual === undefined, `expected ${describeValue(this.actual)} to be undefined`)
  }

  toBeTruthy() {
    this._check(Boolean(this.actual), `expected ${describeValue(this.actual)} to be truthy`)
  }

  toBeGreaterThan(expected) {
    this._check(this.actual > expected, `expected ${describeValue(this.actual)} > ${describeValue(expected)}`)
  }

  toBeGreaterThanOrEqual(expected) {
    this._check(this.actual >= expected, `expected ${describeValue(this.actual)} >= ${describeValue(expected)}`)
  }

  toHaveLength(expected) {
    this._check(
      this.actual != null && typeof this.actual.length === 'number' && this.actual.length === expected,
      `expected length ${expected}, got ${this.actual?.length}`,
    )
  }

  toBeInstanceOf(expected) {
    this._check(this.actual instanceof expected, `expected instance of ${expected.name}`)
  }

  toHaveBeenCalled() {
    const calls = this.actual?.mock?.calls?.length ?? 0
    this._check(calls > 0, 'expected function to have been called')
  }

  toHaveBeenCalledTimes(expected) {
    const calls = this.actual?.mock?.calls?.length ?? 0
    this._check(calls === expected, `expected ${expected} calls, got ${calls}`)
  }

  toMatchObject(expected) {
    let passed = true
    try {
      assert.partialDeepStrictEqual(this.actual, expected)
    } catch {
      passed = false
    }
    this._check(passed, `expected ${describeValue(this.actual)} to match object ${describeValue(expected)}`)
  }

  toHaveBeenCalledWith(...expected) {
    const calls = this.actual?.mock?.calls ?? []
    const passed = calls.some((call) => {
      try {
        assert.deepStrictEqual(call, expected)
        return true
      } catch {
        return false
      }
    })
    this._check(passed, `expected call with ${describeValue(expected)}`)
  }

  toThrow(expected) {
    let error = null
    try {
      this.actual()
    } catch (thrown) {
      error = thrown
    }
    if (error === null) {
      this._check(false, 'expected function to throw')
      return
    }
    let passed = true
    if (expected !== undefined) {
      if (expected instanceof RegExp) passed = expected.test(String(error.message ?? error))
      else if (typeof expected === 'string') passed = String(error.message ?? error).includes(expected)
      else if (typeof expected === 'function') passed = error instanceof expected
    }
    this._check(passed, `expected thrown error to match ${String(expected)}; got ${String(error?.message)}`)
  }

  get rejects() {
    return new AsyncExpectation(this.actual, 'rejects', this.negated)
  }

  get resolves() {
    return new AsyncExpectation(this.actual, 'resolves', this.negated)
  }
}

class AsyncExpectation {
  constructor(promise, mode, negated) {
    this.promise = promise
    this.mode = mode
    this.negated = negated
  }

  async _run(check) {
    let value
    let error = null
    try {
      value = await this.promise
    } catch (thrown) {
      error = thrown
    }
    if (this.mode === 'rejects') {
      if (error === null) {
        if (this.negated) return
        throw new AssertionFailure('expected promise to reject')
      }
      if (this.negated) throw new AssertionFailure(`expected promise not to reject, got ${String(error?.message)}`)
      await check(error)
      return
    }
    if (error !== null) throw new AssertionFailure(`expected promise to resolve, got ${String(error?.message)}`)
    await check(value)
  }

  toBeInstanceOf(expected) {
    return this._run((value) => {
      if (!(value instanceof expected)) throw new AssertionFailure(`expected instance of ${expected.name}`)
    })
  }

  toBeTruthy() {
    return this._run((value) => {
      if (!value) throw new AssertionFailure(`expected truthy, got ${describeValue(value)}`)
    })
  }

  toEqual(expected) {
    return this._run((value) => {
      try {
        assert.deepStrictEqual(value, expected)
      } catch {
        throw new AssertionFailure(`expected ${describeValue(value)} to equal ${describeValue(expected)}`)
      }
    })
  }

  toThrow(expected) {
    return this._run((error) => {
      let passed = true
      if (expected instanceof RegExp) passed = expected.test(String(error?.message ?? error))
      else if (typeof expected === 'string') passed = String(error?.message ?? error).includes(expected)
      else if (typeof expected === 'function') passed = error instanceof expected
      if (!passed) throw new AssertionFailure(`expected rejection to match ${String(expected)}`)
    })
  }
}

function createMock(implementation) {
  const calls = []
  const mock = (...args) => {
    calls.push(args)
    if (typeof implementation === 'function') return implementation(...args)
    return undefined
  }
  mock.mock = { calls }
  return mock
}

export const vi = {
  fn(implementation: any = undefined) {
    return createMock(implementation)
  },
  async waitFor(callback, options = {}) {
    const timeout = options.timeout ?? 1_500
    const interval = options.interval ?? 10
    const started = Date.now()
    let lastError = null
    while (Date.now() - started < timeout) {
      try {
        await callback()
        return
      } catch (error) {
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, interval))
      }
    }
    throw lastError ?? new AssertionFailure('waitFor timed out')
  },
}

export { afterEach, beforeEach, describe, it }
export const test = it
