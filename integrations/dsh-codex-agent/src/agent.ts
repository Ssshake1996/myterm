import type { Context } from '@deepseek-ai/cordis'
import {
  type Agent,
  type AgentCancelCause,
  type AgentEventDispatch,
  type AgentOptions,
  type AgentStatus,
  agentEvents,
  type CancelOptions,
  Inbox,
  type InboxTarget,
} from '@deepseek-ai/dsh-agent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { Session, SessionId, UserMessage } from '@deepseek-ai/dsh-session'

import type { NativeCodexCoreBinding, NativeHostCallback } from './native.js'
import type { ExternalMcpConfig, ExternalWebSearchConfig } from './policy.js'
import { HarnessToolBridge } from './policy.js'
import { project, toJsonValue } from './projection.js'
import type { NativeHostEnvelope, NativeTurnResult } from './types.js'

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; abort: AbortController }
  | { kind: 'maintenance'; abort: AbortController }

export class HarnessCodexAgent implements Agent {
  readonly inbox: Inbox
  readonly scope: Scope
  readonly ctx: Context
  private readonly dispatch: AgentEventDispatch
  private readonly tools: HarnessToolBridge
  private phase: Phase = { kind: 'idle' }
  private activityDone: Promise<void> = Promise.resolve()
  private turn = 0
  private disposed = false

  constructor(
    runtimeCtx: Context,
    public readonly id: SessionId,
    public readonly options: AgentOptions,
    public readonly session: Session,
    private readonly native: NativeCodexCoreBinding,
    externalMcp: ExternalMcpConfig[],
    webSearch: ExternalWebSearchConfig | undefined,
  ) {
    this.scope = createScope(runtimeCtx, this)
    this.ctx = this.scope.ctx.extend({ agent: this })
    this.dispatch = agentEvents(runtimeCtx, this)
    this.inbox = new Inbox(session, {
      inserted: (message) => this.dispatch.emit('agent/inbox/inserted', { message }),
      discarded: (message) => this.dispatch.emit('agent/inbox/discarded', { message }),
      claimed: (message, turn) => this.dispatch.emit('agent/inbox/claimed', { message, turn }),
    })
    this.tools = new HarnessToolBridge(runtimeCtx, this, externalMcp, webSearch)
  }

  get status(): AgentStatus {
    return this.phase.kind === 'running' ? 'running' : 'idle'
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    this.assertLive()
    const resolvedTarget =
      this.phase.kind === 'running' && this.phase.abort.signal.aborted ? 'next-turn' : target
    this.inbox.append(resolvedTarget, message)
    if (wakeup) this.wakeDriver()
  }

  followup(message: UserMessage): void {
    this.send(message, 'next-turn', true)
  }

  steer(message: UserMessage): void {
    this.send(message, 'next-step', true)
  }

  inject(message: UserMessage): void {
    this.send(message, 'next-step', false)
  }

  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    if (!options.keepInbox) this.inbox.clear()
    if (this.phase.kind !== 'idle') this.phase.abort.abort(cause)
    void this.native.cancelThread(this.id).catch((error: unknown) => {
      this.ctx.logger.warn(`dsh-codex-agent cancel failed for ${this.id}: ${errorText(error)}`)
    })
  }

  async whenIdle(): Promise<void> {
    let activity: Promise<void>
    do {
      activity = this.activityDone
      await activity
    } while (activity !== this.activityDone)
  }

  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertLive()
    if (this.phase.kind !== 'idle') throw new Error(`agent ${this.id} already has active work`)
    const done = Promise.withResolvers<void>()
    const abort = new AbortController()
    this.phase = { kind: 'maintenance', abort }
    this.activityDone = done.promise
    return (async () => {
      try {
        return await task(abort.signal)
      } finally {
        this.phase = { kind: 'idle' }
        done.resolve()
        if (this.inbox.hasPending) this.wakeDriver()
      }
    })()
  }

  async stopAndDrain(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.cancel({ kind: 'disposed' })
    await this.whenIdle()
  }

  private wakeDriver(): void {
    if (this.phase.kind !== 'idle') return
    const done = Promise.withResolvers<void>()
    const abort = new AbortController()
    this.phase = { kind: 'running', abort }
    this.activityDone = done.promise
    this.dispatch.emit('agent/status', { status: 'running' })
    void this.drive(abort.signal).finally(() => {
      this.phase = { kind: 'idle' }
      this.dispatch.emit('agent/status', { status: 'idle' })
      done.resolve()
      if (!this.disposed && this.inbox.hasPending) this.wakeDriver()
    })
  }

  private async drive(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && this.inbox.hasPending) {
      const turn = ++this.turn
      const messages = this.inbox.claim('next-turn', turn)
      if (messages.length === 0) break
      const input = messages.map(messageText).filter(Boolean).join('\n\n')
      project(
        this.session,
        {
          kind: 'input',
          payload: toJsonValue({
            turn,
            messageIds: messages.map((message) => message.id),
            content: input,
          }),
        },
        (message) => this.ctx.logger.warn(message),
      )
      try {
        const result = await this.native.runTurn(
          this.id,
          input,
          JSON.stringify(this.tools.schemas()),
          this.hostCallback(signal),
        )
        const parsed = JSON.parse(result) as NativeTurnResult
        project(
          this.session,
          {
            kind: 'result',
            payload: toJsonValue(parsed),
          },
          (message) => this.ctx.logger.warn(message),
        )
      } catch (error: unknown) {
        project(
          this.session,
          {
            kind: 'error',
            payload: toJsonValue({ turn, error: errorText(error) }),
          },
          (message) => this.ctx.logger.warn(message),
        )
        this.dispatch.emit('agent/error', { turn, step: 0, error })
        break
      }
    }
  }

  private hostCallback(signal: AbortSignal): NativeHostCallback {
    return async (callbackError, payload) => {
      if (callbackError !== null) throw callbackError
      if (payload === undefined) throw new Error('native host callback omitted its payload')
      const envelope = JSON.parse(payload) as NativeHostEnvelope
      if (envelope.kind === 'event') {
        project(
          this.session,
          {
            kind: 'runtime',
            payload: toJsonValue(envelope.event),
          },
          (message) => this.ctx.logger.warn(message),
        )
        return '{}'
      }
      if (envelope.kind === 'tool') {
        const result = await this.tools.execute(envelope.invocation, signal)
        return JSON.stringify(result)
      }
      throw new Error(`unknown native host callback envelope: ${payload}`)
    }
  }

  private assertLive(): void {
    if (this.disposed) throw new Error(`agent ${this.id} is disposed`)
  }
}

function messageText(message: UserMessage): string {
  return message.content
    .map((block) => {
      if (block.type === 'text') return block.text
      return JSON.stringify(block)
    })
    .join('\n')
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}
