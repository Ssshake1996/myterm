import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDot,
  History,
  LoaderCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type AgentEvent,
  type AgentSettings as AgentSettingsValue,
  type AgentTask,
  type AiProfile,
  agentAbort,
  agentApprove,
  agentJobCancel,
  agentRun,
  agentSettingsGet,
  agentSettingsSave,
  agentTaskDelete,
  agentTaskEvents,
  agentTaskList,
  aiProfileList,
  createChannel,
  errorMessage,
  ipcErrorCode,
} from "../../ipc";
import { getActivePane, useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";
import { AgentSettings } from "./AgentSettings";
import { AiSettings } from "./AiSettings";
import { MarkdownContent } from "./MarkdownContent";

const DEFAULT_AGENT_SETTINGS: AgentSettingsValue = {
  permission_mode: "confirm",
  skill_directories: [],
  enabled_skills: [],
  mcp_servers: [],
};

const MIN_AGENT_COMPOSER_HEIGHT = 111;
const AGENT_COMPOSER_HEIGHT_STEP = 16;

function agentComposerMaxHeight(panel: HTMLElement | null) {
  const measuredHeight = panel?.clientHeight ?? 0;
  const panelHeight = measuredHeight > 0 ? measuredHeight : window.innerHeight;
  return Math.max(MIN_AGENT_COMPOSER_HEIGHT, Math.floor(panelHeight / 2));
}

function clampAgentComposerHeight(value: number, panel: HTMLElement | null) {
  return Math.min(agentComposerMaxHeight(panel), Math.max(MIN_AGENT_COMPOSER_HEIGHT, value));
}

type ToolStatus = "requested" | "approval" | "running" | "success" | "error";

interface PolicySummary {
  action?: "allow" | "ask" | "deny";
  effect?: "read" | "execute" | "write";
  risk?: "low" | "medium" | "high" | "critical";
  reason?: string;
  resources?: string[];
}

type TraceEntry =
  | { id: string; kind: "task"; content: string; session?: string }
  | {
      id: string;
      kind: "status";
      content: string;
      detail?: string;
      errorCode?: string;
      step?: number;
      error?: boolean;
    }
  | { id: string; kind: "assistant"; content: string; step?: number }
  | {
      id: string;
      kind: "tool";
      callId: string;
      toolName: string;
      pluginId?: string;
      arguments?: unknown;
      result?: string;
      stdout?: string;
      stderr?: string;
      policy?: PolicySummary;
      step?: number;
      status: ToolStatus;
      jobId?: string;
      jobState?: string;
      errorCode?: string;
    };

interface AiPanelProps {
  collapsed: boolean;
  onCollapsedChange: (value: boolean) => void;
}

const TOOL_LABELS: Record<string, string> = {
  remote_exec: "结构化执行命令",
  terminal_context: "读取终端上下文",
  terminal_send: "向活动终端发送命令",
  session_info: "读取会话信息",
  list_directory: "查看文件目录",
};

function toolLabel(name: string) {
  return TOOL_LABELS[name] ?? name;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function reduceAgentEvent(current: TraceEntry[], event: AgentEvent): TraceEntry[] {
  const eventId = event.sequence ? `${event.runId}:${event.sequence}` : crypto.randomUUID();
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
        pluginId: event.pluginId,
        arguments: event.arguments,
        step: event.step,
        status: "requested",
      },
    ];
  }
  if (event.eventType === "policy" && event.callId) {
    return updateTool(current, event.callId, {
      policy: asRecord(event.arguments) as PolicySummary,
    });
  }
  if (event.eventType === "approval_required" && event.callId) {
    const detail = asRecord(event.arguments);
    return updateTool(current, event.callId, {
      arguments: detail.toolArguments ?? event.arguments,
      policy: asRecord(detail.policy) as PolicySummary,
      status: "approval",
    });
  }
  if (event.eventType === "tool_output" && event.callId) {
    const stream = asRecord(event.arguments).stream;
    const patch: Partial<Extract<TraceEntry, { kind: "tool" }>> = { status: "running" };
    const tool = current.find(
      (entry): entry is Extract<TraceEntry, { kind: "tool" }> =>
        entry.kind === "tool" && entry.callId === event.callId,
    );
    if (stream === "stderr") patch.stderr = `${tool?.stderr ?? ""}${event.content ?? ""}`;
    else patch.stdout = `${tool?.stdout ?? ""}${event.content ?? ""}`;
    return updateTool(current, event.callId, patch);
  }
  if (event.eventType === "tool_result" && event.callId) {
    const tool = current.find(
      (entry): entry is Extract<TraceEntry, { kind: "tool" }> =>
        entry.kind === "tool" && entry.callId === event.callId,
    );
    const jobStillRunning = tool?.jobState === "running" || tool?.jobState === "canceling";
    return updateTool(current, event.callId, {
      result: event.content ?? "",
      errorCode: event.errorCode,
      status: event.isError ? "error" : jobStillRunning ? "running" : "success",
    });
  }
  if (event.eventType === "job_started" && event.callId) {
    const detail = asRecord(event.arguments);
    return updateTool(current, event.callId, {
      jobId: typeof detail.id === "string" ? detail.id : undefined,
      jobState: "running",
      status: "running",
    });
  }
  if (event.eventType === "job_finished" && event.callId) {
    const detail = asRecord(event.arguments);
    const state = typeof detail.state === "string" ? detail.state : "failed";
    return updateTool(current, event.callId, {
      jobId: typeof detail.jobId === "string" ? detail.jobId : undefined,
      jobState: state,
      result: formatArguments(detail),
      status: state === "succeeded" ? "success" : "error",
    });
  }
  if (event.eventType === "assistant") {
    return [
      ...current,
      { id: eventId, kind: "assistant", content: event.content ?? "", step: event.step },
    ];
  }
  if (
    event.eventType === "mcp_error" ||
    event.eventType === "status" ||
    event.eventType === "hook" ||
    event.eventType === "context_compacted"
  ) {
    return [
      ...current,
      {
        id: eventId,
        kind: "status",
        content: event.message ?? (event.eventType === "mcp_error" ? "MCP" : "Codex Core 运行中"),
        detail: event.eventType === "mcp_error" ? event.content : undefined,
        errorCode: event.errorCode,
        step: event.step,
        error: event.eventType === "mcp_error",
      },
    ];
  }
  if (event.eventType === "complete") {
    const labels: Record<string, string> = {
      limit: "已达到 Codex Core 内部安全边界",
      aborted: "任务已停止",
      loop_detected: "Codex Core 检测到重复工具调用，任务已停止",
      failed: "任务执行失败",
      stop: "任务完成",
    };
    return [
      ...current,
      {
        id: eventId,
        kind: "status",
        content: labels[event.message ?? ""] ?? "任务完成",
        detail: event.isError ? event.content : undefined,
        errorCode: event.errorCode,
        step: event.step,
        error: !["stop", "aborted"].includes(event.message ?? ""),
      },
    ];
  }
  return current;
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
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [input, setInput] = useState("");
  const [attach, setAttach] = useState(true);
  const [running, setRunning] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [width, setWidth] = useState(372);
  const [composerHeight, setComposerHeight] = useState(MIN_AGENT_COMPOSER_HEIGHT);
  const [composerMaxHeight, setComposerMaxHeight] = useState(() => agentComposerMaxHeight(null));
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Promise.all([aiProfileList(), agentSettingsGet(), agentTaskList()])
      .then(([items, settings, savedTasks]) => {
        setProfiles(items);
        setProfileId((current) => current || items[0]?.id || "");
        setAgentSettings(settings);
        setTasks(savedTasks);
      })
      .catch((error) =>
        notify(errorMessage(error, "Agent 配置读取失败：未返回可读的错误信息"), "error"),
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

  useEffect(() => {
    if (collapsed) return;
    let frame = 0;
    const syncToPanel = () => {
      const maximum = agentComposerMaxHeight(panelRef.current);
      setComposerMaxHeight(maximum);
      setComposerHeight((value) => Math.min(maximum, Math.max(MIN_AGENT_COMPOSER_HEIGHT, value)));
    };
    const queueSync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncToPanel);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(queueSync);
    if (panelRef.current) observer?.observe(panelRef.current);
    queueSync();
    window.addEventListener("resize", queueSync);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", queueSync);
    };
  }, [collapsed]);

  const currentProfile = profiles.find((profile) => profile.id === profileId) ?? null;

  const scrollToBottom = () => {
    window.requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
    );
  };

  const onAgentEvent = (event: AgentEvent) => {
    setSelectedTaskId(event.runId);
    setEntries((current) => reduceAgentEvent(current, event));
    if (event.eventType === "complete") {
      void agentTaskList()
        .then(setTasks)
        .catch(() => undefined);
    }
    scrollToBottom();
  };

  const loadTask = async (task: AgentTask) => {
    try {
      const events = await agentTaskEvents(task.id, 0, 1_000);
      const initial: TraceEntry[] = [
        {
          id: `task:${task.id}`,
          kind: "task",
          content: task.prompt,
          session: task.sessionId ?? undefined,
        },
      ];
      setEntries(events.reduce(reduceAgentEvent, initial));
      setSelectedTaskId(task.id);
      setHistoryOpen(false);
      scrollToBottom();
    } catch (error) {
      notify(errorMessage(error, "任务历史读取失败：未返回可读的错误信息"), "error");
    }
  };

  const removeTask = async (taskId: string) => {
    try {
      await agentTaskDelete(taskId);
      setTasks((current) => current.filter((task) => task.id !== taskId));
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
        setEntries([]);
      }
    } catch (error) {
      notify(errorMessage(error, "任务删除失败：未返回可读的错误信息"), "error");
    }
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
      setSelectedTaskId(result.runId);
      void agentTaskList()
        .then(setTasks)
        .catch(() => undefined);
      if (result.finishReason === "limit") notify("Codex Core 已达到内部安全边界", "error");
    } catch (error) {
      const message = errorMessage(error, "Agent 运行失败：未返回可读的错误信息");
      setEntries((current) => {
        const alreadyRendered = current.some(
          (entry) => entry.kind === "status" && entry.error && entry.detail === message,
        );
        if (alreadyRendered) return current;
        return [
          ...current,
          {
            id: crypto.randomUUID(),
            kind: "status",
            content: "Agent 运行失败",
            detail: message,
            errorCode: ipcErrorCode(error),
            error: true,
          },
        ];
      });
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
          result: errorMessage(error, "审批请求失败：未返回可读的错误信息"),
          errorCode: ipcErrorCode(error),
          status: "error",
        }),
      );
    }
  };

  const cancelJob = async (callId: string, jobId: string) => {
    setEntries((current) => updateTool(current, callId, { jobState: "canceling" }));
    try {
      const job = await agentJobCancel(jobId);
      setEntries((current) => updateTool(current, callId, { jobState: job.state }));
    } catch (error) {
      setEntries((current) =>
        updateTool(current, callId, {
          result: errorMessage(error, "Job 取消失败：未返回可读的错误信息"),
          errorCode: ipcErrorCode(error),
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
      notify(errorMessage(error, "权限模式保存失败：未返回可读的错误信息"), "error");
    }
  };

  const beginResize = (event: React.PointerEvent<HTMLHRElement>) => {
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

  const beginComposerResize = (event: React.PointerEvent<HTMLHRElement>) => {
    const startY = event.clientY;
    const startHeight = composerHeight;
    const move = (moveEvent: PointerEvent) => {
      setComposerHeight(
        clampAgentComposerHeight(startHeight + startY - moveEvent.clientY, panelRef.current),
      );
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
    <aside className="ai-panel" ref={panelRef} style={{ width }}>
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
            <strong>Codex Harness Agent</strong>
            <small>dsh-codex-agent · {activePane?.title ?? "未绑定活动会话"}</small>
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
              {profile.name} ·{" "}
              {profile.models?.find((model) => model.role === "primary")?.model ??
                profile.model ??
                "未配置模型"}
            </option>
          ))}
        </select>
        <fieldset aria-label="权限模式" className="permission-switch">
          <button
            className={agentSettings.permission_mode === "read_only" ? "is-active" : ""}
            disabled={running}
            onClick={() => void changePermission("read_only")}
            title="仅允许读取工具"
            type="button"
          >
            只读
          </button>
          <button
            className={agentSettings.permission_mode === "confirm" ? "is-active" : ""}
            disabled={running}
            onClick={() => void changePermission("confirm")}
            title="每次工具调用前确认"
            type="button"
          >
            用户确认
          </button>
          <button
            className={agentSettings.permission_mode === "full_access" ? "is-active" : ""}
            disabled={running}
            onClick={() => void changePermission("full_access")}
            title="硬拒绝规则之外不再确认"
            type="button"
          >
            完全授权
          </button>
        </fieldset>
      </div>

      <div className="agent-history-toolbar">
        <button
          className={historyOpen ? "is-active" : ""}
          onClick={() => setHistoryOpen((value) => !value)}
          title="任务历史"
          type="button"
        >
          <History size={12} />
          <span>任务历史</span>
          <small>{tasks.length}</small>
        </button>
        <span>{selectedTaskId ? selectedTaskId.slice(0, 8) : "当前任务"}</span>
        <button
          aria-label="刷新任务历史"
          className="icon-button"
          onClick={() => void agentTaskList().then(setTasks)}
          title="刷新任务历史"
          type="button"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {historyOpen ? (
        <div className="agent-history-list">
          {!tasks.length ? <p>暂无已保存任务</p> : null}
          {tasks.map((task) => (
            <div className={task.id === selectedTaskId ? "is-selected" : ""} key={task.id}>
              <button onClick={() => void loadTask(task)} type="button">
                <span>{task.prompt}</span>
                <small>
                  {task.state.replace("_", " ")} · {new Date(task.updatedAtMs).toLocaleString()}
                </small>
              </button>
              <button
                aria-label="删除任务"
                className="icon-button"
                disabled={!(["succeeded", "failed", "canceled"] as string[]).includes(task.state)}
                onClick={() => void removeTask(task.id)}
                title="删除任务"
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="agent-trace" ref={scrollRef}>
        {!entries.length ? (
          <div className="ai-empty agent-empty">
            <span>
              <Bot size={17} />
            </span>
            <h3>把排查任务交给 dsh-codex-agent</h3>
            <p>Codex Core 会展示模型决策、工具调用、执行结果、上下文压缩和最终答复。</p>
            <div className="agent-capabilities">
              <span>
                <Wrench size={11} /> 终端与文件工具
              </span>
              <span>
                <ShieldCheck size={11} />{" "}
                {agentSettings.permission_mode === "read_only"
                  ? "只读"
                  : agentSettings.permission_mode === "confirm"
                    ? "用户确认"
                    : "完全授权"}
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
              <article
                className={`trace-status${entry.error ? " is-error" : ""}${entry.detail ? " has-detail" : ""}`}
                key={entry.id}
                role={entry.error ? "alert" : undefined}
              >
                <div className="trace-status-line">
                  {entry.error ? <AlertTriangle size={12} /> : <CircleDot size={12} />}
                  <span>{entry.content}</span>
                  {entry.errorCode ? <code>{entry.errorCode}</code> : null}
                  {entry.step ? <small>STEP {entry.step}</small> : null}
                </div>
                {entry.detail ? <pre>{entry.detail}</pre> : null}
              </article>
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
                  <code>
                    {entry.pluginId ? `${entry.pluginId} · ${entry.toolName}` : entry.toolName}
                    {entry.errorCode ? ` · ${entry.errorCode}` : ""}
                  </code>
                </span>
                {entry.step ? <small>STEP {entry.step}</small> : null}
              </header>
              <details open={entry.status === "approval"}>
                <summary>参数摘要</summary>
                <pre>{formatArguments(entry.arguments)}</pre>
              </details>
              {entry.policy ? (
                <div className={`tool-policy risk-${entry.policy.risk ?? "high"}`}>
                  <span>{entry.policy.action ?? "ask"}</span>
                  <strong>{entry.policy.risk ?? "high"}</strong>
                  <small>{entry.policy.reason}</small>
                </div>
              ) : null}
              {entry.jobId ? (
                <div className="job-control">
                  <span>
                    Job <code>{entry.jobId.slice(0, 8)}</code> · {entry.jobState ?? "running"}
                  </span>
                  {entry.jobState === "running" ? (
                    <button
                      className="button button-ghost"
                      onClick={() => entry.jobId && void cancelJob(entry.callId, entry.jobId)}
                      type="button"
                    >
                      <Square size={11} />
                      取消
                    </button>
                  ) : null}
                </div>
              ) : null}
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
              {entry.stdout ? (
                <details className="tool-result">
                  <summary>stdout</summary>
                  <pre>{entry.stdout}</pre>
                </details>
              ) : null}
              {entry.stderr ? (
                <details className="tool-result" open>
                  <summary>stderr</summary>
                  <pre>{entry.stderr}</pre>
                </details>
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
            <LoaderCircle className="spin" size={13} /> dsh-codex-agent 正在运行
          </div>
        ) : null}
      </div>

      <div
        className="ai-composer agent-composer"
        style={{ flexBasis: composerHeight, height: composerHeight }}
      >
        <hr
          aria-label="调整 Agent 输入框高度"
          aria-orientation="horizontal"
          aria-valuemax={composerMaxHeight}
          aria-valuemin={MIN_AGENT_COMPOSER_HEIGHT}
          aria-valuenow={Math.round(composerHeight)}
          className="agent-composer-resizer"
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setComposerHeight((value) =>
                clampAgentComposerHeight(value + AGENT_COMPOSER_HEIGHT_STEP, panelRef.current),
              );
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setComposerHeight((value) =>
                clampAgentComposerHeight(value - AGENT_COMPOSER_HEIGHT_STEP, panelRef.current),
              );
            }
            if (event.key === "Home") {
              event.preventDefault();
              setComposerHeight(MIN_AGENT_COMPOSER_HEIGHT);
            }
            if (event.key === "End") {
              event.preventDefault();
              setComposerHeight(agentComposerMaxHeight(panelRef.current));
            }
          }}
          onPointerDown={beginComposerResize}
          tabIndex={0}
        />
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
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="描述目标，dsh-codex-agent 会决定并调用工具"
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
