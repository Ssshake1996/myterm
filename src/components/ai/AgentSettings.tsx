import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  type AgentPluginInfo,
  type AgentSettings as AgentSettingsValue,
  agentMcpTest,
  agentPluginList,
  agentSettingsSave,
  agentSkillList,
  errorMessage,
  type McpServerConfig,
  type McpToolInfo,
  type SkillInfo,
} from "../../ipc";
import { useUiStore } from "../../store/ui";
import { Modal } from "../shell/Modal";

type SettingsTab = "execution" | "plugins" | "skills" | "mcp";
type McpTestState =
  | { status: "testing" }
  | { status: "success"; tools: McpToolInfo[] }
  | { status: "error"; message: string };

interface AgentSettingsProps {
  settings: AgentSettingsValue;
  onClose: () => void;
  onSaved: (settings: AgentSettingsValue) => void;
}

function normalizedLines(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export function AgentSettings({ settings, onClose, onSaved }: AgentSettingsProps) {
  const notify = useUiStore((state) => state.notify);
  const [tab, setTab] = useState<SettingsTab>("execution");
  const [draft, setDraft] = useState<AgentSettingsValue>(() => structuredClone(settings));
  const [directoryText, setDirectoryText] = useState(settings.skill_directories.join("\n"));
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillLoading, setSkillLoading] = useState(false);
  const [mcpTests, setMcpTests] = useState<Record<string, McpTestState>>({});
  const [saving, setSaving] = useState(false);
  const [plugins, setPlugins] = useState<AgentPluginInfo[]>([]);

  useEffect(() => {
    void agentPluginList()
      .then(setPlugins)
      .catch((error) =>
        notify(errorMessage(error, "插件清单读取失败：未返回可读的错误信息"), "error"),
      );
  }, [notify]);

  const refreshSkills = async (directories = normalizedLines(directoryText)) => {
    setSkillLoading(true);
    try {
      setSkills(await agentSkillList(directories));
    } catch (error) {
      notify(errorMessage(error, "Skill 扫描失败：未返回可读的错误信息"), "error");
    } finally {
      setSkillLoading(false);
    }
  };

  useEffect(() => {
    if (!settings.skill_directories.length) return;
    setSkillLoading(true);
    void agentSkillList(settings.skill_directories)
      .then(setSkills)
      .catch((error) =>
        notify(errorMessage(error, "Skill 扫描失败：未返回可读的错误信息"), "error"),
      )
      .finally(() => setSkillLoading(false));
  }, [notify, settings.skill_directories]);

  const updateServer = (id: string, patch: Partial<McpServerConfig>) => {
    setDraft((current) => ({
      ...current,
      mcp_servers: current.mcp_servers.map((server) =>
        server.id === id ? { ...server, ...patch } : server,
      ),
    }));
    setMcpTests((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const testMcp = async (server: McpServerConfig) => {
    if (!server.name.trim() || !server.command.trim()) {
      notify("MCP 名称和命令不能为空", "error");
      return;
    }
    setMcpTests((current) => ({ ...current, [server.id]: { status: "testing" } }));
    try {
      const tools = await agentMcpTest(server);
      setMcpTests((current) => ({
        ...current,
        [server.id]: { status: "success", tools },
      }));
    } catch (error) {
      setMcpTests((current) => ({
        ...current,
        [server.id]: {
          status: "error",
          message: errorMessage(error, "MCP 连接失败：未返回可读的错误信息"),
        },
      }));
    }
  };

  const save = async () => {
    const directories = normalizedLines(directoryText);
    const servers = draft.mcp_servers.map((server) => ({
      ...server,
      name: server.name.trim(),
      command: server.command.trim(),
      args: server.args.map((arg) => arg.trim()).filter(Boolean),
      cwd: server.cwd?.trim() || null,
    }));
    if (servers.some((server) => !server.name || !server.command)) {
      setTab("mcp");
      notify("每个 MCP 服务器都需要名称和启动命令", "error");
      return;
    }
    const names = servers.map((server) => server.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) {
      setTab("mcp");
      notify("MCP 服务器名称不能重复", "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await agentSettingsSave({
        ...draft,
        max_steps: Math.min(32, Math.max(1, draft.max_steps)),
        skill_directories: directories,
        mcp_servers: servers,
      });
      onSaved(saved);
      notify("Agent 设置已保存", "success");
      onClose();
    } catch (error) {
      notify(errorMessage(error, "Agent 设置保存失败：未返回可读的错误信息"), "error");
    } finally {
      setSaving(false);
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
            className={tab === "plugins" ? "is-active" : ""}
            onClick={() => setTab("plugins")}
            type="button"
          >
            <Plug size={14} /> 插件
          </button>
          <button
            className="button button-primary"
            disabled={saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? "保存中" : "保存设置"}
          </button>
        </>
      }
      onClose={onClose}
      size="large"
      title="Agent 设置"
    >
      <div className="agent-settings">
        <nav aria-label="Agent 设置分类" className="settings-tabs">
          <button
            className={tab === "execution" ? "is-active" : ""}
            onClick={() => setTab("execution")}
            type="button"
          >
            <ShieldCheck size={14} /> 执行权限
          </button>
          <button
            className={tab === "skills" ? "is-active" : ""}
            onClick={() => setTab("skills")}
            type="button"
          >
            <BookOpen size={14} /> Skills
          </button>
          <button
            className={tab === "mcp" ? "is-active" : ""}
            onClick={() => setTab("mcp")}
            type="button"
          >
            <Plug size={14} /> MCP
          </button>
        </nav>

        <div className="plugin-profile-summary">
          <span>Profile</span>
          <code>{draft.profile}</code>
          <span>Bundles</span>
          <code>{draft.bundles.join(" · ") || "无"}</code>
        </div>

        {tab === "execution" ? (
          <section className="settings-pane">
            <div className="setting-row setting-row-stack">
              <div>
                <strong>工具执行权限</strong>
                <small>只读禁止变更；确认模式逐次询问；任务授权仅在当前任务中生效。</small>
              </div>
              <fieldset aria-label="工具执行权限" className="segmented">
                <button
                  className={draft.permission_mode === "read_only" ? "is-active" : ""}
                  onClick={() =>
                    setDraft((current) => ({ ...current, permission_mode: "read_only" }))
                  }
                  type="button"
                >
                  只读
                </button>
                <button
                  className={draft.permission_mode === "confirm" ? "is-active" : ""}
                  onClick={() =>
                    setDraft((current) => ({ ...current, permission_mode: "confirm" }))
                  }
                  type="button"
                >
                  用户确认
                </button>
                <button
                  className={draft.permission_mode === "task_grant" ? "is-active" : ""}
                  onClick={() =>
                    setDraft((current) => ({ ...current, permission_mode: "task_grant" }))
                  }
                  type="button"
                >
                  任务授权
                </button>
              </fieldset>
            </div>
            <label className="setting-row">
              <span>
                <strong>最大循环步数</strong>
                <small>限制一次任务中的模型决策轮次，范围 1 到 32。</small>
              </span>
              <input
                aria-label="最大循环步数"
                max={32}
                min={1}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, max_steps: Number(event.target.value) }))
                }
                type="number"
                value={draft.max_steps}
              />
            </label>
            <div className="permission-note">
              <ShieldCheck size={15} />
              <span>Skill 只会补充 Agent 上下文，不能绕过工具权限和执行边界。</span>
            </div>
          </section>
        ) : null}

        {tab === "plugins" ? (
          <section className="settings-pane">
            <div className="settings-toolbar">
              <span>当前 Profile 已加载 {plugins.length} 个插件</span>
            </div>
            <div className="plugin-list">
              {plugins.map((plugin) => (
                <article className="plugin-row" key={plugin.id}>
                  <div className="plugin-row-heading">
                    <label className="toggle-field compact-toggle">
                      <input
                        checked={
                          draft.enabled_plugins.length === 0 ||
                          draft.enabled_plugins.includes(plugin.id)
                        }
                        onChange={(event) =>
                          setDraft((current) => {
                            const currentEnabled = current.enabled_plugins.length
                              ? current.enabled_plugins
                              : plugins.map((candidate) => candidate.id);
                            const enabled = event.target.checked
                              ? [...new Set([...currentEnabled, plugin.id])]
                              : currentEnabled.filter((id) => id !== plugin.id);
                            return { ...current, enabled_plugins: enabled };
                          })
                        }
                        type="checkbox"
                      />
                      <span className="toggle-track">
                        <span />
                      </span>
                    </label>
                    <strong>{plugin.name}</strong>
                    <code>{plugin.id}</code>
                    <span className="plugin-kind">{plugin.kind}</span>
                  </div>
                  <small>{plugin.description}</small>
                  <span className="plugin-meta">
                    v{plugin.version} · 依赖：
                    {plugin.requires.length ? plugin.requires.join(", ") : "无"}
                  </span>
                </article>
              ))}
              {!plugins.length ? <div className="settings-empty">没有加载插件</div> : null}
            </div>
          </section>
        ) : null}

        {tab === "skills" ? (
          <section className="settings-pane">
            <label className="field">
              <span>本地 Skill 目录，每行一个</span>
              <textarea
                aria-label="Skill 目录"
                onChange={(event) => setDirectoryText(event.target.value)}
                placeholder="F:\\my-skills"
                rows={4}
                value={directoryText}
              />
            </label>
            <div className="settings-toolbar">
              <span>发现 {skills.length} 个 SKILL.md</span>
              <button
                className="button button-secondary"
                disabled={skillLoading}
                onClick={() => void refreshSkills()}
                type="button"
              >
                <RefreshCw size={13} /> {skillLoading ? "扫描中" : "重新扫描"}
              </button>
            </div>
            <div className="skill-list">
              {skills.map((skill) => (
                <label className="skill-row" key={skill.id}>
                  <input
                    checked={draft.enabled_skills.includes(skill.id)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        enabled_skills: event.target.checked
                          ? [...new Set([...current.enabled_skills, skill.id])]
                          : current.enabled_skills.filter((id) => id !== skill.id),
                      }))
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{skill.name}</strong>
                    <small>{skill.description || "无描述"}</small>
                    <code>{skill.path}</code>
                  </span>
                </label>
              ))}
              {!skills.length && !skillLoading ? (
                <div className="settings-empty">填写目录并扫描后，可在这里启用本地 Skill。</div>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "mcp" ? (
          <section className="settings-pane">
            <div className="settings-toolbar">
              <span>{draft.mcp_servers.length} 个 stdio MCP 服务器</span>
              <button
                className="button button-secondary"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    mcp_servers: [
                      ...current.mcp_servers,
                      {
                        id: crypto.randomUUID(),
                        name: "",
                        command: "",
                        args: [],
                        cwd: null,
                        enabled: true,
                      },
                    ],
                  }))
                }
                type="button"
              >
                <Plus size={13} /> 添加服务器
              </button>
            </div>
            <div className="mcp-list">
              {draft.mcp_servers.map((server) => {
                const test = mcpTests[server.id];
                return (
                  <section className="mcp-server" key={server.id}>
                    <header>
                      <label className="toggle-field compact-toggle">
                        <input
                          checked={server.enabled}
                          onChange={(event) =>
                            updateServer(server.id, { enabled: event.target.checked })
                          }
                          type="checkbox"
                        />
                        <span className="toggle-track">
                          <span />
                        </span>
                        <span>{server.name || "未命名服务器"}</span>
                      </label>
                      <button
                        aria-label={`删除 ${server.name || "MCP 服务器"}`}
                        className="icon-button danger-icon"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            mcp_servers: current.mcp_servers.filter(
                              (candidate) => candidate.id !== server.id,
                            ),
                          }))
                        }
                        title="删除服务器"
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </header>
                    <div className="mcp-fields">
                      <label className="field">
                        <span>名称</span>
                        <input
                          aria-label="MCP 名称"
                          onChange={(event) =>
                            updateServer(server.id, { name: event.target.value })
                          }
                          value={server.name}
                        />
                      </label>
                      <label className="field">
                        <span>启动命令</span>
                        <input
                          aria-label="MCP 启动命令"
                          onChange={(event) =>
                            updateServer(server.id, { command: event.target.value })
                          }
                          placeholder="npx"
                          value={server.command}
                        />
                      </label>
                      <label className="field">
                        <span>参数，每行一个</span>
                        <textarea
                          aria-label="MCP 参数"
                          onChange={(event) =>
                            updateServer(server.id, { args: event.target.value.split(/\r?\n/u) })
                          }
                          placeholder={"-y\n@modelcontextprotocol/server-everything"}
                          rows={3}
                          value={server.args.join("\n")}
                        />
                      </label>
                      <label className="field">
                        <span>工作目录，可选</span>
                        <input
                          aria-label="MCP 工作目录"
                          onChange={(event) => updateServer(server.id, { cwd: event.target.value })}
                          value={server.cwd ?? ""}
                        />
                      </label>
                    </div>
                    <footer className="mcp-test-row">
                      <button
                        className="button button-secondary"
                        disabled={test?.status === "testing"}
                        onClick={() => void testMcp(server)}
                        type="button"
                      >
                        <Plug size={13} /> {test?.status === "testing" ? "连接中" : "测试连接"}
                      </button>
                      {test?.status === "success" ? (
                        <span className="test-success">
                          <CheckCircle2 size={13} /> 已连接，发现 {test.tools.length} 个工具
                        </span>
                      ) : null}
                      {test?.status === "error" ? (
                        <div className="test-error mcp-test-error" role="alert">
                          <strong>
                            <AlertCircle size={13} /> MCP 连接失败
                          </strong>
                          <pre>{test.message}</pre>
                        </div>
                      ) : null}
                    </footer>
                  </section>
                );
              })}
              {!draft.mcp_servers.length ? (
                <div className="settings-empty">
                  添加 stdio MCP 服务器后，可测试连接并查看工具。
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
