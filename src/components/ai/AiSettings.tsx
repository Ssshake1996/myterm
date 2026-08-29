import { useState } from "react";
import {
  type AiAuthMode,
  type AiErrorDiagnostic,
  type AiModelConfig,
  type AiModelRole,
  type AiModelTestResult,
  type AiProfile,
  type AiTestResult,
  aiConfigJson,
  aiFetchModels,
  aiProfileDelete,
  aiProfileSave,
  aiTestModel,
  configOpenLocal,
  errorMessage,
} from "../../ipc";
import { useUiStore } from "../../store/ui";
import { Modal } from "../shell/Modal";
import { aiProfileModelLabel, effectiveAiModels, ensurePrimaryAiModel } from "./ai-profile";

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
  profiles?: AiProfile[];
  activeProfileId?: string;
  onClose: () => void;
  onDeleted?: (profileId: string) => void;
  onSaved: (profile: AiProfile) => void;
}

export function AiSettings({
  profile,
  profiles = [],
  activeProfileId,
  onClose,
  onDeleted,
  onSaved,
}: AiSettingsProps) {
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
  const [testPrompt, setTestPrompt] = useState("hi");
  const [testModel, setTestModel] = useState(
    profile ? (effectiveAiModels(profile)[0]?.id ?? "") : "",
  );
  const [modelTesting, setModelTesting] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<AiModelTestResult | null>(null);
  const [modelTestDetailsOpen, setModelTestDetailsOpen] = useState(false);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedJsonPreview, setSavedJsonPreview] = useState<string>("");
  const [jsonLoading, setJsonLoading] = useState(false);
  const [id] = useState(() => profile?.id ?? crypto.randomUUID());

  const currentProfile = (): AiProfile => ({
    id,
    name: name.trim(),
    base_url: baseUrl.trim().replace(/\/$/, ""),
    api_key_ref: profile?.api_key_ref ?? `ai.${id}.key`,
    auth_mode: authMode,
    system_prompt: systemPrompt,
    models: ensurePrimaryAiModel(models).map((item) => ({
      ...item,
      model: item.model.trim(),
      provider_profile_id:
        item.provider_profile_id && item.provider_profile_id !== id
          ? item.provider_profile_id
          : undefined,
    })),
    routing: {
      ...DEFAULT_ROUTING,
      fallback_on_error: fallbackOnError,
    },
  });

  const draftJson = JSON.stringify(
    {
      version: 5,
      ai_profiles: [currentProfile()],
      note: "API key is stored in the OS credential vault",
    },
    null,
    2,
  );
  const enabledModels = models.filter((item) => item.enabled && item.model.trim());
  const selectedTestModel = enabledModels.some((item) => item.id === testModel)
    ? testModel
    : (enabledModels[0]?.id ?? "");

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
        setTestResult(await aiFetchModels(next.id));
      } catch (error) {
        setTestResult({
          ok: false,
          error: diagnosticFromThrownError(error, "fetch_models", "获取模型"),
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const testConfiguredModel = async () => {
    if (!selectedTestModel) {
      notify("请先配置并启用一个模型", "error");
      return;
    }
    if (!testPrompt.trim()) {
      notify("测试提示词不能为空", "error");
      return;
    }
    setModelTesting(true);
    setModelTestResult(null);
    setModelTestDetailsOpen(false);
    try {
      const next = currentProfile();
      try {
        await aiProfileSave(next, apiKey || undefined);
      } catch (error) {
        setModelTestResult({
          ok: false,
          error: diagnosticFromThrownError(error, "save_profile", "保存 AI 配置"),
        });
        return;
      }
      try {
        setModelTestResult(await aiTestModel(next.id, selectedTestModel, testPrompt.trim()));
      } catch (error) {
        setModelTestResult({
          ok: false,
          error: diagnosticFromThrownError(error, "test_model", "测试模型"),
        });
      }
    } finally {
      setModelTesting(false);
    }
  };

  const deleteSavedProfile = async (candidate: AiProfile) => {
    if (candidate.id === activeProfileId) return;
    if (!window.confirm(`确认删除 AI 配置“${candidate.name}”吗？此操作不会删除对话历史。`)) {
      return;
    }
    setDeletingProfileId(candidate.id);
    try {
      await aiProfileDelete(candidate.id);
      onDeleted?.(candidate.id);
      notify(`已删除 AI 配置：${candidate.name}`, "success");
    } catch (error) {
      notify(errorMessage(error, "删除 AI 配置失败：未返回可读的错误信息"), "error");
    } finally {
      setDeletingProfileId(null);
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
      className="modal-ai-settings"
      size="large"
      title="AI 服务设置"
    >
      <div className="ai-settings-scroll">
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
          <div className="field field-span ai-context-adaptive-note">
            <span>Agent 上下文</span>
            <small>
              完全自适应：优先使用 Provider 原生增量上下文；确认不支持后自动记忆能力并切换本地
              checkpoint，无需手工选择协议。
            </small>
          </div>
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
                  <select
                    aria-label={`${item.name}Provider`}
                    onChange={(event) =>
                      setModels((current) =>
                        current.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? {
                                ...candidate,
                                provider_profile_id: event.target.value || undefined,
                              }
                            : candidate,
                        ),
                      )
                    }
                    title="该模型请求使用的服务地址、认证方式和密钥"
                    value={item.provider_profile_id ?? ""}
                  >
                    <option value="">当前 Provider · {name || "未命名"}</option>
                    {profiles
                      .filter((candidate) => candidate.id !== id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </select>
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
                          ensurePrimaryAiModel(
                            current.filter((_, candidateIndex) => candidateIndex !== index),
                          ),
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
              上下文窗口、压缩时机和 Provider 原生/本地 checkpoint 切换均由 Agent
              自适应处理；终端输出按 offset/nextOffset 分段读取，不按固定行数截断。
            </small>
          </div>
          <div className="connection-test">
            <button
              className="button button-secondary"
              disabled={testing}
              onClick={() => void test()}
              type="button"
            >
              {testing ? "获取中" : "获取模型"}
            </button>
            {testResult ? (
              testResult.ok ? (
                <div className="test-success connection-test-success">
                  <div className="test-success-summary">
                    <span>获取成功 · {testResult.models ?? 0} 个模型</span>
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
                    <strong>{testResult.error?.summary ?? "获取模型 · unknown_error"}</strong>
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
                        <code>{testResult.error?.stage ?? "fetch_models"}</code>
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
          <section className="ai-model-probe" aria-label="测试模型">
            <div className="field-label-row">
              <span>测试模型</span>
              <small>向当前配置中启用的指定模型发送一次真实请求。</small>
            </div>
            <div className="ai-model-probe-controls">
              <label className="field">
                <span>模型</span>
                <select
                  aria-label="选择测试模型"
                  onChange={(event) => setTestModel(event.target.value)}
                  value={selectedTestModel}
                >
                  {enabledModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.model}
                      {item.provider_profile_id
                        ? ` · ${profiles.find((candidate) => candidate.id === item.provider_profile_id)?.name ?? "未知 Provider"}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field ai-model-probe-prompt">
                <span>测试提示词</span>
                <textarea
                  aria-label="测试提示词"
                  onChange={(event) => setTestPrompt(event.target.value)}
                  rows={3}
                  value={testPrompt}
                />
              </label>
              <button
                className="button button-primary"
                disabled={modelTesting || !selectedTestModel || !testPrompt.trim()}
                onClick={() => void testConfiguredModel()}
                type="button"
              >
                {modelTesting ? "测试中" : "测试模型"}
              </button>
            </div>
            {modelTestResult ? (
              modelTestResult.ok ? (
                <div className="test-success connection-test-success model-probe-result">
                  <div className="test-success-summary">
                    <span>
                      测试成功 · {modelTestResult.model ?? selectedTestModel}
                      {modelTestResult.elapsedMs !== undefined
                        ? ` · ${modelTestResult.elapsedMs} ms`
                        : ""}
                    </span>
                    <button
                      aria-expanded={modelTestDetailsOpen}
                      className="button button-ghost test-details-button"
                      onClick={() => setModelTestDetailsOpen((open) => !open)}
                      type="button"
                    >
                      {modelTestDetailsOpen ? "收起详情" : "查看详情"}
                    </button>
                  </div>
                  <pre className="model-probe-content">
                    {modelTestResult.content ?? "模型未返回文本"}
                  </pre>
                  {modelTestDetailsOpen ? (
                    <div className="model-test-details">
                      <div className="test-error-meta">
                        <span>请求地址</span>
                        <code>{modelTestResult.endpoint ?? "未返回"}</code>
                      </div>
                      {modelTestResult.rawResponse ? (
                        <details className="model-test-raw" open>
                          <summary>原始返回 JSON</summary>
                          <pre>{modelTestResult.rawResponse}</pre>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="test-error connection-test-error" role="alert">
                  <div className="test-error-summary">
                    <strong>{modelTestResult.error?.summary ?? "测试模型 · unknown_error"}</strong>
                    <code>{modelTestResult.error?.code ?? "unknown_error"}</code>
                    <button
                      aria-expanded={modelTestDetailsOpen}
                      className="button button-ghost test-details-button"
                      onClick={() => setModelTestDetailsOpen((open) => !open)}
                      type="button"
                    >
                      {modelTestDetailsOpen ? "收起详情" : "查看详情"}
                    </button>
                  </div>
                  {modelTestDetailsOpen ? (
                    <div className="test-error-detail">
                      <div className="test-error-meta">
                        <span>失败位置</span>
                        <code>{modelTestResult.error?.stage ?? "test_model"}</code>
                      </div>
                      <pre>{modelTestResult.error?.detail ?? "未返回详细错误"}</pre>
                      {modelTestResult.error?.stack ? (
                        <pre>{modelTestResult.error.stack}</pre>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            ) : null}
          </section>
          {profiles.length ? (
            <section className="saved-ai-profiles" aria-label="已保存 AI 配置">
              <div className="field-label-row">
                <span>已保存配置</span>
                <small>当前使用的配置需先在 Agent 面板切换后才能删除。</small>
              </div>
              <div className="saved-ai-profile-list">
                {profiles.map((candidate) => {
                  const active = candidate.id === activeProfileId;
                  const model = aiProfileModelLabel(candidate);
                  return (
                    <div className="saved-ai-profile-row" key={candidate.id}>
                      <span>
                        <strong>{candidate.name}</strong>
                        <small>{model}</small>
                      </span>
                      {active ? (
                        <span className="saved-ai-profile-active">当前使用</span>
                      ) : (
                        <button
                          aria-label={`删除 AI 配置 ${candidate.name}`}
                          className="button button-danger"
                          disabled={deletingProfileId !== null}
                          onClick={() => void deleteSavedProfile(candidate)}
                          type="button"
                        >
                          {deletingProfileId === candidate.id ? "删除中" : "删除"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
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
      </div>
    </Modal>
  );
}
