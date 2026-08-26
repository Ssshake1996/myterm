import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

import type { ExternalWebSearchConfig } from './policy.js'

export interface HttpWebSearchManager {
  start(): Promise<void>
  dispose(): Promise<void>
}

export type HttpWebSearchManagerFactory = (
  ctx: Context,
  config: ExternalWebSearchConfig | undefined,
) => HttpWebSearchManager

export class ExplicitHttpWebSearchManager implements HttpWebSearchManager {
  private disposeTool: (() => void) | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: ExternalWebSearchConfig | undefined,
  ) {}

  async start(): Promise<void> {
    if (this.config === undefined) return
    const endpoint = resolveEndpoint(this.config.url)
    const headers = resolveHeaders(this.config)
    this.disposeTool = this.ctx.tools.register({
      name: 'web_search',
      description:
        'Search the explicitly configured Web Search provider. The query is sent only to the configured endpoint.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 1 } },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      execute: async (args, exec) => {
        const query = isRecord(args) && typeof args.query === 'string' ? args.query.trim() : ''
        if (query.length === 0) throw new Error('web_search requires a non-empty query')
        const signal = AbortSignal.any([
          exec.signal,
          AbortSignal.timeout(this.config?.timeoutMs ?? 30_000),
        ])
        let response: Response
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify({ query }),
            signal,
          })
        } catch (error: unknown) {
          throw new Error(`web_search request failed at POST ${endpoint}: ${errorText(error)}`, {
            cause: error,
          })
        }
        const maxBytes = this.config?.maxResponseBytes ?? 1_000_000
        const body = await readBoundedBody(response, maxBytes)
        if (!response.ok) {
          throw new Error(
            `web_search HTTP ${response.status} ${response.statusText} from ${endpoint}: ${body}`,
          )
        }
        return body
      },
    })
  }

  async dispose(): Promise<void> {
    this.disposeTool?.()
    this.disposeTool = undefined
  }
}

export const createHttpWebSearchManager: HttpWebSearchManagerFactory = (ctx, config) =>
  new ExplicitHttpWebSearchManager(ctx, config)

function resolveEndpoint(raw: string): string {
  const endpoint = new URL(raw)
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('webSearch.url must use HTTP or HTTPS')
  }
  if (endpoint.username !== '' || endpoint.password !== '') {
    throw new Error('webSearch.url must not contain credentials')
  }
  return endpoint.toString()
}

function resolveHeaders(config: ExternalWebSearchConfig): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [header, environmentName] of Object.entries(config.headersFromEnv ?? {})) {
    const value = process.env[environmentName]
    if (value === undefined || value.length === 0) {
      throw new Error(
        `web_search header ${header} requires environment variable ${environmentName}`,
      )
    }
    headers[header] = value
  }
  return headers
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    bytes += next.value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      throw new Error(`web_search response exceeded ${maxBytes} bytes`)
    }
    chunks.push(next.value)
  }
  const combined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}
