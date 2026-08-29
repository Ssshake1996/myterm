import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDot,
  Flag,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AgentConversation,
  type AgentEvent,
  type AgentGoal,
  type AgentSettings as AgentSettingsValue,
  type AiProfile,
  agentAbort,
  agentApprove,
  agentConversationCreate,
  agentConversationDelete,
  agentConversationList,
  agentConversationTasks,
  agentGoalCancel,
  agentGoalGet,
  agentGoalPause,
  agentGoalResume,
  agentInputQueue,
  agentJobCancel,
  agentRun,
  agentSettingsGet,
  agentSettingsSave,
  agentSteer,
  agentTaskEvents,
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
import { aiProfileModelLabel } from "./ai-profile";
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
  | {
      id: string;
      kind: "task";
      content: string;
      session?: string;
      turnIndex?: number;
      steering?: boolean;
    }
  | {
      id: string;
      kind: "status";
      content: string;
      detail?: string;
      errorCode?: string;
      step?: number;
      error?: boolean;
      target?: string;
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
      target?: string;
    };

interface AiPanelProps {
  collapsed: boolean;
  onCollapsedChange: (value: boolean) => void;
}

const TOOL_LABELS: Record<string, string> = {
  remote_exec: "结构化执行命令",
  terminal_context: "读取终端上下文",
  terminal_send: "向活动终端发送命令",
  terminal_edit: "编辑终端当前输入",
  session_info: "读取会话信息",
  session_catalog: "读取服务器会话目录",
  session_connect: "自动连接目标服务器",
  cli_execute: "执行完整 CLI 命令",
  cli_execute_batch: "批量执行 CLI 命令",
  capability_search: "搜索外部能力",
  capability_invoke: "调用外部能力",
  capability_invoke_batch: "批量调用外部能力",
  mcp_status: "检查 MCP 服务器状态",
  evidence_read: "读取原始证据",
  list_directory: "查看文件目录",
};

function toolLabel(name: string) {
  return TOOL_LABELS[name] ?? name;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function targetLabel(value: unknown) {
  const record = asRecord(value);
  const name = record.profileName ?? record.profile_name;
  const profileId = record.profileId ?? record.profile_id;
  const sessionId = record.sessionId ?? record.session_id;
  if (typeof name === "string" && name.trim()) return name;
  if (typeof profileId === "string" && profileId.trim()) return `profile:${profileId}`;
  if (typeof sessionId === "string" && sessionId.trim()) {
    return `session:${sessionId.slice(0, 8)}`;
  }
  return undefined;
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
        target: targetLabel(event.arguments),
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
      target: targetLabel(detail.toolArguments ?? event.arguments),
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
  if (
    (event.eventType === "capability_progress" || event.eventType === "session_wait_progress") &&
    event.callId
  ) {
    const detail = asRecord(event.arguments);
    const progress = typeof detail.progress === "number" ? detail.progress : undefined;
    const total = typeof detail.total === "number" ? detail.total : undefined;
    const attempts = typeof detail.attempts === "number" ? detail.attempts : undefined;
    const suffix =
      progress !== undefined
        ? ` (${progress}${total !== undefined ? ` / ${total}` : ""})`
        : attempts !== undefined
          ? ` (第 ${attempts} 次检查)`
          : "";
    return updateTool(current, event.callId, {
      result: `${event.message ?? "工具正在运行"}${suffix}`,
      status: "running",
    });
  }
  if (event.eventType === "assistant") {
    return [
      ...current,
      { id: eventId, kind: "assistant", content: event.content ?? "", step: event.step },
    ];
  }
  if (event.eventType === "user_steer") {
    return [
      ...current,
      {
        id: eventId,
        kind: "task",
        content: event.content ?? "",
        steering: true,
      },
    ];
  }
  if (
    event.eventType === "mcp_error" ||
    event.eventType === "runtime_metrics" ||
    event.eventType === "status" ||
    event.eventType === "hook" ||
    event.eventType === "context_compacted" ||
    event.eventType === "context_state" ||
    event.eventType === "steering_applied" ||
    event.eventType === "target_connecting" ||
    event.eventType === "target_connected" ||
    event.eventType === "skill_restore_warning"
  ) {
    const target = targetLabel(event.arguments);
    return [
      ...current,
      {
        id: eventId,
        kind: "status",
        content: event.message ?? (event.eventType === "mcp_error" ? "MCP" : "Codex Core 运行中"),
        detail: event.eventType === "mcp_error" ? event.content : undefined,
        errorCode: event.errorCode,
        step: event.step,
        error: event.eventType === "mcp_error" || event.eventType === "skill_restore_warning",
        target,
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
      continuation_required: "当前 Turn 已完成，正在自动续跑",
      waiting_approval: "Agent 正在等待用户确认",
      waiting_external: "Agent 正在等待外部结果",
      blocked: "Goal 已阻塞，请查看检查点",
      budget_limited: "Goal 已达到 Token 预算",
      usage_limited: "Goal 已达到服务额度限制",
    };
    const nonErrors = [
      "stop",
      "aborted",
      "continuation_required",
      "waiting_approval",
      "waiting_external",
    ];
    return [
      ...current,
      {
        id: eventId,
        kind: "status",
        content: labels[event.message ?? ""] ?? "任务完成",
        detail: event.isError ? event.content : undefined,
        errorCode: event.errorCode,
        step: event.step,
        error: !nonErrors.includes(event.message ?? ""),
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

const GOAL_STATUS_LABELS: Record<AgentGoal["status"], string> = {
  active: "执行中",
  paused: "已暂停",
  waiting_approval: "等待授权",
  waiting_external: "等待外部结果",
  blocked: "需要处理",
  budget_limited: "预算受限",
  usage_limited: "额度受限",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
};

function compactTokenCount(value: number) {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

async function loadAllTaskEvents(taskId: string) {
  const events: AgentEvent[] = [];
  let afterSequence = 0;
  for (;;) {
    const page = await agentTaskEvents(taskId, afterSequence, 1_000);
    events.push(...page);
    if (page.length < 1_000) return events;
    const nextSequence = page.at(-1)?.sequence ?? afterSequence;
    if (nextSequence <= afterSequence) return events;
    afterSequence = nextSequence;
  }
}

async function loadConversationSnapshot(conversationId: string) {
  const [conversationTasks, conversationGoal] = await Promise.all([
    agentConversationTasks(conversationId),
    agentGoalGet(conversationId),
  ]);
  const eventGroups = await Promise.all(
    conversationTasks.map((task) => loadAllTaskEvents(task.id)),
  );
  const trace = conversationTasks.flatMap((task, index) => {
    const initial: TraceEntry[] = [
      {
        id: `task:${task.id}`,
        kind: "task",
        content: task.prompt,
        session: task.sessionId ?? undefined,
        turnIndex: task.turnIndex,
      },
    ];
    return eventGroups[index].reduce(reduceAgentEvent, initial);
  });
  return { goal: conversationGoal, trace };
}

export function AiPanel({ collapsed, onCollapsedChange }: AiPanelProps) {
  const activePane = useLayoutStore(getActivePane);
  const notify = useUiStore((state) => state.notify);
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [agentSettings, setAgentSettings] = useState(DEFAULT_AGENT_SETTINGS);
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [goal, setGoal] = useState<AgentGoal | null>(null);
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [input, setInput] = useState("");
  const [runningConversationIds, setRunningConversationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [runningInputMode, setRunningInputMode] = useState<"steer" | "queue">("steer");
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [width, setWidth] = useState(372);
  const [composerHeight, setComposerHeight] = useState(MIN_AGENT_COMPOSER_HEIGHT);
  const [composerMaxHeight, setComposerMaxHeight] = useState(() => agentComposerMaxHeight(null));
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const backgroundSnapshotRef = useRef("");

  useEffect(() => {
    void Promise.all([aiProfileList(), agentSettingsGet(), agentConversationList()])
      .then(([items, settings, savedConversations]) => {
        setProfiles(items);
        setProfileId((current) => current || items[0]?.id || "");
        setAgentSettings(settings);
        setConversations(savedConversations);
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
  const currentConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;
  const running = runningConversationIds.size > 0;
  const locallyRunning = selectedConversationId
    ? runningConversationIds.has(selectedConversationId)
    : false;
  const currentConversationRunning = Boolean(
    selectedConversationId &&
      (locallyRunning ||
        (goal?.conversationId === selectedConversationId && goal.status === "active")),
  );

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
    backgroundSnapshotRef.current = "";
  }, [selectedConversationId]);

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
    );
  }, []);

  useEffect(() => {
    if (
      collapsed ||
      !selectedConversationId ||
      locallyRunning ||
      !goal ||
      !["active", "waiting_external"].includes(goal.status)
    ) {
      return;
    }
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const snapshot = await loadConversationSnapshot(selectedConversationId);
        if (disposed || selectedConversationIdRef.current !== selectedConversationId) return;
        const signature = `${snapshot.goal?.updatedAtMs ?? 0}:${snapshot.trace.length}:${snapshot.trace.at(-1)?.id ?? ""}`;
        if (backgroundSnapshotRef.current !== signature) {
          backgroundSnapshotRef.current = signature;
          setGoal(snapshot.goal);
          setEntries(snapshot.trace);
          scrollToBottom();
        }
      } catch {
        // The foreground action surfaces errors. Background refresh retries on the next tick.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [collapsed, goal, locallyRunning, scrollToBottom, selectedConversationId]);

  const onAgentEvent = (conversationId: string, event: AgentEvent) => {
    if (selectedConversationIdRef.current === conversationId) {
      setEntries((current) => reduceAgentEvent(current, event));
      scrollToBottom();
    }
    if (event.eventType === "complete") {
      void agentConversationList()
        .then(setConversations)
        .catch(() => undefined);
      void agentGoalGet(conversationId)
        .then((nextGoal) => {
          if (selectedConversationIdRef.current === conversationId) setGoal(nextGoal);
        })
        .catch(() => undefined);
    }
  };

  const loadConversation = async (conversation: AgentConversation) => {
    try {
      const snapshot = await loadConversationSnapshot(conversation.id);
      setEntries(snapshot.trace);
      setProfileId(conversation.profileId);
      selectedConversationIdRef.current = conversation.id;
      setSelectedConversationId(conversation.id);
      setGoal(snapshot.goal);
      setHistoryOpen(false);
      scrollToBottom();
    } catch (error) {
      notify(errorMessage(error, "任务历史读取失败：未返回可读的错误信息"), "error");
    }
  };

  const removeConversation = async (conversationId: string) => {
    try {
      await agentConversationDelete(conversationId);
      setConversations((current) =>
        current.filter((conversation) => conversation.id !== conversationId),
      );
      if (selectedConversationId === conversationId) {
        selectedConversationIdRef.current = null;
        setSelectedConversationId(null);
        setGoal(null);
        setEntries([]);
      }
    } catch (error) {
      notify(errorMessage(error, "任务删除失败：未返回可读的错误信息"), "error");
    }
  };

  const startNewConversation = async () => {
    if (!profileId) {
      setAiSettingsOpen(true);
      return;
    }
    try {
      const conversation = await agentConversationCreate(profileId);
      setConversations((current) => [conversation, ...current]);
      selectedConversationIdRef.current = conversation.id;
      setSelectedConversationId(conversation.id);
      setGoal(null);
      setEntries([]);
      setInput("");
      setHistoryOpen(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } catch (error) {
      notify(errorMessage(error, "新建对话失败：未返回可读的错误信息"), "error");
    }
  };

  const runAgentTask = async (conversationId: string, task: string) => {
    setRunningConversationIds((current) => new Set(current).add(conversationId));
    const channel = createChannel<AgentEvent>();
    channel.onmessage = (event) => onAgentEvent(conversationId, event);
    try {
      const result = await agentRun(
        profileId,
        conversationId,
        task,
        activePane?.sessionId ?? null,
        channel,
      );
      void agentConversationList()
        .then(setConversations)
        .catch(() => undefined);
      void agentGoalGet(conversationId)
        .then((nextGoal) => {
          if (selectedConversationIdRef.current === conversationId) setGoal(nextGoal);
        })
        .catch(() => undefined);
      if (result.finishReason === "budget_limited") {
        notify("Goal 已达到 Token 预算，可调整后继续", "error");
      } else if (result.finishReason === "loop_detected") {
        notify("Goal 因连续无进展而暂停，请查看检查点", "error");
      }
    } catch (error) {
      const message = errorMessage(error, "Agent 运行失败：未返回可读的错误信息");
      if (selectedConversationIdRef.current === conversationId) {
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
      }
      notify(message, "error");
    } finally {
      setRunningConversationIds((current) => {
        const next = new Set(current);
        next.delete(conversationId);
        return next;
      });
      scrollToBottom();
    }
  };

  const send = async () => {
    const task = input.trim();
    if (!task || !profileId) {
      if (!profileId) setAiSettingsOpen(true);
      return;
    }
    if (currentConversationRunning) {
      if (!selectedConversationId) {
        notify("当前运行任务没有可追加的对话标识", "error");
        return;
      }
      try {
        if (runningInputMode === "queue") {
          await agentInputQueue(selectedConversationId, task);
          notify("要求已排队，将在当前 Turn 结束后执行", "success");
        } else {
          await agentSteer(selectedConversationId, task);
        }
        setInput("");
        scrollToBottom();
      } catch (error) {
        notify(errorMessage(error, "追加要求失败：未返回可读的错误信息"), "error");
      }
      return;
    }
    let conversationId = selectedConversationId;
    if (!conversationId) {
      try {
        const conversation = await agentConversationCreate(profileId, task);
        conversationId = conversation.id;
        selectedConversationIdRef.current = conversation.id;
        setSelectedConversationId(conversation.id);
        setConversations((current) => [conversation, ...current]);
      } catch (error) {
        notify(errorMessage(error, "创建对话失败：未返回可读的错误信息"), "error");
        return;
      }
    }
    setEntries((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        kind: "task",
        content: task,
      },
    ]);
    setInput("");
    await runAgentTask(conversationId, task);
  };

  const pauseGoal = async () => {
    if (!goal) return;
    try {
      setGoal(await agentGoalPause(goal.id));
    } catch (error) {
      notify(errorMessage(error, "暂停 Goal 失败：未返回可读的错误信息"), "error");
    }
  };

  const resumeGoal = async () => {
    if (!goal || currentConversationRunning) return;
    try {
      const resumed = await agentGoalResume(goal.id);
      setGoal(resumed);
      await runAgentTask(
        resumed.conversationId,
        "继续执行当前 Goal。请从最近检查点恢复，先核对已完成工作与现有证据，再完成所有剩余事项。",
      );
    } catch (error) {
      notify(errorMessage(error, "恢复 Goal 失败：未返回可读的错误信息"), "error");
    }
  };

  const cancelGoal = async () => {
    if (!goal) return;
    try {
      setGoal(await agentGoalCancel(goal.id));
    } catch (error) {
      notify(errorMessage(error, "取消 Goal 失败：未返回可读的错误信息"), "error");
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
            <small>dsh-codex-agent · 动态目标解析</small>
          </div>
        </div>
        <div className="ai-header-actions">
          <button
            aria-label="新建对话"
            className="new-conversation-button"
            onClick={() => void startNewConversation()}
            title="新建独立对话"
            type="button"
          >
            <MessageSquarePlus size={13} />
            <span>新对话</span>
          </button>
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
          disabled={currentConversationRunning}
          onChange={(event) => {
            setProfileId(event.target.value);
            setSelectedConversationId(null);
            setGoal(null);
            setEntries([]);
            setHistoryOpen(false);
          }}
          value={profileId}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} · {aiProfileModelLabel(profile)}
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
          title="对话历史"
          type="button"
        >
          <History size={12} />
          <span>对话历史</span>
          <small>{conversations.length}</small>
        </button>
        <span title={currentConversation?.title}>{currentConversation?.title ?? "未选择对话"}</span>
        <button
          aria-label="刷新对话历史"
          className="icon-button"
          onClick={() => void agentConversationList().then(setConversations)}
          title="刷新对话历史"
          type="button"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {historyOpen ? (
        <div className="agent-history-list">
          {!conversations.length ? <p>暂无已保存对话</p> : null}
          {conversations.map((conversation) => (
            <div
              className={conversation.id === selectedConversationId ? "is-selected" : ""}
              key={conversation.id}
            >
              <button onClick={() => void loadConversation(conversation)} type="button">
                <span>{conversation.title}</span>
                <small>
                  {conversation.turnCount} 个回合 ·{" "}
                  {new Date(conversation.updatedAtMs).toLocaleString()}
                  {runningConversationIds.has(conversation.id) ||
                  (conversation.id === selectedConversationId && goal?.status === "active")
                    ? " · 执行中"
                    : ""}
                </small>
              </button>
              <button
                aria-label="删除对话"
                className="icon-button"
                disabled={
                  runningConversationIds.has(conversation.id) ||
                  (conversation.id === selectedConversationId && goal?.status === "active")
                }
                onClick={() => void removeConversation(conversation.id)}
                title="删除对话及其全部回合"
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {goal ? (
        <section className={`agent-goal-strip status-${goal.status}`} aria-label="当前 Goal">
          <div className="agent-goal-main">
            <span className="agent-goal-flag">
              <Flag size={12} />
            </span>
            <div>
              <div className="agent-goal-heading">
                <strong>Goal</strong>
                <span>{GOAL_STATUS_LABELS[goal.status]}</span>
              </div>
              <p title={goal.objective}>{goal.objective}</p>
            </div>
          </div>
          <div className="agent-goal-footer">
            <span>续跑 {goal.continuationCount}</span>
            <span>
              {compactTokenCount(goal.tokensUsed)}
              {goal.tokenBudget ? ` / ${compactTokenCount(goal.tokenBudget)}` : ""} tokens
            </span>
            <div className="agent-goal-actions">
              {currentConversationRunning && goal.status === "active" ? (
                <button
                  aria-label="暂停 Goal"
                  onClick={() => void pauseGoal()}
                  title="暂停 Goal"
                  type="button"
                >
                  <Pause size={11} />
                </button>
              ) : null}
              {!currentConversationRunning &&
              ["paused", "blocked", "budget_limited", "usage_limited", "waiting_external"].includes(
                goal.status,
              ) ? (
                <button
                  aria-label="继续 Goal"
                  onClick={() => void resumeGoal()}
                  title="从检查点继续"
                  type="button"
                >
                  <Play size={11} />
                </button>
              ) : null}
              {!["completed", "failed", "canceled"].includes(goal.status) ? (
                <button
                  aria-label="取消 Goal"
                  onClick={() => void cancelGoal()}
                  title="取消 Goal"
                  type="button"
                >
                  <Square size={10} />
                </button>
              ) : null}
            </div>
          </div>
          {goal.blockedReason || goal.lastError ? (
            <details>
              <summary>检查点详情</summary>
              <pre>
                {goal.blockedReason ?? goal.lastError}
                {goal.lastCheckpoint ? `\n${JSON.stringify(goal.lastCheckpoint, null, 2)}` : ""}
              </pre>
            </details>
          ) : null}
        </section>
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
                  <span>
                    {entry.steering
                      ? "追加要求"
                      : entry.turnIndex
                        ? `回合 ${entry.turnIndex}`
                        : "任务"}
                  </span>
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
                  {entry.target ? <code className="trace-target">目标：{entry.target}</code> : null}
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
                {entry.target ? <code className="trace-target">目标：{entry.target}</code> : null}
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
        {currentConversationRunning &&
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
        <div
          className={activePane?.sessionId ? "session-candidate is-ready" : "session-candidate"}
          title="活动 SSH 只是候选目标；仅当任务涉及当前终端或当前服务器时才会使用"
        >
          <CircleDot size={10} />
          <span>活动 SSH 候选</span>
          <small>{activePane?.sessionId ? activePane.title : "无活动会话"}</small>
        </div>
        {currentConversationRunning ? (
          <fieldset className="agent-running-input-mode" aria-label="运行中输入处理方式">
            <legend>运行中输入</legend>
            <button
              className={runningInputMode === "steer" ? "is-active" : ""}
              onClick={() => setRunningInputMode("steer")}
              title="尽快注入当前 Turn"
              type="button"
            >
              立即调整
            </button>
            <button
              className={runningInputMode === "queue" ? "is-active" : ""}
              onClick={() => setRunningInputMode("queue")}
              title="当前 Turn 完成后作为下一条要求执行"
              type="button"
            >
              排队执行
            </button>
          </fieldset>
        ) : null}
        <div className="composer-box">
          <textarea
            aria-label="输入 Agent 任务"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={
              currentConversationRunning
                ? runningInputMode === "queue"
                  ? "继续输入要求；Enter 排队到下一 Turn，Shift+Enter 换行"
                  : "继续输入要求；Enter 调整当前 Turn，Shift+Enter 换行"
                : "描述目标，dsh-codex-agent 会决定并调用工具"
            }
            ref={inputRef}
            rows={3}
            value={input}
          />
          <button
            aria-label={currentConversationRunning ? "追加要求" : "运行 Agent"}
            className={currentConversationRunning ? "composer-send is-steer" : "composer-send"}
            disabled={!input.trim()}
            onClick={() => void send()}
            type="button"
          >
            <Icon name="send" />
          </button>
          {currentConversationRunning ? (
            <button
              aria-label="停止 Agent"
              className="composer-stop"
              onClick={() => void agentAbort(selectedConversationId)}
              title="停止当前回合"
              type="button"
            >
              <Icon name="stop" />
            </button>
          ) : null}
        </div>
      </div>
      {aiSettingsOpen ? (
        <AiSettings
          activeProfileId={profileId}
          onClose={() => setAiSettingsOpen(false)}
          onDeleted={(deletedProfileId) => {
            setProfiles((current) => current.filter((item) => item.id !== deletedProfileId));
          }}
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
          profiles={profiles}
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
