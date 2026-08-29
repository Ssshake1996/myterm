import { resolve } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type {
  AgentFactory,
  AgentHandle,
  AgentOptions,
  CreateAgentOptions,
  ResumeAgentOptions,
  SessionStartSource,
} from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'

import { HarnessCodexAgent } from './agent.js'
import { createHttpMcpManager, type HttpMcpManagerFactory } from './mcp-http.js'
import {
  loadNativeCoreFactory,
  type NativeCodexCoreBinding,
  type NativeCoreFactory,
} from './native.js'
import type { ExternalMcpConfig, ExternalWebSearchConfig } from './policy.js'
import { createHttpWebSearchManager, type HttpWebSearchManagerFactory } from './web-search-http.js'

export const name = 'dsh-codex-agent'
export const inject = ['agents', 'sessions', 'tools']

export interface Config {
  baseUrl: string
  model: string
  apiKeyEnv?: string
  stateDir: string
  nativeBindingPath?: string
  requestTimeoutMs?: number
  contextWindowTokens?: number
  compactThresholdTokens?: number
  systemPrompt?: string
  externalMcp?: ExternalMcpConfig[]
  webSearch?: ExternalWebSearchConfig
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().required(),
  model: z.string().required(),
  apiKeyEnv: z.string().default('INTRANET_LLM_API_KEY'),
  stateDir: z.string().required(),
  nativeBindingPath: z.string(),
  requestTimeoutMs: z.number().step(1).min(1).default(120_000),
  contextWindowTokens: z.number().step(1).min(2).default(128_000),
  compactThresholdTokens: z.number().step(1).min(1).default(96_000),
  systemPrompt: z.string().default(''),
  externalMcp: z
    .array(
      z.object({
        serverName: z.string().required(),
        url: z.string().required(),
        allowedTools: z.array(z.string()).required(),
        headersFromEnv: z.dict(z.string()),
        connectTimeoutMs: z.number().step(1).min(1),
        toolCallTimeoutMs: z.number().step(1).min(1),
      }),
    )
    .default([]),
  webSearch: z.object({
    url: z.string().required(),
    headersFromEnv: z.dict(z.string()),
    timeoutMs: z.number().step(1).min(1),
    maxResponseBytes: z.number().step(1).min(1),
  }),
})

interface ResolvedConfig {
  baseUrl: string
  model: string
  stateDir: string
  nativeBindingPath?: string
  requestTimeoutMs: number
  contextWindowTokens: number
  compactThresholdTokens: number
  systemPrompt: string
  externalMcp: ExternalMcpConfig[]
  webSearch?: ExternalWebSearchConfig
}

export class CodexAgentFactory implements AgentFactory {
  private accepting = true
  private readonly shutdown = new AbortController()
  private readonly handles = new Set<() => Promise<void>>()
  private readonly pending = new Set<Promise<void>>()

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly native: NativeCodexCoreBinding,
  ) {}

  createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
    return this.track(
      this.materialize(ownerCtx, {
        id: options.sessionId,
        options: options.agentOptions,
        meta: options.meta,
        signal: options.signal,
        setup: options.setup,
        source: 'startup',
        createCore: true,
        hasSeed: (options.seed?.length ?? 0) > 0,
      }),
    )
  }

  resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
    return this.track(
      this.materialize(ownerCtx, {
        id: options.resumeSessionId,
        options: options.agentOptions,
        signal: options.signal,
        setup: options.setup,
        source: 'resume',
        createCore: false,
        hasSeed: false,
      }),
    )
  }

  async dispose(): Promise<void> {
    if (!this.accepting) return
    this.accepting = false
    this.shutdown.abort(new Error('dsh-codex-agent is unloading'))
    await Promise.allSettled([...this.pending])
    await Promise.allSettled([...this.handles].map((dispose) => dispose()))
    await this.native.dispose()
  }

  private async materialize(
    ownerCtx: Context,
    request: {
      id: SessionId
      options?: AgentOptions
      meta?: CreateAgentOptions['meta']
      signal?: AbortSignal
      setup?: CreateAgentOptions['setup']
      source: SessionStartSource
      createCore: boolean
      hasSeed: boolean
    },
  ): Promise<AgentHandle> {
    if (!this.accepting) throw new Error('dsh-codex-agent is not accepting new agents')
    if (request.hasSeed) {
      throw new Error(
        'dsh-codex-agent rejects Harness session seeds: Codex Thread Store is the only model-history authority',
      )
    }
    ownerCtx.fiber.assertActive()
    const signal =
      request.signal === undefined
        ? this.shutdown.signal
        : AbortSignal.any([request.signal, this.shutdown.signal])
    signal.throwIfAborted()
    const configuredOptions = this.agentOptions(request.options)
    const session = this.ctx.sessions.prepare(request.id, { meta: request.meta })
    const agent = new HarnessCodexAgent(
      this.ctx,
      request.id,
      configuredOptions,
      session,
      this.native,
      this.config.externalMcp,
      this.config.webSearch,
    )
    let setupCommit: { commit(): void } | undefined
    let coreCreated = false
    let published = false
    let detachSession: (() => void) | undefined
    let detachAgent: (() => void) | undefined
    try {
      const setupResult = await request.setup?.(agent.ctx)
      setupCommit = setupResult === undefined ? undefined : setupResult
      signal.throwIfAborted()
      ownerCtx.fiber.assertActive()
      if (request.createCore) {
        this.native.createThread(
          request.id,
          request.meta?.cwd,
          request.meta?.parentSession,
          request.meta?.origin === 'subagent' ? 'subagent' : 'root',
        )
        coreCreated = true
      } else {
        this.native.resumeThread(request.id)
      }
      setupCommit?.commit()
      detachSession = this.ctx.sessions.enter(session)
      detachAgent = this.ctx.agents.enter(agent, ownerCtx.agent)
      this.ctx.sessions.announce(session)
      this.ctx.agents.announce(agent)
      agentEvents(this.ctx, agent).emit('agent/session-start', { source: request.source })
      published = true
    } catch (error: unknown) {
      detachAgent?.()
      await agent.scope.dispose()
      detachSession?.()
      if (coreCreated && !published) {
        await this.native.deleteUnpublishedThread(request.id).catch((cleanupError: unknown) => {
          this.ctx.logger.warn(
            `dsh-codex-agent failed to roll back unpublished thread ${request.id}: ${errorText(cleanupError)}`,
          )
        })
      }
      throw error
    }

    let cleanupPromise: Promise<void> | undefined
    const cleanup = (): Promise<void> => {
      if (cleanupPromise === undefined) {
        cleanupPromise = (async () => {
          try {
            await agent.stopAndDrain()
            detachAgent?.()
            await agent.scope.dispose()
            detachSession?.()
          } finally {
            this.handles.delete(cleanup)
          }
        })()
      }
      return cleanupPromise
    }
    this.handles.add(cleanup)
    const disposeEffect = ownerCtx.effect(() => cleanup, `dsh-codex-agent(${request.id})`)
    return {
      agent,
      async dispose(): Promise<void> {
        await Promise.resolve(disposeEffect())
        await cleanup()
      },
    }
  }

  private agentOptions(options: AgentOptions | undefined): AgentOptions {
    if (options?.model !== undefined && options.model !== this.config.model) {
      throw new Error(
        `dsh-codex-agent uses one configured model ${this.config.model}; per-agent model ${options.model} is not allowed`,
      )
    }
    if (options?.provider !== undefined && options.provider !== 'codex-core') {
      throw new Error(`dsh-codex-agent provider must be codex-core, got ${options.provider}`)
    }
    return Object.freeze({
      provider: 'codex-core',
      model: this.config.model,
      ...(options?.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    })
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.then(
      () => undefined,
      () => undefined,
    )
    this.pending.add(tracked)
    void tracked.finally(() => this.pending.delete(tracked))
    return operation
  }
}

export async function apply(
  ctx: Context,
  config: Config,
  nativeFactory: NativeCoreFactory = loadNativeCoreFactory(config.nativeBindingPath),
  mcpManagerFactory: HttpMcpManagerFactory = createHttpMcpManager,
  webSearchManagerFactory: HttpWebSearchManagerFactory = createHttpWebSearchManager,
): Promise<void> {
  const resolved = resolveConfig(config)
  const apiKeyEnv = config.apiKeyEnv ?? 'INTRANET_LLM_API_KEY'
  const apiKey = process.env[apiKeyEnv]
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(
      `dsh-codex-agent requires API key injection through environment variable ${apiKeyEnv}`,
    )
  }
  const native = nativeFactory(
    JSON.stringify({
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      stateDir: resolved.stateDir,
      requestTimeoutMs: resolved.requestTimeoutMs,
      contextWindowTokens: resolved.contextWindowTokens,
      compactThresholdTokens: resolved.compactThresholdTokens,
      turnStepBudget: 64,
      systemPrompt: resolved.systemPrompt,
    }),
    apiKey,
  )
  const mcpManager = mcpManagerFactory(ctx, resolved.externalMcp)
  const webSearchManager = webSearchManagerFactory(ctx, resolved.webSearch)
  try {
    await mcpManager.start()
    await webSearchManager.start()
  } catch (error: unknown) {
    await webSearchManager.dispose().catch(() => undefined)
    await mcpManager.dispose().catch(() => undefined)
    await native.dispose().catch(() => undefined)
    throw error
  }
  const factory = new CodexAgentFactory(ctx, resolved, native)
  ctx.effect(() => ctx.agents.setFactory(factory), 'dsh-codex-agent.setFactory()')
  ctx.effect(
    () => async () => {
      await factory.dispose()
      await webSearchManager.dispose()
      await mcpManager.dispose()
    },
    'dsh-codex-agent.lifecycle()',
  )
}

function resolveConfig(config: Config): ResolvedConfig {
  const baseUrl = new URL(config.baseUrl)
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error('dsh-codex-agent baseUrl must use HTTP or HTTPS')
  }
  if (baseUrl.username !== '' || baseUrl.password !== '') {
    throw new Error('dsh-codex-agent baseUrl must not contain credentials')
  }
  const contextWindowTokens = config.contextWindowTokens ?? 128_000
  const compactThresholdTokens = config.compactThresholdTokens ?? 96_000
  if (compactThresholdTokens >= contextWindowTokens) {
    throw new Error('compactThresholdTokens must be lower than contextWindowTokens')
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    model: config.model,
    stateDir: resolve(config.stateDir),
    ...(config.nativeBindingPath === undefined
      ? {}
      : { nativeBindingPath: resolve(config.nativeBindingPath) }),
    requestTimeoutMs: config.requestTimeoutMs ?? 120_000,
    contextWindowTokens,
    compactThresholdTokens,
    systemPrompt: config.systemPrompt ?? '',
    externalMcp: config.externalMcp ?? [],
    ...(config.webSearch === undefined ? {} : { webSearch: config.webSearch }),
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

export type { HttpMcpManagerFactory } from './mcp-http.js'
export type { NativeCoreFactory } from './native.js'
export type { ExternalMcpConfig, ExternalWebSearchConfig } from './policy.js'
export type { HttpWebSearchManagerFactory } from './web-search-http.js'
