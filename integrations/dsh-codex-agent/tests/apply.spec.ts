import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Request, Response } from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { apply, type Config, inject, name } from '../src/index.js'
import { createHttpMcpManager, type HttpMcpManagerFactory } from '../src/mcp-http.js'
import type {
  NativeCodexCoreBinding,
  NativeCoreFactory,
  NativeHostCallback,
} from '../src/native.js'
import type { HttpWebSearchManagerFactory } from '../src/web-search-http.js'

const noMcpFactory: HttpMcpManagerFactory = () => ({
  async start() {},
  async dispose() {},
})

class FakeNative implements NativeCodexCoreBinding {
  readonly threads = new Set<string>()
  readonly toolResults: unknown[] = []
  runCount = 0
  disposed = false
  requestTool: string | undefined
  requestArguments: unknown

  createThread(threadId: string): void {
    if (this.threads.has(threadId)) throw new Error(`duplicate ${threadId}`)
    this.threads.add(threadId)
  }

  resumeThread(threadId: string): string {
    if (!this.threads.has(threadId)) throw new Error(`missing ${threadId}`)
    return JSON.stringify({ threadId, status: 'idle' })
  }

  async deleteUnpublishedThread(threadId: string): Promise<void> {
    this.threads.delete(threadId)
  }

  threadSnapshot(threadId: string): string {
    return JSON.stringify({ threadId, status: 'idle' })
  }

  graphSnapshot(): string {
    return '[]'
  }

  async runTurn(
    threadId: string,
    input: string,
    _toolsJson: string,
    hostCallback: NativeHostCallback,
  ): Promise<string> {
    this.runCount += 1
    await hostCallback(
      null,
      JSON.stringify({
        kind: 'event',
        event: { type: 'text_delta', thread_id: threadId, delta: 'ok' },
      }),
    )
    if (this.requestTool !== undefined) {
      const result = await hostCallback(
        null,
        JSON.stringify({
          kind: 'tool',
          invocation: {
            threadId,
            callId: 'call-1',
            name: this.requestTool,
            arguments: this.requestArguments ?? { value: input },
          },
        }),
      )
      this.toolResults.push(JSON.parse(result))
    }
    return JSON.stringify({
      threadId,
      text: 'ok',
      finishReason: 'stop',
      steps: 1,
    })
  }

  async cancelThread(): Promise<boolean> {
    return true
  }

  async dispose(): Promise<void> {
    this.disposed = true
  }
}

const contexts: Context[] = []
afterEach(async () => {
  delete process.env.TEST_CODEX_SECRET
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function harness(
  native: FakeNative,
  config: Partial<Config> = {},
  mcpManagerFactory: HttpMcpManagerFactory = noMcpFactory,
): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  process.env.TEST_CODEX_SECRET = 'sk-memory-only'
  const resolved: Config = {
    baseUrl: 'http://llm.internal',
    model: 'gpt-intranet',
    apiKeyEnv: 'TEST_CODEX_SECRET',
    stateDir: 'F:/state-test',
    ...config,
  }
  const factory: NativeCoreFactory = () => native
  const plugin = Object.assign(
    (inner: Context, pluginConfig: Config) =>
      apply(inner, pluginConfig, factory, mcpManagerFactory),
    { inject },
  )
  Object.defineProperty(plugin, 'name', { value: name })
  await ctx.plugin(plugin, resolved)
  return ctx
}

describe('dsh-codex-agent Harness composition', () => {
  it('registers the only AgentFactory and projects Core events without using Session as model history', async () => {
    const native = new FakeNative()
    const ctx = await harness(native)
    const handle = await ctx.agents.create({ sessionId: SessionId('root') })
    handle.agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'user' },
      }),
    )
    await handle.agent.whenIdle()

    expect(native.runCount).toBe(1)
    expect(handle.agent.session.events.some((event) => event.type === 'codex/event')).toBe(true)
    expect(handle.agent.session.deriveMessages()).toEqual([])
    await handle.dispose()
  })

  it('passes the API key separately from JSON configuration and disposes the native runtime', async () => {
    const native = new FakeNative()
    let capturedConfig = ''
    let capturedKey = ''
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    process.env.TEST_CODEX_SECRET = 'sk-memory-only'
    const factory: NativeCoreFactory = (configJson, apiKey) => {
      capturedConfig = configJson
      capturedKey = apiKey
      return native
    }
    await apply(
      ctx,
      {
        baseUrl: 'http://llm.internal',
        model: 'gpt-intranet',
        apiKeyEnv: 'TEST_CODEX_SECRET',
        stateDir: 'F:/state-test',
      },
      factory,
      noMcpFactory,
    )

    expect(capturedKey).toBe('sk-memory-only')
    expect(capturedConfig).not.toContain('sk-memory-only')
    expect(capturedConfig).not.toContain('apiKey')
    await ctx.fiber.dispose()
    expect(native.disposed).toBe(true)
    contexts.splice(contexts.indexOf(ctx), 1)
  })

  it('denies an MCP tool without an explicit server and tool allowlist', async () => {
    const native = new FakeNative()
    native.requestTool = 'mcp__prod__danger'
    const ctx = await harness(native)
    ctx.tools.register({
      name: 'mcp__prod__danger',
      description: 'danger',
      parameters: { type: 'object' },
      output: {
        schema: { type: 'object' },
        render: () => [{ type: 'text', text: 'ran' }],
      },
      execute: async () => ({ ok: true }),
    })
    const handle = await ctx.agents.create({ sessionId: SessionId('root') })
    handle.agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'run' }],
        source: { kind: 'user' },
      }),
    )
    await handle.agent.whenIdle()

    expect(native.toolResults).toEqual([
      expect.objectContaining({ isError: true, status: 'denied' }),
    ])
  })

  it('executes an allowlisted Streamable HTTP MCP tool through the Harness provider', async () => {
    const native = new FakeNative()
    native.requestTool = 'mcp__prod__status'
    const ctx = await harness(native, {
      externalMcp: [
        {
          serverName: 'prod',
          url: 'https://mcp.internal/mcp',
          allowedTools: ['status'],
        },
      ],
    })
    let calls = 0
    ctx.tools.register({
      name: 'mcp__prod__status',
      description: 'status',
      parameters: { type: 'object' },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async () => {
        calls += 1
        return { ok: true }
      },
    })
    const handle = await ctx.agents.create({ sessionId: SessionId('root') })
    handle.agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'run' }],
        source: { kind: 'user' },
      }),
    )
    await handle.agent.whenIdle()

    expect(calls).toBe(1)
    expect(native.toolResults).toEqual([
      expect.objectContaining({ isError: false, status: 'completed' }),
    ])
  })

  it('connects to a real Streamable HTTP MCP server and registers only allowlisted tools', async () => {
    let authorization = ''
    const servers = new Set<McpServer>()
    const app = createMcpExpressApp()
    app.post('/mcp', async (request: Request, response: Response) => {
      authorization = request.headers.authorization ?? ''
      const server = new McpServer({ name: 'test-mcp', version: '1.0.0' })
      servers.add(server)
      server.registerTool(
        'status',
        {
          description: 'return status',
          inputSchema: { value: z.string().optional() },
        },
        async ({ value }) => ({
          content: [{ type: 'text', text: `status:${value ?? 'ok'}` }],
        }),
      )
      server.registerTool(
        'danger',
        { description: 'must stay hidden', inputSchema: {} },
        async () => ({ content: [{ type: 'text', text: 'danger' }] }),
      )
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      await server.connect(transport)
      await transport.handleRequest(request, response, request.body)
      response.on('close', () => {
        void transport.close()
        void server.close()
        servers.delete(server)
      })
    })
    const httpServer = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve, reject) => {
      httpServer.once('listening', resolve)
      httpServer.once('error', reject)
    })
    const address = httpServer.address()
    if (address === null || typeof address === 'string') {
      throw new Error('test MCP server has no TCP address')
    }
    process.env.TEST_MCP_AUTH = 'Bearer mcp-memory-only'
    try {
      const native = new FakeNative()
      native.requestTool = 'mcp__ops__status'
      native.requestArguments = { value: 'ready' }
      const ctx = await harness(
        native,
        {
          externalMcp: [
            {
              serverName: 'ops',
              url: `http://127.0.0.1:${address.port}/mcp`,
              allowedTools: ['status'],
              headersFromEnv: { authorization: 'TEST_MCP_AUTH' },
            },
          ],
        },
        createHttpMcpManager,
      )
      const handle = await ctx.agents.create({ sessionId: SessionId('root') })
      const schemas = ctx.tools.schemas(handle.agent).map((schema) => schema.name)
      expect(schemas).toContain('mcp__ops__status')
      expect(schemas).not.toContain('mcp__ops__danger')
      handle.agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: 'check MCP' }],
          source: { kind: 'user' },
        }),
      )
      await handle.agent.whenIdle()

      expect(authorization).toBe('Bearer mcp-memory-only')
      expect(native.toolResults).toEqual([
        expect.objectContaining({
          content: expect.stringContaining('status:ready'),
          isError: false,
          status: 'completed',
        }),
      ])
    } finally {
      delete process.env.TEST_MCP_AUTH
      await Promise.allSettled([...servers].map((server) => server.close()))
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error: Error | undefined) =>
          error === undefined ? resolve() : reject(error),
        ),
      )
    }
  })

  it('denies a host-provided Web tool unless the endpoint is explicitly configured', async () => {
    const native = new FakeNative()
    native.requestTool = 'web_search'
    const ctx = await harness(native)
    let calls = 0
    ctx.tools.register({
      name: 'web_search',
      description: 'unapproved search provider',
      parameters: { type: 'object' },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      execute: async () => {
        calls += 1
        return 'should not run'
      },
    })
    const handle = await ctx.agents.create({ sessionId: SessionId('root') })
    handle.agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'search' }],
        source: { kind: 'user' },
      }),
    )
    await handle.agent.whenIdle()

    expect(calls).toBe(0)
    expect(native.toolResults).toEqual([
      expect.objectContaining({ isError: true, status: 'denied' }),
    ])
  })

  it('routes Web Search only to the fixed configured HTTP endpoint', async () => {
    let requestBody = ''
    const server = createServer((request, response) => {
      request.on('data', (chunk) => {
        requestBody += String(chunk)
      })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"results":[{"title":"internal"}]}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('test search server has no TCP address')
    try {
      const native = new FakeNative()
      native.requestTool = 'web_search'
      native.requestArguments = { query: 'kernel hardening' }
      const ctx = await harness(native, {
        webSearch: { url: `http://127.0.0.1:${address.port}/search` },
      })
      const handle = await ctx.agents.create({ sessionId: SessionId('root') })
      handle.agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: 'kernel hardening' }],
          source: { kind: 'user' },
        }),
      )
      await handle.agent.whenIdle()

      expect(JSON.parse(requestBody)).toEqual({ query: 'kernel hardening' })
      expect(native.toolResults).toEqual([
        expect.objectContaining({ isError: false, status: 'completed' }),
      ])
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      )
    }
  })

  it('drains the native Agent runtime before closing external tool providers', async () => {
    const order: string[] = []
    const native = new FakeNative()
    native.dispose = async () => {
      order.push('native')
    }
    const mcpFactory: HttpMcpManagerFactory = () => ({
      async start() {},
      async dispose() {
        order.push('mcp')
      },
    })
    const webFactory: HttpWebSearchManagerFactory = () => ({
      async start() {},
      async dispose() {
        order.push('web')
      },
    })
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    process.env.TEST_CODEX_SECRET = 'sk-memory-only'
    await apply(
      ctx,
      {
        baseUrl: 'http://llm.internal',
        model: 'gpt-intranet',
        apiKeyEnv: 'TEST_CODEX_SECRET',
        stateDir: 'F:/state-test',
      },
      () => native,
      mcpFactory,
      webFactory,
    )

    await ctx.fiber.dispose()
    expect(order).toEqual(['native', 'web', 'mcp'])
    contexts.splice(contexts.indexOf(ctx), 1)
  })
})
