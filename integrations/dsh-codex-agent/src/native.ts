import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type NativeHostCallback = (error: Error | null, payload?: string) => Promise<string>

export interface NativeCodexCoreBinding {
  createThread(threadId: string, cwd?: string, parentThreadId?: string, role?: string): void
  resumeThread(threadId: string): string
  deleteUnpublishedThread(threadId: string): Promise<void>
  threadSnapshot(threadId: string): string
  graphSnapshot(rootThreadId: string): string
  runTurn(
    threadId: string,
    input: string,
    toolsJson: string,
    hostCallback: NativeHostCallback,
  ): Promise<string>
  cancelThread(threadId: string): Promise<boolean>
  dispose(): Promise<void>
}

interface NativeModule {
  NativeCodexCore: new (configJson: string, apiKey: string) => NativeCodexCoreBinding
}

export type NativeCoreFactory = (configJson: string, apiKey: string) => NativeCodexCoreBinding

export function loadNativeCoreFactory(explicitPath?: string): NativeCoreFactory {
  const require = createRequire(import.meta.url)
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const candidates =
    explicitPath === undefined
      ? [
          join(moduleDir, '..', 'native-dist', platformArtifactName()),
          join(moduleDir, '..', 'native-dist', `index.${platformSuffix()}.node`),
          join(moduleDir, '..', 'native-dist', 'dsh-codex-core.node'),
          join(moduleDir, '..', 'native-dist', 'dsh_codex_core.node'),
        ]
      : [resolve(explicitPath)]
  const artifact = candidates.find((candidate) => existsSync(candidate))
  if (artifact === undefined) {
    throw new Error(
      `dsh-codex-agent native module not found; checked: ${candidates.join(', ')}. Run npm run build:native or configure nativeBindingPath.`,
    )
  }
  const loaded = require(artifact) as Partial<NativeModule>
  const NativeCodexCore = loaded.NativeCodexCore
  if (typeof NativeCodexCore !== 'function') {
    throw new Error(`native module ${artifact} does not export NativeCodexCore`)
  }
  return (configJson, apiKey) => new NativeCodexCore(configJson, apiKey)
}

function platformArtifactName(): string {
  return `dsh-codex-core.${platformSuffix()}.node`
}

function platformSuffix(): string {
  const platform = process.platform === 'win32' ? 'win32' : process.platform
  const architecture = process.arch === 'x64' ? 'x64' : process.arch
  const abi = process.platform === 'win32' ? 'msvc' : 'gnu'
  return `${platform}-${architecture}-${abi}`
}
