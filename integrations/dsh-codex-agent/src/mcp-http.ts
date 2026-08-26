import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { type ExternalMcpConfig, normalizeMcpToolName } from './policy.js'

interface Connection {
  client: Client
  disposers: Array<() => void>
}

export interface HttpMcpManager {
  start(): Promise<void>
  dispose(): Promise<void>
}

export type HttpMcpManagerFactory = (ctx: Context, configs: ExternalMcpConfig[]) => HttpMcpManager

export class ExplicitHttpMcpManager implements HttpMcpManager {
  private readonly connections: Connection[] = []
  private started = false

  constructor(
    private readonly ctx: Context,
    private readonly configs: ExternalMcpConfig[],
  ) {}

  async start(): Promise<void> {
    if (this.started) throw new Error('dsh-codex-agent HTTP MCP manager already started')
    this.started = true
    try {
      for (const config of this.configs) await this.connect(config)
    } catch (error: unknown) {
      await this.dispose()
      throw error
    }
  }

  async dispose(): Promise<void> {
    for (const connection of this.connections.splice(0).reverse()) {
      for (const dispose of connection.disposers.splice(0).reverse()) dispose()
      await connection.client.close().catch((error: unknown) => {
        this.ctx.logger.warn(`dsh-codex-agent MCP close failed: ${errorText(error)}`)
      })
    }
  }

  private async connect(config: ExternalMcpConfig): Promise<void> {
    const headers = resolveHeaders(config)
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers },
      reconnectionOptions: {
        maxReconnectionDelay: 1,
        initialReconnectionDelay: 1,
        reconnectionDelayGrowFactor: 1,
        maxRetries: 0,
      },
    })
    const client = new Client({ name: 'dsh-codex-agent', version: '0.1.0' }, { capabilities: {} })
    const connection: Connection = { client, disposers: [] }
    this.connections.push(connection)
    client.onclose = () => {
      for (const dispose of connection.disposers.splice(0).reverse()) dispose()
      this.ctx.logger.warn(
        `dsh-codex-agent MCP ${config.serverName} disconnected; automatic discovery/reconnect is disabled`,
      )
    }
    await client.connect(transport, { timeout: config.connectTimeoutMs ?? 15_000 })
    const listed = await client.listTools(undefined, { timeout: config.connectTimeoutMs ?? 15_000 })
    const allowed = new Set(config.allowedTools)
    const present = new Set(listed.tools.map((tool) => tool.name))
    const missing = [...allowed].filter((name) => !present.has(name))
    if (missing.length > 0) {
      throw new Error(
        `MCP ${config.serverName} did not advertise allowlisted tools: ${missing.join(', ')}`,
      )
    }
    const publicNames = new Map<string, string>()
    for (const tool of listed.tools) {
      if (!allowed.has(tool.name)) continue
      if (tool.execution?.taskSupport === 'required') {
        throw new Error(
          `MCP ${config.serverName} tool ${tool.name} requires unsupported task execution`,
        )
      }
      const normalized = normalizeMcpToolName(tool.name)
      const existing = publicNames.get(normalized)
      if (existing !== undefined && existing !== tool.name) {
        throw new Error(
          `MCP ${config.serverName} tools ${existing} and ${tool.name} normalize to the same public name`,
        )
      }
      publicNames.set(normalized, tool.name)
      const publicName = `mcp__${config.serverName}__${normalized}`
      const rawName = tool.name
      connection.disposers.push(
        this.ctx.tools.register({
          name: publicName,
          description: tool.description ?? `MCP ${config.serverName}: ${rawName}`,
          parameters: tool.inputSchema,
          output: {
            schema: {
              type: 'object',
              properties: {
                content: { type: 'array', items: {} },
                structuredContent: {},
              },
              required: ['content'],
              additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: extractMcpText(value) }],
          },
          execute: async (args, exec) => {
            const result = await client.callTool(
              {
                name: rawName,
                arguments: isRecord(args) ? args : {},
              },
              undefined,
              {
                signal: exec.signal,
                timeout: config.toolCallTimeoutMs ?? 60_000,
              },
            )
            if ('toolResult' in result) {
              return {
                content: [{ type: 'text', text: JSON.stringify(result.toolResult) }],
              }
            }
            if (result.isError === true) throw new Error(extractContentText(result.content))
            return {
              content: result.content as unknown as JsonValue[],
              ...(result.structuredContent === undefined
                ? {}
                : { structuredContent: result.structuredContent as JsonValue }),
            }
          },
        }),
      )
    }
  }
}

export const createHttpMcpManager: HttpMcpManagerFactory = (ctx, configs) =>
  new ExplicitHttpMcpManager(ctx, configs)

function resolveHeaders(config: ExternalMcpConfig): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [header, environmentName] of Object.entries(config.headersFromEnv ?? {})) {
    const value = process.env[environmentName]
    if (value === undefined || value.length === 0) {
      throw new Error(
        `MCP ${config.serverName} header ${header} requires environment variable ${environmentName}`,
      )
    }
    headers[header] = value
  }
  return headers
}

function extractMcpText(value: JsonValue): string {
  if (!isRecord(value) || !Array.isArray(value.content)) return JSON.stringify(value)
  return extractContentText(value.content)
}

function extractContentText(content: readonly unknown[]): string {
  return content
    .map((block) => {
      if (isRecord(block) && block.type === 'text' && typeof block.text === 'string')
        return block.text
      return JSON.stringify(block)
    })
    .join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}
