import type { JsonValue, Session } from '@deepseek-ai/dsh-session'

export interface CodexProjectionEvent {
  kind: 'input' | 'runtime' | 'tool-audit' | 'result' | 'error'
  payload: JsonValue
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Projection-only copy. Codex Thread Store remains the model-history authority. */
    'codex/event': CodexProjectionEvent
  }
}

export function project(
  session: Session,
  event: CodexProjectionEvent,
  warn: (message: string) => void,
): void {
  try {
    session.append('codex/event', event)
  } catch (error: unknown) {
    warn(`dsh-codex-agent projection failed without mutating the Codex Thread: ${errorText(error)}`)
  }
}

export function toJsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return null
  return JSON.parse(serialized) as JsonValue
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}
