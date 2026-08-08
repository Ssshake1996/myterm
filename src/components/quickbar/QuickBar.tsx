import { useEffect, useMemo, useState } from "react";
import {
  type QuickCommand,
  quickCommandDelete,
  quickCommandList,
  quickCommandSave,
  terminalWrite,
} from "../../ipc";
import { getActivePane, useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";
import { Modal } from "../shell/Modal";

export function QuickBar() {
  const activePane = useLayoutStore(getActivePane);
  const notify = useUiStore((state) => state.notify);
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const [group, setGroup] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<QuickCommand | null | undefined>(undefined);

  const load = () => {
    void quickCommandList()
      .then((items) => {
        setCommands(items);
        setGroup((current) => current || items[0]?.group || "常用");
      })
      .catch((error) =>
        notify(error instanceof Error ? error.message : "快捷命令读取失败", "error"),
      );
  };

  useEffect(load, [notify]);

  const groups = useMemo(() => [...new Set(commands.map((command) => command.group))], [commands]);
  const visibleCommands = useMemo(
    () => commands.filter((command) => command.group === group).sort((a, b) => a.sort - b.sort),
    [commands, group],
  );

  const send = async (command: QuickCommand) => {
    if (!activePane?.sessionId) return;
    try {
      await terminalWrite(
        activePane.sessionId,
        command.command + (command.send_newline ? "\r" : ""),
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "命令发送失败", "error");
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

  if (collapsed) {
    return (
      <div className="quickbar-collapsed">
        <button
          aria-label="展开快捷命令"
          onClick={() => setCollapsed(false)}
          title="展开快捷命令"
          type="button"
        >
          <span>COMMANDS</span>
          <Icon name="chevron" />
        </button>
      </div>
    );
  }

  return (
    <>
      <section className="quickbar">
        <div className="quick-groups" role="tablist">
          {groups.map((value) => (
            <button
              aria-selected={value === group}
              className={value === group ? "is-active" : ""}
              key={value}
              onClick={() => setGroup(value)}
              role="tab"
              type="button"
            >
              {value}
            </button>
          ))}
        </div>
        <div className="quick-commands">
          {visibleCommands.map((command) => (
            <button
              className="quick-command"
              disabled={!activePane?.sessionId || activePane.state !== "connected"}
              key={command.id}
              onClick={() => void send(command)}
              onContextMenu={(event) => {
                event.preventDefault();
                setEditing(command);
              }}
              title={`${command.command}${command.send_newline ? " · 自动执行" : " · 仅回填"}`}
              type="button"
            >
              <span>{command.label}</span>
              {!command.send_newline ? <small>↵</small> : null}
            </button>
          ))}
        </div>
        <button
          aria-label="新增快捷命令"
          className="icon-button bordered"
          onClick={() => setEditing(null)}
          type="button"
        >
          <Icon name="plus" />
        </button>
        <button
          aria-label="折叠快捷命令"
          className="icon-button"
          onClick={() => setCollapsed(true)}
          type="button"
        >
          <Icon name="chevron" />
        </button>
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
      command: value.trim(),
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
          <textarea onChange={(event) => setValue(event.target.value)} rows={3} value={value} />
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
              ← 左移
            </button>
            <button
              className="button button-ghost"
              onClick={() => void onMove(command, 1)}
              type="button"
            >
              右移 →
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
