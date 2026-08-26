import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Download,
  ListTree,
  Pencil,
  Plus,
  Search,
  TextCursorInput,
  Upload,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type QuickCommand,
  quickCommandDelete,
  quickCommandImportPreview,
  quickCommandList,
  quickCommandSave,
  type TerminalOutputEventDetail,
  terminalWrite,
} from "../../ipc";
import { getActivePane, useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { Modal } from "../shell/Modal";
import {
  QuickCommandExportModal,
  QuickCommandImportModal,
  type QuickCommandImportState,
} from "./QuickCommandExchange";

const MIN_PANEL_HEIGHT = 168;
const DEFAULT_PANEL_HEIGHT = 224;
const MAX_PANEL_HEIGHT = 420;

const COMMAND_PROMPT_WAIT_MS = 750;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI control sequence parser intentionally matches ESC bytes.
const ANSI_ESCAPE_PATTERN = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI control sequence parser intentionally matches ESC bytes.
const ANSI_SINGLE_ESCAPE_PATTERN = /\x1b./g;

function commandLines(command: string): string[] {
  return command
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

function stripTerminalAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "").replace(ANSI_SINGLE_ESCAPE_PATTERN, "");
}

function hasTerminalPrompt(value: string): boolean {
  const clean = stripTerminalAnsi(value).replace(/\r/g, "");
  return /(?:^|\n)[^\n]{0,160}(?:[$#>])\s*$/u.test(clean);
}

function waitForTerminalPrompt(sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    let transcript = "";
    let settled = false;
    const timer = window.setTimeout(finish, COMMAND_PROMPT_WAIT_MS);

    function finish() {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("myterm:terminal-output", handleOutput);
      resolve();
    }

    function handleOutput(event: Event) {
      const detail = (event as CustomEvent<TerminalOutputEventDetail>).detail;
      if (!detail || detail.sessionId !== sessionId) return;
      transcript = `${transcript}${detail.dataUtf8}`.slice(-4096);
      if (hasTerminalPrompt(transcript)) finish();
    }

    window.addEventListener("myterm:terminal-output", handleOutput);
  });
}

async function dispatchCommand(sessionId: string, command: QuickCommand): Promise<void> {
  if (!command.send_newline) {
    await terminalWrite(sessionId, command.command.replace(/\r\n?/g, "\n"));
    return;
  }
  for (const line of commandLines(command.command)) {
    const prompt = waitForTerminalPrompt(sessionId);
    await terminalWrite(sessionId, `${line}\r`);
    await prompt;
  }
}

export function QuickBar() {
  const activePane = useLayoutStore(getActivePane);
  const notify = useUiStore((state) => state.notify);
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const [group, setGroup] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [editing, setEditing] = useState<QuickCommand | null | undefined>(undefined);
  const [importState, setImportState] = useState<QuickCommandImportState>();
  const [exportOpen, setExportOpen] = useState(false);
  const [sendingCommandId, setSendingCommandId] = useState<string | null>(null);
  const sendingCommandRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    void quickCommandList()
      .then((items) => {
        setCommands(items);
        const availableGroups = new Set(items.map((item) => item.group));
        setGroup((current) =>
          current && availableGroups.has(current) ? current : items[0]?.group || "常用",
        );
      })
      .catch((error) =>
        notify(error instanceof Error ? error.message : "快捷命令读取失败", "error"),
      );
  }, [notify]);

  useEffect(load, [load]);

  const groups = useMemo(() => [...new Set(commands.map((command) => command.group))], [commands]);
  const visibleCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return commands
      .filter(
        (command) =>
          command.group === group &&
          (!normalizedQuery ||
            command.label.toLocaleLowerCase().includes(normalizedQuery) ||
            command.command.toLocaleLowerCase().includes(normalizedQuery)),
      )
      .sort((a, b) => a.sort - b.sort);
  }, [commands, group, query]);
  const groupCommandCount = commands.filter((command) => command.group === group).length;

  const send = async (command: QuickCommand) => {
    if (!activePane?.sessionId || sendingCommandRef.current) return;
    sendingCommandRef.current = true;
    setSendingCommandId(command.id);
    try {
      await dispatchCommand(activePane.sessionId, command);
    } catch (error) {
      notify(error instanceof Error ? error.message : "命令发送失败", "error");
    } finally {
      sendingCommandRef.current = false;
      setSendingCommandId(null);
    }
  };

  const move = async (command: QuickCommand, direction: -1 | 1) => {
    const siblings = visibleCommands;
    const index = siblings.findIndex((candidate) => candidate.id === command.id);
    const target = siblings[index + direction];
    if (!target) return;
    await Promise.all([
      quickCommandSave({ ...command, sort: target.sort }),
      quickCommandSave({ ...target, sort: command.sort }),
    ]);
    load();
  };

  const clampHeight = (value: number) =>
    Math.min(
      Math.min(MAX_PANEL_HEIGHT, window.innerHeight * 0.55),
      Math.max(MIN_PANEL_HEIGHT, value),
    );

  const beginResize = (event: React.PointerEvent<HTMLHRElement>) => {
    const startY = event.clientY;
    const startHeight = height;
    const move = (moveEvent: PointerEvent) => {
      setHeight(clampHeight(startHeight + startY - moveEvent.clientY));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const selectImportFile = async (file: File) => {
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const preview = await quickCommandImportPreview(file.name, bytes);
      setImportState({ fileName: file.name, bytes, preview });
    } catch (error) {
      notify(error instanceof Error ? error.message : "快捷命令文件读取失败", "error");
    }
  };

  return (
    <>
      <section
        aria-label="快捷命令"
        className={`quick-command-panel${collapsed ? " is-collapsed" : ""}`}
        style={{ "--quick-panel-height": `${height}px` } as CSSProperties}
      >
        {!collapsed ? (
          <hr
            aria-label="调整快捷命令面板高度"
            aria-orientation="horizontal"
            aria-valuemax={MAX_PANEL_HEIGHT}
            aria-valuemin={MIN_PANEL_HEIGHT}
            aria-valuenow={Math.round(height)}
            className="quick-panel-resizer"
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setHeight((value) => clampHeight(value + 12));
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHeight((value) => clampHeight(value - 12));
              }
            }}
            onPointerDown={beginResize}
            tabIndex={0}
          />
        ) : null}
        <header className="quick-panel-header">
          <div className="quick-panel-identity">
            <span className="quick-panel-mark">
              <ListTree aria-hidden="true" size={15} strokeWidth={1.8} />
            </span>
            <span className="quick-panel-copy">
              <strong>快捷命令</strong>
              <small>
                {groups.length} 个命令集 · {commands.length} 条
              </small>
            </span>
          </div>
          {!collapsed ? (
            <div className="quick-panel-tools">
              <label className="quick-command-search">
                <Search aria-hidden="true" size={14} strokeWidth={1.8} />
                <input
                  aria-label="搜索当前命令集"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索命令"
                  type="search"
                  value={query}
                />
              </label>
              <input
                ref={importInputRef}
                accept=".qbl,.json,application/json"
                aria-hidden="true"
                className="visually-hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void selectImportFile(file);
                  event.target.value = "";
                }}
                tabIndex={-1}
                type="file"
              />
              <button
                aria-label="导入快捷命令"
                className="quick-panel-icon"
                onClick={() => importInputRef.current?.click()}
                title="导入快捷命令"
                type="button"
              >
                <Upload aria-hidden="true" size={15} strokeWidth={1.9} />
              </button>
              <button
                aria-label="导出快捷命令"
                className="quick-panel-icon"
                onClick={() => setExportOpen(true)}
                title="导出快捷命令"
                type="button"
              >
                <Download aria-hidden="true" size={15} strokeWidth={1.9} />
              </button>
              <button
                aria-label="新建快捷命令"
                className="quick-panel-create"
                onClick={() => setEditing(null)}
                title="新建快捷命令"
                type="button"
              >
                <Plus aria-hidden="true" size={15} strokeWidth={2} />
                <span>新建</span>
              </button>
            </div>
          ) : null}
          <button
            aria-expanded={!collapsed}
            className="quick-panel-toggle"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? "展开快捷命令" : "收起快捷命令"}
            type="button"
          >
            {collapsed ? (
              <ChevronUp aria-hidden="true" size={16} strokeWidth={2.2} />
            ) : (
              <ChevronDown aria-hidden="true" size={16} strokeWidth={2.2} />
            )}
            <span>{collapsed ? "展开" : "收起"}</span>
          </button>
        </header>
        {!collapsed ? (
          <div className="quick-panel-body">
            <nav aria-label="命令集" className="quick-command-groups">
              {groups.map((value) => (
                <button
                  aria-current={value === group ? "page" : undefined}
                  className={value === group ? "is-active" : ""}
                  key={value}
                  onClick={() => setGroup(value)}
                  type="button"
                >
                  <span>{value}</span>
                  <small>{commands.filter((command) => command.group === value).length}</small>
                </button>
              ))}
            </nav>
            <section aria-label={`${group}命令`} className="quick-command-library">
              <header className="quick-command-library-header">
                <strong>{group}</strong>
                <span>
                  {visibleCommands.length === groupCommandCount
                    ? `${groupCommandCount} 条`
                    : `${visibleCommands.length} / ${groupCommandCount} 条`}
                </span>
              </header>
              <ul className="quick-command-list">
                {visibleCommands.map((command) => (
                  <li
                    className="quick-command-row"
                    key={command.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setEditing(command);
                    }}
                  >
                    <button
                      className="quick-command-main"
                      disabled={
                        !activePane?.sessionId ||
                        activePane.state !== "connected" ||
                        sendingCommandId !== null
                      }
                      onClick={() => void send(command)}
                      title={`${command.send_newline ? "执行" : "回填"} ${command.label}`}
                      type="button"
                    >
                      <strong>{command.label}</strong>
                    </button>
                    <span
                      className={`quick-command-mode${command.send_newline ? "" : " is-fill"}`}
                      title={command.send_newline ? "发送后自动回车" : "仅填入终端，不自动回车"}
                    >
                      {command.send_newline ? (
                        <CornerDownLeft aria-hidden="true" size={13} strokeWidth={1.8} />
                      ) : (
                        <TextCursorInput aria-hidden="true" size={13} strokeWidth={1.8} />
                      )}
                    </span>
                    <button
                      aria-label={`编辑 ${command.label}`}
                      className="quick-command-edit"
                      onClick={() => setEditing(command)}
                      title="编辑命令"
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={13} strokeWidth={1.8} />
                    </button>
                  </li>
                ))}
                {visibleCommands.length === 0 ? (
                  <li className="quick-command-empty">
                    <Search aria-hidden="true" size={16} strokeWidth={1.6} />
                    <span>没有匹配的命令</span>
                  </li>
                ) : null}
              </ul>
            </section>
          </div>
        ) : null}
      </section>
      {editing !== undefined ? (
        <QuickCommandModal
          command={editing}
          onClose={() => setEditing(undefined)}
          onDelete={async (command) => {
            await quickCommandDelete(command.id);
            setEditing(undefined);
            load();
          }}
          onMove={move}
          onSaved={() => {
            setEditing(undefined);
            load();
          }}
        />
      ) : null}
      {importState ? (
        <QuickCommandImportModal
          state={importState}
          onClose={() => setImportState(undefined)}
          onImported={(message) => {
            setImportState(undefined);
            notify(message, "success");
            load();
          }}
        />
      ) : null}
      {exportOpen ? (
        <QuickCommandExportModal
          currentGroup={group}
          currentGroupCount={groupCommandCount}
          total={commands.length}
          onClose={() => setExportOpen(false)}
          onExported={(message) => {
            setExportOpen(false);
            notify(message, "success");
          }}
        />
      ) : null}
    </>
  );
}

function QuickCommandModal({
  command,
  onClose,
  onSaved,
  onDelete,
  onMove,
}: {
  command: QuickCommand | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (command: QuickCommand) => Promise<void>;
  onMove: (command: QuickCommand, direction: -1 | 1) => Promise<void>;
}) {
  const notify = useUiStore((state) => state.notify);
  const [label, setLabel] = useState(command?.label ?? "");
  const [group, setGroup] = useState(command?.group ?? "常用");
  const [value, setValue] = useState(command?.command ?? "");
  const [newline, setNewline] = useState(command?.send_newline ?? true);

  const save = async () => {
    if (!label.trim() || !value.trim()) {
      notify("显示名和命令不能为空", "error");
      return;
    }
    await quickCommandSave({
      id: command?.id ?? crypto.randomUUID(),
      label: label.trim(),
      group: group.trim() || "常用",
      command: value.replace(/\r\n?/g, "\n"),
      send_newline: newline,
      sort: command?.sort ?? Date.now(),
    });
    onSaved();
  };

  return (
    <Modal
      footer={
        <>
          {command ? (
            <button
              className="button button-danger button-left"
              onClick={() => void onDelete(command)}
              type="button"
            >
              删除
            </button>
          ) : null}
          <button className="button button-ghost" onClick={onClose} type="button">
            取消
          </button>
          <button className="button button-primary" onClick={() => void save()} type="button">
            保存
          </button>
        </>
      }
      onClose={onClose}
      size="small"
      title={command ? "编辑快捷命令" : "新增快捷命令"}
    >
      <div className="form-grid one-column">
        <label className="field">
          <span>显示名</span>
          <input onChange={(event) => setLabel(event.target.value)} value={label} />
        </label>
        <label className="field">
          <span>分组</span>
          <input onChange={(event) => setGroup(event.target.value)} value={group} />
        </label>
        <label className="field">
          <span>命令</span>
          <textarea
            onChange={(event) => setValue(event.target.value)}
            rows={6}
            spellCheck={false}
            value={value}
          />
        </label>
        <label className="toggle-field">
          <input
            checked={newline}
            onChange={(event) => setNewline(event.target.checked)}
            type="checkbox"
          />
          <span className="toggle-track">
            <span />
          </span>
          <span>
            <strong>自动回车</strong>
            <small>点击后立即执行命令</small>
          </span>
        </label>
        {command ? (
          <div className="command-order">
            <span>排序</span>
            <button
              className="button button-ghost"
              onClick={() => void onMove(command, -1)}
              type="button"
            >
              <ArrowUp aria-hidden="true" size={14} /> 上移
            </button>
            <button
              className="button button-ghost"
              onClick={() => void onMove(command, 1)}
              type="button"
            >
              <ArrowDown aria-hidden="true" size={14} /> 下移
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
