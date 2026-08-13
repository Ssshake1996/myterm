import { useState } from "react";
import {
  type AiAuthMode,
  type AiProfile,
  type AiTestResult,
  aiProfileSave,
  aiTestConnection,
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

interface AiSettingsProps {
  profile: AiProfile | null;
  onClose: () => void;
  onSaved: (profile: AiProfile) => void;
}

export function AiSettings({ profile, onClose, onSaved }: AiSettingsProps) {
  const notify = useUiStore((state) => state.notify);
  const [name, setName] = useState(profile?.name ?? "DeepSeek");
  const [baseUrl, setBaseUrl] = useState(profile?.base_url ?? "https://api.deepseek.com/v1");
  const [model, setModel] = useState(profile?.model ?? "deepseek-chat");
  const [authMode, setAuthMode] = useState<AiAuthMode>(profile?.auth_mode ?? "bearer");
  const [systemPrompt, setSystemPrompt] = useState(profile?.system_prompt ?? "");
  const [contextLines, setContextLines] = useState(profile?.context_lines ?? 80);
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const id = profile?.id ?? crypto.randomUUID();

  const currentProfile = (): AiProfile => ({
    id,
    name: name.trim(),
    base_url: baseUrl.trim().replace(/\/$/, ""),
    api_key_ref: profile?.api_key_ref ?? `ai.${id}.key`,
    auth_mode: authMode,
    model: model.trim(),
    system_prompt: systemPrompt,
    context_lines: contextLines,
  });

  const save = async () => {
    if (!name.trim() || !baseUrl.trim() || !model.trim()) {
      notify("名称、Base URL 和模型不能为空", "error");
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
      notify(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const next = currentProfile();
      await aiProfileSave(next, apiKey || undefined);
      setTestResult(await aiTestConnection(next.id));
    } catch (error) {
      setTestResult({
        ok: false,
        error: errorMessage(error, "测试连接失败：未返回可读的错误信息"),
      });
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
                  setModel(preset.model);
                  setTestResult(null);
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
        <label className="field">
          <span>模型</span>
          <input onChange={(event) => setModel(event.target.value)} value={model} />
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
        <label className="field range-field">
          <span>终端上下文行数</span>
          <input
            max={500}
            min={20}
            onChange={(event) => setContextLines(Number(event.target.value))}
            type="range"
            value={contextLines}
          />
          <output>{contextLines} 行</output>
        </label>
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
            <span
              className={testResult.ok ? "test-success" : "test-error"}
              role={testResult.ok ? undefined : "alert"}
            >
              {testResult.ok
                ? `连接成功 · ${testResult.models ?? 0} 个模型`
                : `测试失败：${testResult.error}`}
            </span>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
