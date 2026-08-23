import { useState } from "react";
import {
  type AiAuthMode,
  type AiErrorDiagnostic,
  type AiModelConfig,
  type AiModelRole,
  type AiProfile,
  type AiTestResult,
  aiConfigJson,
  aiProfileSave,
  aiTestConnection,
  configOpenLocal,
  errorMessage,
} from "../../ipc";
import { useUiStore } from "../../store/ui";
import { Modal } from "../shell/Modal";

const PRESETS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "Ollama 本地", baseUrl: "http://localhost:11434/v1", model: "qwen2.5" },
  { name: "自定义", baseUrl: "https://gateway.example.com/v1", model: "" },
] as const;

const DEFAULT_ROUTING = { fallback_on_error: true, analysis_threshold_chars: 32000 };

function defaultModels(model: string): AiModelConfig[] {
  return [
    { id: "primary", name: "主模型", model, role: "primary", enabled: true },
    { id: "analysis", name: "分析模型", model: "", role: "analysis", enabled: false },
    { id: "fallback", name: "备用模型", model: "", role: "fallback", enabled: false },
  ];
}

function diagnosticFromThrownError(
  error: unknown,
  stage: string,
  label: string,
): AiErrorDiagnostic {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "ipc_error"
      : "ipc_error";
  return {
    stage,
    code,
    summary: `${label} · ${code}`,
    detail: errorMessage(error, `${label}失败：未返回可读的错误信息`),
  };
}

interface AiSettingsProps {
  profile: AiProfile | null;
  onClose: () => void;
  onSaved: (profile: AiProfile) => void;
}

export function AiSettings({ profile, onClose, onSaved }: AiSettingsProps) {
  const notify = useUiStore((state) => state.notify);
  const [name, setName] = useState(profile?.name ?? "DeepSeek");
  const [baseUrl, setBaseUrl] = useState(profile?.base_url ?? "https://api.deepseek.com/v1");
  const [models, setModels] = useState<AiModelConfig[]>(
    profile?.models?.length ? profile.models : defaultModels(profile?.model ?? "deepseek-chat"),
  );
  const [fallbackOnError, setFallbackOnError] = useState(
    profile?.routing?.fallback_on_error ?? true,
  );
  const [authMode, setAuthMode] = useState<AiAuthMode>(profile?.auth_mode ?? "bearer");
  const [systemPrompt, setSystemPrompt] = useState(profile?.system_prompt ?? "");
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [testDetailsOpen, setTestDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedJsonPreview, setSavedJsonPreview] = useState<string>("");
  const [jsonLoading, setJsonLoading] = useState(false);
  const id = profile?.id ?? crypto.randomUUID();

  const currentProfile = (): AiProfile => ({
    id,
    name: name.trim(),
    base_url: baseUrl.trim().replace(/\/$/, ""),
    api_key_ref: profile?.api_key_ref ?? `ai.${id}.key`,
    auth_mode: authMode,
    system_prompt: systemPrompt,
    models: models.map((item) => ({ ...item, model: item.model.trim() })),
    routing: {
      ...DEFAULT_ROUTING,
      fallback_on_error: fallbackOnError,
    },
  });

  const draftJson = JSON.stringify(
    {
      version: 2,
      ai_profiles: [currentProfile()],
      note: "API key is stored in the OS credential vault",
    },
    null,
    2,
  );

  const save = async () => {
    if (
      !name.trim() ||
      !baseUrl.trim() ||
      !models.some((item) => item.enabled && item.model.trim())
    ) {
      notify("名称、Base URL 和至少一个启用模型不能为空", "error");
      return;
    }
    setSaving(true);
    try {
      const next = currentProfile();
      await aiProfileSave(next, apiKey || undefined);
      setApiKey("");
      onSaved(next);
      notify("AI 配置已保存", "success");
      onClose();
    } catch (error) {
      notify(errorMessage(error, "保存失败：未返回可读的错误信息"), "error");
    } finally {
      setSaving(false);
    }
  };

  const refreshSavedJson = async () => {
    setJsonLoading(true);
    try {
      const value = await aiConfigJson();
      setSavedJsonPreview(JSON.stringify(value, null, 2));
      notify("已刷新后端 JSON 配置", "success");
    } catch (error) {
      notify(errorMessage(error, "读取后端 JSON 失败：未返回可读的错误信息"), "error");
    } finally {
      setJsonLoading(false);
    }
  };

  const openLocalConfig = async () => {
    try {
      const path = await configOpenLocal();
      notify(`已打开本地配置：${path}`, "success");
    } catch (error) {
      notify(errorMessage(error, "打开本地配置失败：未返回可读的错误信息"), "error");
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    setTestDetailsOpen(false);
    try {
      const next = currentProfile();
      try {
        await aiProfileSave(next, apiKey || undefined);
      } catch (error) {
        setTestResult({
          ok: false,
          error: diagnosticFromThrownError(error, "save_profile", "保存 AI 配置"),
        });
        return;
      }
      try {
        setTestResult(await aiTestConnection(next.id));
      } catch (error) {
        setTestResult({
          ok: false,
          error: diagnosticFromThrownError(error, "test_connection", "测试连接"),
        });
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      footer={
        <>
          <button className="button button-ghost" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="button button-primary"
            disabled={saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? "保存中" : "保存配置"}
          </button>
        </>
      }
      onClose={onClose}
      size="large"
      title="AI 服务设置"
    >
      <div className="ai-settings-form">
        <div className="field field-span">
          <span>服务商预设</span>
          <div className="preset-row">
            {PRESETS.map((preset) => (
              <button
                className={baseUrl === preset.baseUrl ? "is-active" : ""}
                key={preset.name}
                onClick={() => {
                  setName(preset.name === "自定义" ? "公司网关" : preset.name);
                  setBaseUrl(preset.baseUrl);
                  setModels((current) => {
                    const next = current.length ? [...current] : defaultModels(preset.model);
                    const primary = next.find((item) => item.role === "primary") ?? next[0];
                    if (primary) primary.model = preset.model;
                    return next;
                  });
                  setTestResult(null);
                  setTestDetailsOpen(false);
                }}
                type="button"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>配置名称</span>
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="field field-span">
          <span>Base URL</span>
          <input onChange={(event) => setBaseUrl(event.target.value)} value={baseUrl} />
        </label>
        <label className="field field-span">
          <span>API Key</span>
          <input
            autoComplete="new-password"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={profile ? "已安全保存，留空保持不变" : "仅存入系统凭据管理器"}
            type="password"
            value={apiKey}
          />
          <small>密钥不会写入配置文件、日志或前端存储。</small>
        </label>
        <label className="field field-span">
          <span>认证方式</span>
          <select
            aria-label="AI 认证方式"
            onChange={(event) => setAuthMode(event.target.value as AiAuthMode)}
            value={authMode}
          >
            <option value="bearer">Bearer Token · Authorization: Bearer sk-...</option>
            <option value="api_key">API Key · Authorization: sk-...</option>
          </select>
          <small>Bearer Token 适用于 OpenAI 兼容网关；API Key 保留原始密钥头值。</small>
        </label>
        <label className="field field-span">
          <span>System Prompt</span>
          <textarea
            onChange={(event) => setSystemPrompt(event.target.value)}
            placeholder="留空使用内置 Linux 运维助手提示词"
            rows={4}
            value={systemPrompt}
          />
        </label>
        <div className="field field-span ai-model-routing">
          <div className="field-label-row">
            <span>模型路由</span>
            <small>主模型优先；请求失败时按分析模型、备用模型顺序切换。</small>
          </div>
          <div className="ai-model-list">
            {models.map((item, index) => (
              <div className="ai-model-row" key={item.id}>
                <select
                  aria-label={`${item.name}角色`}
                  onChange={(event) =>
                    setModels((current) =>
                      current.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, role: event.target.value as AiModelRole }
                          : candidate,
                      ),
                    )
                  }
                  value={item.role}
                >
                  <option value="primary">主模型</option>
                  <option value="analysis">分析模型</option>
                  <option value="fallback">备用模型</option>
                </select>
                <input
                  aria-label={`${item.name}模型名称`}
                  onChange={(event) =>
                    setModels((current) =>
                      current.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, model: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                  placeholder="模型 ID"
                  value={item.model}
                />
                <label className="ai-model-enabled">
                  <input
                    checked={item.enabled}
                    onChange={(event) =>
                      setModels((current) =>
                        current.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? { ...candidate, enabled: event.target.checked }
                            : candidate,
                        ),
                      )
                    }
                    type="checkbox"
                  />
                  启用
                </label>
                {models.length > 1 ? (
                  <button
                    aria-label={`删除${item.name}`}
                    className="button button-ghost"
                    onClick={() =>
                      setModels((current) =>
                        current.filter((_, candidateIndex) => candidateIndex !== index),
                      )
                    }
                    type="button"
                  >
                    删除
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="ai-model-actions">
            <button
              className="button button-ghost"
              onClick={() =>
                setModels((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    name: "备用模型",
                    model: "",
                    role: "fallback",
                    enabled: false,
                  },
                ])
              }
              type="button"
            >
              + 添加模型
            </button>
            <label className="ai-model-enabled">
              <input
                checked={fallbackOnError}
                onChange={(event) => setFallbackOnError(event.target.checked)}
                type="checkbox"
              />
              失败时自动切换
            </label>
          </div>
          <small>
            终端上下文不再按固定行数截断；Agent 会按 offset/nextOffset 分段读取完整输出。
          </small>
        </div>
        <div className="connection-test">
          <button
            className="button button-secondary"
            disabled={testing}
            onClick={() => void test()}
            type="button"
          >
            {testing ? "测试中" : "测试连接"}
          </button>
          {testResult ? (
            testResult.ok ? (
              <div className="test-success connection-test-success">
                <div className="test-success-summary">
                  <span>连接成功 · {testResult.models ?? 0} 个模型</span>
                  <button
                    aria-expanded={testDetailsOpen}
                    className="button button-ghost test-details-button"
                    onClick={() => setTestDetailsOpen((open) => !open)}
                    type="button"
                  >
                    {testDetailsOpen ? "收起模型详情" : "查看模型详情"}
                  </button>
                </div>
                {testDetailsOpen ? (
                  <div className="model-test-details">
                    <div className="test-error-meta">
                      <span>请求地址</span>
                      <code>{testResult.endpoint ?? "未返回"}</code>
                    </div>
                    <div className="model-test-list">
                      {(testResult.modelDetails ?? []).map((model, index) => (
                        <div className="model-test-item" key={JSON.stringify(model)}>
                          <strong>{String(model.id ?? `模型 ${index + 1}`)}</strong>
                          <pre>{JSON.stringify(model, null, 2)}</pre>
                        </div>
                      ))}
                    </div>
                    {testResult.rawResponse ? (
                      <details className="model-test-raw" open>
                        <summary>原始返回 JSON</summary>
                        <pre>{testResult.rawResponse}</pre>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="test-error connection-test-error" role="alert">
                <div className="test-error-summary">
                  <strong>{testResult.error?.summary ?? "测试连接 · unknown_error"}</strong>
                  <code>{testResult.error?.code ?? "unknown_error"}</code>
                  <button
                    aria-expanded={testDetailsOpen}
                    className="button button-ghost test-details-button"
                    onClick={() => setTestDetailsOpen((open) => !open)}
                    type="button"
                  >
                    {testDetailsOpen ? "收起详情" : "查看详情"}
                  </button>
                </div>
                {testDetailsOpen ? (
                  <div className="test-error-detail">
                    <div className="test-error-meta">
                      <span>失败位置</span>
                      <code>{testResult.error?.stage ?? "test_connection"}</code>
                    </div>
                    <pre>{testResult.error?.detail ?? "未返回详细错误"}</pre>
                    {testResult.error?.stack ? (
                      <div className="test-error-stack">
                        <div className="test-error-meta">
                          <span>调用堆栈</span>
                        </div>
                        <pre>{testResult.error.stack}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          ) : null}
        </div>
        <details className="ai-json-preview" open>
          <summary>JSON 配置预览（密钥仅保存为凭据引用）</summary>
          <div className="ai-json-actions">
            <button
              className="button button-ghost"
              disabled={jsonLoading}
              onClick={() => void refreshSavedJson()}
              type="button"
            >
              {jsonLoading ? "读取中" : "刷新后端 JSON"}
            </button>
            <button
              className="button button-ghost"
              onClick={() => void openLocalConfig()}
              type="button"
            >
              在本地打开
            </button>
          </div>
          <div className="ai-json-columns">
            <div>
              <div className="ai-json-caption">当前编辑内容（实时）</div>
              <pre>{draftJson}</pre>
            </div>
            <div>
              <div className="ai-json-caption">后端已保存内容</div>
              <pre>{savedJsonPreview || "点击“刷新后端 JSON”读取实际配置文件"}</pre>
            </div>
          </div>
        </details>
      </div>
    </Modal>
  );
}
