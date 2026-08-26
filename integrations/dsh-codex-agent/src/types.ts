export interface ToolDefinition {
  name: string
  description: string
  parameters: unknown
}

export interface NativeRuntimeEventEnvelope {
  kind: 'event'
  event: unknown
}

export interface NativeToolEnvelope {
  kind: 'tool'
  invocation: {
    threadId: string
    callId: string
    name: string
    arguments: unknown
    target?: string
  }
}

export type NativeHostEnvelope = NativeRuntimeEventEnvelope | NativeToolEnvelope

export interface NativeTurnResult {
  threadId: string
  text: string
  finishReason: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  steps: number
}
