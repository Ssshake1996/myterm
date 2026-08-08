import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDot,
  LoaderCircle,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type AgentEvent,
  type AgentSettings as AgentSettingsValue,
  type AiProfile,
  agentAbort,
  agentApprove,
  agentRun,
  agentSettingsGet,
  agentSettingsSave,
  aiProfileList,
  createChannel,
} from "../../ipc";
import { getActivePane, useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";
import { AgentSettings } from "./AgentSettings";
import { AiSettings } from "./AiSettings";
import { MarkdownContent } from "./MarkdownContent";

const DEFAULT_AGENT_SETTINGS: AgentSettingsValue = {
  permission_mode: "confirm",
  max_steps: 8,
  skill_directories: [],
  enabled_skills: [],
  mcp_servers: [],
};

type ToolStatus = "requested" | "approval" | "running" | "success" | "error";

type TraceEntry =
  | { id: string; kind: "task"; content: string; session?: string }
  | { id: string; kind: "status"; content: string; step?: number; error?: boolean }
  | { id: string; kind: "assistant"; content: string; step?: number }
  | {
      id: string;
      kind: "tool";
      callId: string;
      toolName: string;
      arguments?: unknown;
      result?: string;
      step?: number;
      status: ToolStatus;
    };

interface AiPanelProps {
  collapsed: boolean;
  onCollapsedChange: (value: boolean) => void;
}

const TOOL_LABELS: Record<string, string> = {
  terminal_context: "读取终端上下文",
  terminal_send: "向活动终端发送命令",
  session_info: "读取会话信息",
  list_directory: "查看文件目录",
};

function toolLabel(name: string) {
  return TOOL_LABELS[name] ?? name;
}

function formatArguments(value: unknown) {
  if (!value || (typeof value === "object" && !Object.keys(value).length)) return "无参数";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function updateTool(
  entries: TraceEntry[],
  callId: string,
  patch: Partial<Extract<TraceEntry, { kind: "tool" }>>,
) {
  return entries.map((entry) =>
    entry.kind === "tool" && entry.callId === callId ? { ...entry, ...patch } : entry,
  );
}

export function AiPanel({ collapsed, onCollapsedChange }: AiPanelProps) {
  const activePane = useLayoutStore(getActivePane);
  const notify = useUiStore((state) => state.notify);
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [agentSettings, setAgentSettings] = useState(DEFAULT_AGENT_SETTINGS);
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [input, setInput] = useState("");
  const [attach, setAttach] = useState(true);
  const [running, setRunning] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [width, setWidth] = useState(372);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Promise.all([aiProfileList(), agentSettingsGet()])
      .then(([items, settings]) => {
        setProfiles(items);
        setProfileId((current) => current || items[0]?.id || "");
        setAgentSettings(settings);
      })
      .catch((error) =>
        notify(error instanceof Error ? error.message : "Agent 配置读取失败", "error"),
      );
  }, [notify]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.code !== "KeyA") return;
      event.preventDefault();
      onCollapsedChange(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCollapsedChange]);

  const currentProfile = profiles.find((profile) => profile.id === profileId) ?? null;

  const scrollToBottom = () => {
    window.requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
    );
  };

  const onAgentEvent = (event: AgentEvent) => {
    setEntries((current) => {
      if (event.eventType === "tool_requested" && event.callId && event.toolName) {
        if (current.some((entry) => entry.kind === "tool" && entry.callId === event.callId)) {
          return current;
        }
        return [
          ...current,
          {
            id: event.callId,
            kind: "tool",
            callId: event.callId,
            toolName: event.toolName,
            arguments: event.arguments,
            step: event.step,
            status: "requested",
          },
        ];
      }
      if (event.eventType === "approval_required" && event.callId) {
        return updateTool(current, event.callId, { status: "approval" });
      }
      if (event.eventType === "tool_result" && event.callId) {
        return updateTool(current, event.callId, {
          result: event.content ?? "",
          status: event.isError ? "error" : "success",
        });
      }
      if (event.eventType === "assistant") {
        return [
          ...current,
          {
            id: crypto.randomUUID(),
            kind: "assistant",
            content: event.content ?? "",
            step: event.step,
          },
        ];
      }
      if (event.eventType === "mcp_error") {
        return [
          ...current,
          {
            id: crypto.randomUUID(),
            kind: "status",
            content: event.message ?? "MCP 连接失败",
            step: event.step,
            error: true,
          },
        ];
      }
      if (event.eventType === "status") {
        return [
          ...current,
          {
            id: crypto.randomUUID(),
            kind: "status",
            content: event.message ?? "Agent 运行中",
            step: event.step,
          },
        ];
      }
      if (event.eventType === "complete") {
        const label =
          event.message === "limit"
            ? "已达到最大循环步数"
            : event.message === "aborted"
              ? "任务已停止"
              : "任务完成";
        return [
          ...current,
          {
            id: crypto.randomUUID(),
            kind: "status",
            content: label,
            step: event.step,
            error: event.message === "limit",
          },
        ];
      }
      return current;
    });
    scrollToBottom();
  };

  const send = async () => {
    const task = input.trim();
    if (!task || !profileId || running) {
      if (!profileId) setAiSettingsOpen(true);
      return;
    }
    setEntries((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        kind: "task",
        content: task,
        session: attach && activePane?.sessionId ? activePane.title : undefined,
      },
    ]);
    setInput("");
    setRunning(true);
    const channel = createChannel<AgentEvent>();
    channel.onmessage = onAgentEvent;
    try {
      const result = await agentRun(
        profileId,
        task,
        attach ? (activePane?.sessionId ?? null) : null,
        channel,
      );
      if (result.finishReason === "limit") notify("Agent 已达到最大循环步数", "error");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent 运行失败";
      setEntries((current) => [
        ...current,
        { id: crypto.randomUUID(), kind: "status", content: message, error: true },
      ]);
      notify(message, "error");
    } finally {
      setRunning(false);
      scrollToBottom();
    }
  };

  const approve = async (callId: string, approved: boolean) => {
    setEntries((current) => updateTool(current, callId, { status: "running" }));
    try {
      await agentApprove(callId, approved);
    } catch (error) {
      setEntries((current) =>
        updateTool(current, callId, {
          result: error instanceof Error ? error.message : "审批请求已失效",
          status: "error",
        }),
      );
    }
  };

  const changePermission = async (permissionMode: AgentSettingsValue["permission_mode"]) => {
    const previous = agentSettings;
    const next = { ...agentSettings, permission_mode: permissionMode };
    setAgentSettings(next);
    try {
      setAgentSettings(await agentSettingsSave(next));
    } catch (error) {
      setAgentSettings(previous);
      notify(error instanceof Error ? error.message : "权限模式保存失败", "error");
    }
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: PointerEvent) => {
      setWidth(Math.min(560, Math.max(320, startWidth + startX - moveEvent.clientX)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  if (collapsed) {
    return (
      <aside className="ai-rail">
        <button
          aria-label="展开 Agent"
          onClick={() => onCollapsedChange(false)}
          title="Agent"
          type="button"
        >
          <Bot size={17} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="ai-panel" style={{ width }}>
      <hr
        aria-label="调整 Agent 面板宽度"
        aria-orientation="vertical"
        aria-valuemax={560}
        aria-valuemin={320}
        aria-valuenow={width}
        className="ai-resizer"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") setWidth((value) => Math.min(560, value + 12));
          if (event.key === "ArrowRight") setWidth((value) => Math.max(320, value - 12));
        }}
        onPointerDown={beginResize}
        tabIndex={0}
      />
      <header className="ai-header">
        <div className="ai-heading">
          <span className="ai-mark">
            <Bot size={15} />
          </span>
          <div>
            <strong>myterm Agent</strong>
            <small>{activePane?.title ?? "未绑定活动会话"}</small>
          </div>
        </div>
        <div className="ai-header-actions">
          <button
            aria-label="AI 服务设置"
            className="icon-button"
            onClick={() => setAiSettingsOpen(true)}
            title="AI 服务设置"
            type="button"
          >
            <Settings2 size={15} />
          </button>
          <button
            aria-label="Agent 设置"
            className="icon-button"
            onClick={() => setAgentSettingsOpen(true)}
            title="Agent 设置"
            type="button"
          >
            <SlidersHorizontal size={15} />
          </button>
          <button
            aria-label="折叠 Agent 面板"
            className="icon-button"
            onClick={() => onCollapsedChange(true)}
            title="折叠"
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="ai-profile-row">
        <span className={running ? "profile-status is-running" : "profile-status"} />
        <select
          aria-label="AI 配置"
          disabled={running}
          onChange={(event) => setProfileId(event.target.value)}
          value={profileId}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} · {profile.model}
            </option>
          ))}
        </select>
        <fieldset aria-label="权限模式" className="permission-switch">
          <button
            className={agentSettings.permission_mode === "confirm" ? "is-active" : ""}
            disabled={running}
            onClick={() => void changePermission("confirm")}
            title="每次工具调用前确认"
            type="button"
          >
            确认
          </button>
          <button
            className={agentSettings.permission_mode === "full_access" ? "is-active" : ""}
            disabled={running}
            onClick={() => void changePermission("full_access")}
            title="自动执行工具"
            type="button"
          >
            授权
          </button>
        </fieldset>
      </div>

      <div className="agent-trace" ref={scrollRef}>
        {!entries.length ? (
          <div className="ai-empty agent-empty">
            <span>
              <Bot size={17} />
            </span>
            <h3>把排查任务交给 Agent</h3>
            <p>Agent 会显示模型决策、工具参数、执行结果和最终答复。</p>
            <div className="agent-capabilities">
              <span>
                <Wrench size={11} /> 终端与文件工具
              </span>
              <span>
                <ShieldCheck size={11} />{" "}
                {agentSettings.permission_mode === "confirm" ? "逐次确认" : "完全授权"}
              </span>
            </div>
            <div className="prompt-suggestions">
              <button onClick={() => setInput("检查当前服务器的磁盘和内存使用情况")} type="button">
                检查服务器资源
              </button>
              <button
                onClick={() => setInput("读取当前终端，分析最近一次命令的错误")}
                type="button"
              >
                分析终端错误
              </button>
            </div>
          </div>
        ) : null}
        {entries.map((entry) => {
          if (entry.kind === "task") {
            return (
              <article className="trace-task" key={entry.id}>
                <header>
                  <span>任务</span>
                  {entry.session ? (
                    <small>会话 · {entry.session}</small>
                  ) : (
                    <small>无会话上下文</small>
                  )}
                </header>
                <p>{entry.content}</p>
              </article>
            );
          }
          if (entry.kind === "status") {
            return (
              <div
                className={entry.error ? "trace-status is-error" : "trace-status"}
                key={entry.id}
              >
                {entry.error ? <AlertTriangle size={12} /> : <CircleDot size={12} />}
                <span>{entry.content}</span>
                {entry.step ? <small>STEP {entry.step}</small> : null}
              </div>
            );
          }
          if (entry.kind === "assistant") {
            return (
              <article className="trace-answer" key={entry.id}>
                <header>
                  <Bot size={13} /> 最终答复
                  {entry.step ? <small>STEP {entry.step}</small> : null}
                </header>
                <MarkdownContent content={entry.content} />
              </article>
            );
          }
          return (
            <article className={`trace-tool status-${entry.status}`} key={entry.id}>
              <header>
                <span className="trace-tool-icon">
                  {entry.status === "success" ? <CheckCircle2 size={13} /> : null}
                  {entry.status === "error" ? <XCircle size={13} /> : null}
                  {entry.status === "requested" || entry.status === "approval" ? (
                    <Wrench size={13} />
                  ) : null}
                  {entry.status === "running" ? <LoaderCircle className="spin" size={13} /> : null}
                </span>
                <span>
                  <strong>{toolLabel(entry.toolName)}</strong>
                  <code>{entry.toolName}</code>
                </span>
                {entry.step ? <small>STEP {entry.step}</small> : null}
              </header>
              <details open={entry.status === "approval"}>
                <summary>参数摘要</summary>
                <pre>{formatArguments(entry.arguments)}</pre>
              </details>
              {entry.status === "approval" ? (
                <div className="tool-approval">
                  <span>是否允许执行此工具？</span>
                  <div>
                    <button
                      className="button button-ghost"
                      onClick={() => void approve(entry.callId, false)}
                      type="button"
                    >
                      拒绝
                    </button>
                    <button
                      className="button button-primary"
                      onClick={() => void approve(entry.callId, true)}
                      type="button"
                    >
                      允许执行
                    </button>
                  </div>
                </div>
              ) : null}
              {entry.result !== undefined ? (
                <details className="tool-result" open={entry.status === "error"}>
                  <summary>{entry.status === "error" ? "错误" : "执行结果"}</summary>
                  <pre>{entry.result}</pre>
                </details>
              ) : null}
            </article>
          );
        })}
        {running &&
        !entries.some((entry) => entry.kind === "tool" && entry.status === "approval") ? (
          <div className="trace-running">
            <LoaderCircle className="spin" size={13} /> Agent 正在运行
          </div>
        ) : null}
      </div>

      <div className="ai-composer agent-composer">
        <label className="context-toggle">
          <input
            checked={attach}
            onChange={(event) => setAttach(event.target.checked)}
            type="checkbox"
          />
          <span className="toggle-track">
            <span />
          </span>
          <span>允许使用活动会话工具</span>
          <small>{activePane?.sessionId ? "READY" : "NO SESSION"}</small>
        </label>
        <div className="composer-box">
          <textarea
            aria-label="输入 Agent 任务"
            disabled={running}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="描述目标，Agent 会决定并调用工具"
            ref={inputRef}
            rows={3}
            value={input}
          />
          <button
            aria-label={running ? "停止 Agent" : "运行 Agent"}
            className={running ? "composer-send is-stop" : "composer-send"}
            onClick={() => (running ? void agentAbort() : void send())}
            type="button"
          >
            <Icon name={running ? "stop" : "send"} />
          </button>
        </div>
      </div>
      {aiSettingsOpen ? (
        <AiSettings
          onClose={() => setAiSettingsOpen(false)}
          onSaved={(profile) => {
            setProfiles((current) => {
              const exists = current.some((candidate) => candidate.id === profile.id);
              return exists
                ? current.map((candidate) => (candidate.id === profile.id ? profile : candidate))
                : [...current, profile];
            });
            setProfileId(profile.id);
          }}
          profile={currentProfile}
        />
      ) : null}
      {agentSettingsOpen ? (
        <AgentSettings
          onClose={() => setAgentSettingsOpen(false)}
          onSaved={setAgentSettings}
          settings={agentSettings}
        />
      ) : null}
    </aside>
  );
}
