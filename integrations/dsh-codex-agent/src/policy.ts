import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { project, toJsonValue } from './projection.js'
import type { ToolDefinition } from './types.js'

export interface ExternalMcpConfig {
  serverName: string
  url: string
  allowedTools: string[]
  headersFromEnv?: Record<string, string>
  connectTimeoutMs?: number
  toolCallTimeoutMs?: number
}

export interface ExternalWebSearchConfig {
  url: string
  headersFromEnv?: Record<string, string>
  timeoutMs?: number
  maxResponseBytes?: number
}

export interface ToolInvocation {
  threadId: string
  callId: string
  name: string
  arguments: unknown
  target?: string
}

export interface NativeToolResult {
  content: string
  isError: boolean
  status: string
}

interface ResolvedMcpPolicy {
  serverName: string
  url: string
  allowedTools: ReadonlySet<string>
  prefix: string
}

export class HarnessToolBridge {
  private readonly mcpByPrefix: ResolvedMcpPolicy[]

  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
    externalMcp: ExternalMcpConfig[],
    private readonly webSearch: ExternalWebSearchConfig | undefined,
  ) {
    this.mcpByPrefix = externalMcp.map(resolveMcpPolicy)
  }

  schemas(): ToolDefinition[] {
    return this.ctx.tools
      .schemas(this.agent)
      .filter((schema) => this.toolAdmission(schema.name).allowed)
      .map((schema) => ({
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
      }))
  }

  async execute(invocation: ToolInvocation, signal: AbortSignal): Promise<NativeToolResult> {
    const admission = this.toolAdmission(invocation.name)
    if (!admission.allowed) {
      return {
        content: `Error: ${admission.reason}`,
        isError: true,
        status: 'denied',
      }
    }
    const argumentsSummary = summarize(invocation.arguments, 512)
    project(
      this.agent.session,
      {
        kind: 'tool-audit',
        payload: toJsonValue({
          phase: 'requested',
          callId: invocation.callId,
          name: invocation.name,
          target: admission.target ?? null,
          argumentsSummary,
        }),
      },
      (message) => this.ctx.logger.warn(message),
    )
    const result = await this.ctx.tools.execute({
      callId: CallId(invocation.callId),
      name: invocation.name,
      arguments: invocation.arguments,
      agent: this.agent,
      signal,
    })
    const content = result.content
      .map((block) => (block.type === 'text' ? block.text : JSON.stringify(block)))
      .join('\n')
    project(
      this.agent.session,
      {
        kind: 'tool-audit',
        payload: toJsonValue({
          phase: 'completed',
          callId: invocation.callId,
          name: invocation.name,
          target: admission.target ?? null,
          isError: result.isError,
        }),
      },
      (message) => this.ctx.logger.warn(message),
    )
    return {
      content,
      isError: result.isError,
      status: result.isError ? 'failed' : 'completed',
    }
  }

  private toolAdmission(
    name: string,
  ): { allowed: true; target?: string } | { allowed: false; reason: string } {
    if (name === 'web_search' || name.startsWith('web__')) {
      if (name !== 'web_search' || this.webSearch === undefined) {
        return {
          allowed: false,
          reason: `Web tool ${name} has no explicitly configured endpoint allowlist`,
        }
      }
      return { allowed: true, target: this.webSearch.url }
    }
    if (!name.startsWith('mcp__')) return { allowed: true }
    const policy = this.mcpByPrefix.find((candidate) => name.startsWith(candidate.prefix))
    if (policy === undefined) {
      return {
        allowed: false,
        reason: `MCP tool ${name} has no explicitly configured server allowlist`,
      }
    }
    const rawName = name.slice(policy.prefix.length)
    if (!policy.allowedTools.has(rawName)) {
      return {
        allowed: false,
        reason: `MCP tool ${rawName} is not allowlisted for server ${policy.serverName}`,
      }
    }
    return { allowed: true, target: policy.url }
  }
}

function resolveMcpPolicy(config: ExternalMcpConfig): ResolvedMcpPolicy {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(config.serverName)) {
    throw new Error(`externalMcp.serverName ${JSON.stringify(config.serverName)} is invalid`)
  }
  const url = new URL(config.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`externalMcp ${config.serverName} must use HTTP or HTTPS`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`externalMcp ${config.serverName} URL must not contain credentials`)
  }
  if (config.allowedTools.length === 0) {
    throw new Error(`externalMcp ${config.serverName} must explicitly allow at least one tool`)
  }
  const allowedTools = new Set(config.allowedTools.map(normalizeMcpToolName))
  if (allowedTools.has('*')) {
    throw new Error(`externalMcp ${config.serverName} does not permit wildcard tool admission`)
  }
  return {
    serverName: config.serverName,
    url: url.toString(),
    allowedTools,
    prefix: `mcp__${config.serverName}__`,
  }
}

export function normalizeMcpToolName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_-]/g, '_')
  if (normalized.length === 0 || normalized.length > 64) {
    throw new Error(`MCP tool name ${JSON.stringify(name)} cannot be represented safely`)
  }
  return normalized
}

function summarize(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value) ?? 'null'
  return serialized.length <= maxChars ? serialized : `${serialized.slice(0, maxChars)}…`
}
