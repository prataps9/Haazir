import { describe, expect, it } from 'vitest'
import { EnvError, parseEnv } from '../env'

const valid = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:5173',
  API_URL: 'http://localhost:4000',
  DATABASE_URL: 'postgres://haazir:haazir@localhost:5432/haazir',
  REDIS_URL: 'redis://localhost:6379',
}

const key32 = Buffer.alloc(32, 7).toString('base64')

describe('parseEnv', () => {
  it('accepts the minimal development set and applies defaults', () => {
    const env = parseEnv(valid)
    expect(env.LOG_LEVEL).toBe('info')
    expect(env.LLM_PROVIDER).toBe('openai')
    expect(env.EMBEDDING_MODEL).toBe('text-embedding-3-small')
  })

  it('treats empty KEY= lines as unset', () => {
    const env = parseEnv({ ...valid, META_APP_SECRET: '', ENCRYPTION_KEY: '  ' })
    expect(env.META_APP_SECRET).toBeUndefined()
    expect(env.ENCRYPTION_KEY).toBeUndefined()
  })

  it('lists every problem at once, by variable name', () => {
    try {
      parseEnv({ NODE_ENV: 'development', APP_URL: 'not a url' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError)
      const issues = (error as EnvError).issues.join('\n')
      expect(issues).toMatch(/APP_URL/)
      expect(issues).toMatch(/API_URL/)
      expect(issues).toMatch(/DATABASE_URL/)
      expect(issues).toMatch(/REDIS_URL/)
    }
  })

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() => parseEnv({ ...valid, ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/ENCRYPTION_KEY/)
    expect(parseEnv({ ...valid, ENCRYPTION_KEY: key32 }).ENCRYPTION_KEY).toBe(key32)
  })

  it('requires data-protecting secrets in production', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
      /ENCRYPTION_KEY is required in production[\s\S]*BETTER_AUTH_SECRET is required/,
    )
    expect(() =>
      parseEnv({
        ...valid,
        NODE_ENV: 'production',
        ENCRYPTION_KEY: key32,
        BETTER_AUTH_SECRET: 'x',
      }),
    ).not.toThrow()
  })

  it('keeps quiet hours on, and refuses to turn them off in production', () => {
    expect(parseEnv(valid).QUIET_HOURS_OFF).toBe(false)
    expect(parseEnv({ ...valid, QUIET_HOURS_OFF: 'true' }).QUIET_HOURS_OFF).toBe(true)
    expect(() =>
      parseEnv({
        ...valid,
        NODE_ENV: 'production',
        ENCRYPTION_KEY: key32,
        BETTER_AUTH_SECRET: 'x',
        QUIET_HOURS_OFF: 'true',
      }),
    ).toThrow(/QUIET_HOURS_OFF is for testing only/)
  })

  it('rejects unknown enum values', () => {
    expect(() => parseEnv({ ...valid, LLM_PROVIDER: 'cohere' })).toThrow(/LLM_PROVIDER/)
  })
})
