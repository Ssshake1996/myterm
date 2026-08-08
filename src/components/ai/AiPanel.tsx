import { useEffect, useRef, useState } from "react";
import {
  type AiMessage,
  type AiProfile,
  aiAbort,
  aiChat,
  aiProfileList,
  createChannel,
} from "../../ipc";
import { getActivePane, useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";
import { AiSettings } from "./AiSettings";
import { MarkdownContent } from "./MarkdownContent";

interface UiMessage extends AiMessage {
  id: string;
  context?: string;
}

interface AiPanelProps {
  collapsed: boolean;
  onCollapsedChange: (value: boolean) => void;
}

export function AiPanel({ collapsed, onCollapsedChange }: AiPanelProps) {
  const activePane = useLayoutStore(getActivePane);
  const notify = useUiStore((state) => state.notify);
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [attach, setAttach] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [width, setWidth] = useState(348);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void aiProfileList()
      .then((items) => {
        setProfiles(items);
        setProfileId((current) => current || items[0]?.id || "");
      })
      .catch(() => notify("AI 配置读取失败", "error"));
  }, [notify]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.code !== "KeyA") return;
      event.preventDefault();
      onCollapsedChange(false);
      setAttach(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCollapsedChange]);

  const currentProfile = profiles.find((profile) => profile.id === profileId) ?? null;

  const send = async () => {
    const question = input.trim();
    if (!question || !profileId) {
      if (!profileId) setSettingsOpen(true);
      return;
    }
    if (streaming) await aiAbort();
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const user: UiMessage = {
      id: userId,
      role: "user",
      content: question,
      context:
        attach && activePane?.sessionId
          ? `活动会话 ${activePane.title} · 最近 ${currentProfile?.context_lines ?? 80} 行终端输出`
          : undefined,
    };
    const history: AiMessage[] = [...messages, user]
      .slice(-20)
      .map(({ role, content }) => ({ role, content }));
    setMessages((current) => [
      ...current,
      user,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setInput("");
    setStreaming(true);
    const channel = createChannel<string>();
    channel.onmessage = (delta) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, content: message.content + delta } : message,
        ),
      );
      window.requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      );
    };
    try {
      const result = await aiChat(
        profileId,
        history,
        attach ? (activePane?.sessionId ?? null) : null,
        channel,
      );
      if (result.attachedContext) {
        setMessages((current) =>
          current.map((message) =>
            message.id === userId ? { ...message, context: result.attachedContext } : message,
          ),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 请求失败";
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId ? { ...item, content: `请求失败：${message}` } : item,
        ),
      );
    } finally {
      setStreaming(false);
    }
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: PointerEvent) => {
      setWidth(Math.min(520, Math.max(300, startWidth + startX - moveEvent.clientX)));
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
          aria-label="展开 AI 助手"
          onClick={() => onCollapsedChange(false)}
          title="AI 助手"
          type="button"
        >
          <Icon name="spark" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="ai-panel" style={{ width }}>
      <hr
        aria-label="调整 AI 面板宽度"
        aria-orientation="vertical"
        aria-valuemax={520}
        aria-valuemin={300}
        aria-valuenow={width}
        className="ai-resizer"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") setWidth((value) => Math.min(520, value + 12));
          if (event.key === "ArrowRight") setWidth((value) => Math.max(300, value - 12));
        }}
        onPointerDown={beginResize}
        tabIndex={0}
      />
      <header className="ai-header">
        <div className="ai-heading">
          <span className="ai-mark">
            <Icon name="spark" />
          </span>
          <div>
            <strong>AI 助手</strong>
            <small>{activePane?.title ?? "等待会话"}</small>
          </div>
        </div>
        <div className="ai-header-actions">
          <button
            aria-label="AI 设置"
            className="icon-button"
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            <Icon name="settings" />
          </button>
          <button
            aria-label="折叠 AI 面板"
            className="icon-button"
            onClick={() => onCollapsedChange(true)}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="ai-profile-row">
        <span className="profile-status" />
        <select
          aria-label="AI 配置"
          onChange={(event) => setProfileId(event.target.value)}
          value={profileId}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} · {profile.model}
            </option>
          ))}
        </select>
        <span className="privacy-mark">LOCAL KEY</span>
      </div>
      <div className="ai-messages" ref={scrollRef}>
        {!messages.length ? (
          <div className="ai-empty">
            <span>
              <Icon name="spark" />
            </span>
            <h3>终端上下文已就绪</h3>
            <p>选择活动会话后即可分析输出或生成命令。</p>
            <div className="prompt-suggestions">
              <button
                onClick={() => setInput("解释当前终端中的错误，并给出修复命令")}
                type="button"
              >
                解释当前错误
              </button>
              <button onClick={() => setInput("生成一个安全的磁盘占用排查命令")} type="button">
                排查磁盘占用
              </button>
            </div>
          </div>
        ) : null}
        {messages.map((message) => (
          <article className={`ai-message message-${message.role}`} key={message.id}>
            <header>{message.role === "user" ? "你" : "MYTERM AI"}</header>
            {message.context ? (
              <details className="context-preview" open={message.role === "user"}>
                <summary>终端上下文</summary>
                <pre>{message.context}</pre>
              </details>
            ) : null}
            {message.role === "assistant" ? (
              message.content ? (
                <MarkdownContent content={message.content} />
              ) : (
                <span className="typing-dots">
                  <i />
                  <i />
                  <i />
                </span>
              )
            ) : (
              <p>{message.content}</p>
            )}
          </article>
        ))}
      </div>
      <div className="ai-composer">
        <label className="context-toggle">
          <input
            checked={attach}
            onChange={(event) => setAttach(event.target.checked)}
            type="checkbox"
          />
          <span className="toggle-track">
            <span />
          </span>
          <span>附带终端上下文</span>
          <small>{currentProfile?.context_lines ?? 80} 行</small>
        </label>
        <div className="composer-box">
          <textarea
            aria-label="询问 AI"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="解释输出、生成命令或排查故障"
            ref={inputRef}
            rows={3}
            value={input}
          />
          <button
            aria-label={streaming ? "停止生成" : "发送"}
            className={streaming ? "composer-send is-stop" : "composer-send"}
            onClick={() => (streaming ? void aiAbort() : void send())}
            type="button"
          >
            <Icon name={streaming ? "stop" : "send"} />
          </button>
        </div>
      </div>
      {settingsOpen ? (
        <AiSettings
          onClose={() => setSettingsOpen(false)}
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
    </aside>
  );
}
