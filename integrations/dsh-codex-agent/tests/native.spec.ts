import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadNativeCoreFactory } from '../src/native.js'

const stateDirs: string[] = []
afterEach(async () => {
  for (const directory of stateDirs.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('native N-API boundary', () => {
  it('runs in-process against Chat Completions and returns structured events', async () => {
    let authorization = ''
    const server = createServer((request, response) => {
      authorization = request.headers.authorization ?? ''
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        [
          'data: {"choices":[{"index":0,"delta":{"content":"native ok"},"finish_reason":"stop"}]}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('test HTTP server has no TCP address')
    const stateDir = await mkdtemp(join(tmpdir(), 'dsh-codex-native-'))
    stateDirs.push(stateDir)
    const native = loadNativeCoreFactory()(
      JSON.stringify({
        baseUrl: `http://127.0.0.1:${address.port}`,
        model: 'intranet-test',
        stateDir,
        requestTimeoutMs: 2_000,
        contextWindowTokens: 10_000,
        compactThresholdTokens: 8_000,
        maxSteps: 8,
        systemPrompt: '',
      }),
      'sk-native-memory-only',
    )
    const events: unknown[] = []
    try {
      native.createThread('root', undefined, undefined, 'root')
      const result = JSON.parse(
        await native.runTurn('root', 'hello', '[]', async (error, payload) => {
          if (error !== null) throw error
          if (payload !== undefined) events.push(JSON.parse(payload))
          return '{}'
        }),
      ) as { text: string; steps: number }
      expect(result).toMatchObject({ text: 'native ok', steps: 1 })
      expect(authorization).toBe('Bearer sk-native-memory-only')
      expect(
        events.some((entry) => {
          if (typeof entry !== 'object' || entry === null) return false
          return (entry as { kind?: string }).kind === 'event'
        }),
      ).toBe(true)
      expect(JSON.parse(native.threadSnapshot('root'))).toMatchObject({
        threadId: 'root',
        status: 'idle',
      })
    } finally {
      await native.dispose()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      )
    }
  })
})
