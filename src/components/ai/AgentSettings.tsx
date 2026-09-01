import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Copy,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  type AgentSettings as AgentSettingsValue,
  agentMcpTest,
  agentSettingsSave,
  agentSkillList,
  errorMessage,
  type McpHeader,
  type McpServerConfig,
  type McpToolInfo,
  type SkillInfo,
} from "../../ipc";
import { useUiStore } from "../../store/ui";
import { Modal } from "../shell/Modal";

type SettingsTab = "execution" | "skills" | "mcp";
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

function parseHeaderLines(value: string): McpHeader[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator < 1) return { name: line, value: "" };
      return {
        name: line.slice(0, separator).trim(),
        value: line.slice(separator + 1).trim(),
      };
    });
}

function formatHeaderLines(headers: McpHeader[] = []) {
  return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand?.("copy") ?? false;
  textarea.remove();
  if (!copied) throw new Error("当前运行环境不允许写入系统剪贴板");
}

export function AgentSettings({ settings, onClose, onSaved }: AgentSettingsProps) {
  const notify = useUiStore((state) => state.notify);
  const [tab, setTab] = useState<SettingsTab>("execution");
  const [draft, setDraft] = useState<AgentSettingsValue>(() => structuredClone(settings));
  const [directoryText, setDirectoryText] = useState(settings.skill_directories.join("\n"));
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillLoading, setSkillLoading] = useState(false);
  const [mcpTests, setMcpTests] = useState<Record<string, McpTestState>>({});
  const [mcpDetailsOpen, setMcpDetailsOpen] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
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
    setMcpDetailsOpen((current) => ({ ...current, [id]: false }));
  };

  const testMcp = async (server: McpServerConfig) => {
    const transport = server.transport ?? "stdio";
    if (
      !server.name.trim() ||
      (transport === "stdio" && !server.command.trim()) ||
      (transport === "streamable_http" && !server.url?.trim())
    ) {
      notify("stdio 服务器需要启动命令，streamable-http 服务器需要 URL", "error");
      return;
    }
    setMcpTests((current) => ({ ...current, [server.id]: { status: "testing" } }));
    setMcpDetailsOpen((current) => ({ ...current, [server.id]: false }));
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
      transport: server.transport ?? "stdio",
      name: server.name.trim(),
      command: server.command.trim(),
      args: server.args.map((arg) => arg.trim()).filter(Boolean),
      cwd: server.cwd?.trim() || null,
      url: server.url?.trim() || null,
      headers: (server.headers ?? [])
        .map((header) => ({ name: header.name.trim(), value: header.value.trim() }))
        .filter((header) => header.name),
    }));
    if (
      servers.some(
        (server) =>
          !server.name ||
          (server.transport === "stdio" && !server.command) ||
          (server.transport === "streamable_http" && !server.url),
      )
    ) {
      setTab("mcp");
      notify("stdio 服务器需要启动命令，streamable-http 服务器需要 URL", "error");
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
          <span className="agent-runtime-badge">内置运行时</span>
          <strong>DeepSeek Harness</strong>
          <small>官方 ACP · Agent Loop · Goal · Compaction · Skill · MCP</small>
        </div>

        {tab === "execution" ? (
          <section className="settings-pane">
            <div className="setting-row setting-row-stack">
              <div>
                <strong>工具执行权限</strong>
                <small>只读禁止变更；用户确认逐次询问；完全授权在硬拒绝规则之外不再弹窗。</small>
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
                  className={draft.permission_mode === "full_access" ? "is-active" : ""}
                  onClick={() =>
                    setDraft((current) => ({ ...current, permission_mode: "full_access" }))
                  }
                  type="button"
                >
                  完全授权
                </button>
              </fieldset>
            </div>
            <div className="permission-note">
              <ShieldCheck size={15} />
              <span>
                Agent Loop、Goal、上下文压缩和本地工具由 DeepSeek Harness 管理；SSH、CLI、SFTP 与多
                SSH 协同由 myterm Host MCP 提供。
              </span>
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
              <span>{draft.mcp_servers.length} 个 MCP 服务器 · 支持 stdio / streamable-http</span>
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
                        transport: "stdio",
                        command: "",
                        args: [],
                        cwd: null,
                        url: null,
                        headers: [],
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
                        <span>传输类型</span>
                        <select
                          aria-label="MCP 传输类型"
                          onChange={(event) =>
                            updateServer(server.id, {
                              transport: event.target.value as McpServerConfig["transport"],
                            })
                          }
                          value={server.transport ?? "stdio"}
                        >
                          <option value="stdio">stdio（本地进程）</option>
                          <option value="streamable_http">streamable-http（HTTP 流式）</option>
                        </select>
                      </label>
                      {(server.transport ?? "stdio") === "stdio" ? (
                        <>
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
                                updateServer(server.id, {
                                  args: event.target.value.split(/\r?\n/u),
                                })
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
                              onChange={(event) =>
                                updateServer(server.id, { cwd: event.target.value })
                              }
                              value={server.cwd ?? ""}
                            />
                          </label>
                        </>
                      ) : (
                        <>
                          <label className="field">
                            <span>Streamable HTTP URL</span>
                            <input
                              aria-label="MCP HTTP URL"
                              onChange={(event) =>
                                updateServer(server.id, { url: event.target.value })
                              }
                              placeholder="https://mcp.example.com/mcp"
                              type="url"
                              value={server.url ?? ""}
                            />
                          </label>
                          <label className="field">
                            <span>请求头，每行 Name: Value</span>
                            <textarea
                              aria-label="MCP 请求头"
                              onChange={(event) =>
                                updateServer(server.id, {
                                  headers: parseHeaderLines(event.target.value),
                                })
                              }
                              placeholder={"Authorization: Bearer sk-...\nX-Tenant: ops"}
                              rows={3}
                              value={formatHeaderLines(server.headers)}
                            />
                          </label>
                        </>
                      )}
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
                        <>
                          <span className="test-success">
                            <CheckCircle2 size={13} /> 已连接，发现 {test.tools.length} 个工具
                          </span>
                          <button
                            aria-expanded={mcpDetailsOpen[server.id] ?? false}
                            className="button button-secondary mcp-details-toggle"
                            onClick={() =>
                              setMcpDetailsOpen((current) => ({
                                ...current,
                                [server.id]: !current[server.id],
                              }))
                            }
                            type="button"
                          >
                            <BookOpen size={12} />
                            {mcpDetailsOpen[server.id] ? "收起详情" : "查看详情"}
                          </button>
                        </>
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
                    {test?.status === "success" && mcpDetailsOpen[server.id] ? (
                      <section
                        aria-label={`${server.name || "未命名"} MCP 工具详情`}
                        className="mcp-tool-details"
                      >
                        <header>
                          <div>
                            <strong>工具清单</strong>
                            <small>
                              {server.name || "未命名"} · {server.transport ?? "stdio"} ·{" "}
                              {test.tools.length} 个
                            </small>
                          </div>
                          <button
                            className="icon-button"
                            onClick={() =>
                              void copyText(
                                JSON.stringify(
                                  {
                                    serverId: server.id,
                                    serverName: server.name,
                                    transport: server.transport ?? "stdio",
                                    toolCount: test.tools.length,
                                    tools: test.tools,
                                  },
                                  null,
                                  2,
                                ),
                              )
                                .then(() => notify("MCP 工具详情已复制", "success"))
                                .catch(() => notify("复制 MCP 工具详情失败", "error"))
                            }
                            title="复制完整工具信息"
                            type="button"
                          >
                            <Copy size={12} />
                          </button>
                        </header>
                        {!test.tools.length ? <p>服务器已连接，但没有返回工具。</p> : null}
                        {test.tools.map((tool) => (
                          <article key={`${tool.serverId}:${tool.name}`}>
                            <header>
                              <code>{tool.title || tool.name}</code>
                              <span>{tool.transport || server.transport || "stdio"}</span>
                            </header>
                            {tool.title ? <small>{tool.name}</small> : null}
                            <p>{tool.description || "未提供工具说明"}</p>
                            <small>
                              {tool.serverName} · {tool.capabilityId || tool.serverId}
                            </small>
                            <strong>Input Schema</strong>
                            <pre>{JSON.stringify(tool.inputSchema ?? {}, null, 2)}</pre>
                            {tool.outputSchema ? (
                              <>
                                <strong>Output Schema</strong>
                                <pre>{JSON.stringify(tool.outputSchema, null, 2)}</pre>
                              </>
                            ) : null}
                            {tool.annotations ? (
                              <>
                                <strong>Annotations（仅作提示）</strong>
                                <pre>{JSON.stringify(tool.annotations, null, 2)}</pre>
                              </>
                            ) : null}
                          </article>
                        ))}
                      </section>
                    ) : null}
                  </section>
                );
              })}
              {!draft.mcp_servers.length ? (
                <div className="settings-empty">
                  添加 stdio 或 streamable-http MCP 服务器后，可测试连接并查看工具。
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
