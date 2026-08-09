import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LocalEntry,
  localDefaultDirectory,
  localReadDir,
  onTransferProgress,
  type RemoteEntry,
  sftpDefaultDirectory,
  sftpDelete,
  sftpDownload,
  sftpMkdir,
  sftpReadDir,
  sftpRename,
  sftpUpload,
  type TransferProgress,
  transferCancel,
} from "../../ipc";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";
import { Modal } from "../shell/Modal";

interface SftpViewProps {
  sessionId: string;
}

interface TransferItem extends TransferProgress {
  name: string;
  direction: "upload" | "download";
}

type RemoteAction =
  | { kind: "mkdir"; value: string }
  | { kind: "rename"; entry: RemoteEntry; value: string }
  | { kind: "delete"; entries: RemoteEntry[] };

type FileEntry = LocalEntry | RemoteEntry;

interface SelectionModifiers {
  toggle: boolean;
  range: boolean;
}

function nextSelection<T extends FileEntry>(
  entries: T[],
  selected: T[],
  anchorPath: string | null,
  target: T,
  modifiers: SelectionModifiers,
) {
  if (modifiers.range && anchorPath) {
    const anchorIndex = entries.findIndex((entry) => entry.path === anchorPath);
    const targetIndex = entries.findIndex((entry) => entry.path === target.path);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const range = entries.slice(
        Math.min(anchorIndex, targetIndex),
        Math.max(anchorIndex, targetIndex) + 1,
      );
      if (!modifiers.toggle) return range;
      const selectedPaths = new Set(selected.map((entry) => entry.path));
      return [...selected, ...range.filter((entry) => !selectedPaths.has(entry.path))];
    }
  }
  if (modifiers.toggle) {
    return selected.some((entry) => entry.path === target.path)
      ? selected.filter((entry) => entry.path !== target.path)
      : [...selected, target];
  }
  return [target];
}

function joinRemotePath(parent: string, name: string) {
  return `${parent.replace(/\/$/u, "")}/${name}` || "/";
}

function joinLocalPath(parent: string, name: string) {
  return `${parent.replace(/[\\/]+$/u, "")}\\${name}`;
}

function formatBytes(value: number) {
  if (value === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

export function SftpView({ sessionId }: SftpViewProps) {
  const notify = useUiStore((state) => state.notify);
  const [localPath, setLocalPath] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntry[]>([]);
  const [selectedLocal, setSelectedLocal] = useState<LocalEntry[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<RemoteEntry[]>([]);
  const [transfers, setTransfers] = useState<Map<string, TransferItem>>(new Map());
  const [queueOpen, setQueueOpen] = useState(true);
  const [localLoading, setLocalLoading] = useState(true);
  const [remoteLoading, setRemoteLoading] = useState(true);
  const [remoteAction, setRemoteAction] = useState<RemoteAction | null>(null);
  const localRequestRef = useRef(0);
  const remoteRequestRef = useRef(0);
  const remotePathSessionRef = useRef<string | null>(null);
  const localSelectionAnchorRef = useRef<string | null>(null);
  const remoteSelectionAnchorRef = useRef<string | null>(null);

  const loadLocal = useCallback(async () => {
    if (!localPath) return;
    const request = ++localRequestRef.current;
    setSelectedLocal([]);
    localSelectionAnchorRef.current = null;
    setLocalLoading(true);
    try {
      const entries = await localReadDir(localPath);
      if (request === localRequestRef.current) setLocalEntries(entries);
    } catch (error) {
      if (request !== localRequestRef.current) return;
      setLocalEntries([]);
      notify(`本地目录读取失败：${errorMessage(error, "未知错误")}`, "error");
    } finally {
      if (request === localRequestRef.current) setLocalLoading(false);
    }
  }, [localPath, notify]);

  const loadRemote = useCallback(async () => {
    if (!remotePath || remotePathSessionRef.current !== sessionId) return;
    const request = ++remoteRequestRef.current;
    setSelectedRemote([]);
    remoteSelectionAnchorRef.current = null;
    setRemoteAction(null);
    setRemoteLoading(true);
    try {
      const entries = await sftpReadDir(sessionId, remotePath);
      if (request === remoteRequestRef.current) setRemoteEntries(entries);
    } catch (error) {
      if (request !== remoteRequestRef.current) return;
      setRemoteEntries([]);
      notify(`远程目录读取失败：${errorMessage(error, "未知错误")}`, "error");
    } finally {
      if (request === remoteRequestRef.current) setRemoteLoading(false);
    }
  }, [notify, remotePath, sessionId]);

  useEffect(() => {
    let active = true;
    localRequestRef.current += 1;
    remoteRequestRef.current += 1;
    remotePathSessionRef.current = null;
    setLocalPath("");
    setRemotePath("");
    setLocalEntries([]);
    setRemoteEntries([]);
    setSelectedLocal([]);
    setSelectedRemote([]);
    localSelectionAnchorRef.current = null;
    remoteSelectionAnchorRef.current = null;
    setRemoteAction(null);
    setLocalLoading(true);
    setRemoteLoading(true);
    void localDefaultDirectory()
      .then((path) => {
        if (active) setLocalPath(path);
      })
      .catch((error) => {
        if (!active) return;
        setLocalLoading(false);
        notify(`本地初始目录读取失败：${errorMessage(error, "未知错误")}`, "error");
      });
    void sftpDefaultDirectory(sessionId)
      .then((path) => {
        if (!active) return;
        remotePathSessionRef.current = sessionId;
        setRemotePath(path);
      })
      .catch((error) => {
        if (!active) return;
        setRemoteLoading(false);
        notify(`SFTP 初始目录读取失败：${errorMessage(error, "未知错误")}`, "error");
      });
    return () => {
      active = false;
    };
  }, [notify, sessionId]);

  useEffect(() => {
    void loadLocal();
  }, [loadLocal]);

  useEffect(() => {
    void loadRemote();
  }, [loadRemote]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void onTransferProgress((progress) => {
      setTransfers((current) => {
        const existing = current.get(progress.transfer_id);
        const next = new Map(current);
        next.set(progress.transfer_id, {
          ...progress,
          name: existing?.name ?? "传输任务",
          direction: existing?.direction ?? "upload",
        });
        return next;
      });
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, []);

  const registerTransfer = (
    transferId: string,
    name: string,
    direction: TransferItem["direction"],
    total: number,
  ) => {
    setTransfers((current) => {
      const next = new Map(current);
      const progress = next.get(transferId);
      next.set(transferId, {
        transfer_id: transferId,
        state: progress?.state ?? "queued",
        transferred: progress?.transferred ?? 0,
        total: progress?.total || total,
        bytes_per_sec: progress?.bytes_per_sec ?? 0,
        error: progress?.error ?? null,
        name,
        direction,
      });
      return next;
    });
    setQueueOpen(true);
  };

  const upload = async (entries: LocalEntry[] = selectedLocal) => {
    if (!entries.length) return;
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        const transferId = await sftpUpload(
          sessionId,
          entry.path,
          joinRemotePath(remotePath, entry.name),
        );
        registerTransfer(transferId, entry.name, "upload", entry.size);
      }),
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      const first = failures[0] as PromiseRejectedResult;
      notify(
        `${entries.length - failures.length} 项已加入上传队列，${failures.length} 项启动失败：${errorMessage(first.reason, "未知错误")}`,
        "error",
      );
    } else if (entries.length > 1) {
      notify(`已加入 ${entries.length} 个上传任务`, "success");
    }
  };

  const download = async (entries: RemoteEntry[] = selectedRemote) => {
    if (!entries.length) return;
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        const transferId = await sftpDownload(
          sessionId,
          entry.path,
          joinLocalPath(localPath, entry.name),
        );
        registerTransfer(transferId, entry.name, "download", entry.size);
      }),
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      const first = failures[0] as PromiseRejectedResult;
      notify(
        `${entries.length - failures.length} 项已加入下载队列，${failures.length} 项启动失败：${errorMessage(first.reason, "未知错误")}`,
        "error",
      );
    } else if (entries.length > 1) {
      notify(`已加入 ${entries.length} 个下载任务`, "success");
    }
  };

  const transferItems = useMemo(() => [...transfers.values()].reverse(), [transfers]);
  const localSelectedPaths = useMemo(
    () => new Set(selectedLocal.map((entry) => entry.path)),
    [selectedLocal],
  );
  const remoteSelectedPaths = useMemo(
    () => new Set(selectedRemote.map((entry) => entry.path)),
    [selectedRemote],
  );

  const selectLocal = (entry: FileEntry, modifiers: SelectionModifiers) => {
    const localEntry = entry as LocalEntry;
    setSelectedLocal((current) =>
      nextSelection(localEntries, current, localSelectionAnchorRef.current, localEntry, modifiers),
    );
    if (!modifiers.range || !localSelectionAnchorRef.current) {
      localSelectionAnchorRef.current = localEntry.path;
    }
  };

  const selectRemote = (entry: FileEntry, modifiers: SelectionModifiers) => {
    const remoteEntry = entry as RemoteEntry;
    setSelectedRemote((current) =>
      nextSelection(
        remoteEntries,
        current,
        remoteSelectionAnchorRef.current,
        remoteEntry,
        modifiers,
      ),
    );
    if (!modifiers.range || !remoteSelectionAnchorRef.current) {
      remoteSelectionAnchorRef.current = remoteEntry.path;
    }
  };

  const applyRemoteAction = async () => {
    if (!remoteAction) return;
    if (remoteAction.kind === "delete") {
      const failures: string[] = [];
      for (const entry of remoteAction.entries) {
        try {
          await sftpDelete(sessionId, entry.path, entry.is_dir);
        } catch (error) {
          failures.push(`${entry.name}：${errorMessage(error, "未知错误")}`);
        }
      }
      const successCount = remoteAction.entries.length - failures.length;
      setRemoteAction(null);
      setSelectedRemote([]);
      remoteSelectionAnchorRef.current = null;
      await loadRemote();
      if (failures.length) {
        notify(`${successCount} 项已删除，${failures.length} 项失败：${failures[0]}`, "error");
      } else if (successCount > 1) {
        notify(`已删除 ${successCount} 个远程项目`, "success");
      }
      return;
    }
    try {
      if (remoteAction.kind === "mkdir") {
        const name = remoteAction.value.trim();
        if (!name || name.includes("/") || name.includes("\\")) {
          notify("目录名不能包含路径分隔符", "error");
          return;
        }
        await sftpMkdir(sessionId, joinRemotePath(remotePath, name));
      } else if (remoteAction.kind === "rename") {
        const name = remoteAction.value.trim();
        if (!name || name.includes("/") || name.includes("\\")) {
          notify("名称不能包含路径分隔符", "error");
          return;
        }
        await sftpRename(sessionId, remoteAction.entry.path, joinRemotePath(remotePath, name));
      }
      setRemoteAction(null);
      setSelectedRemote([]);
      remoteSelectionAnchorRef.current = null;
      await loadRemote();
    } catch (error) {
      notify(errorMessage(error, "远程文件操作失败"), "error");
    }
  };

  return (
    <div className="sftp-view">
      <div className="file-panes">
        <FilePane
          entries={localEntries}
          kind="local"
          loading={localLoading}
          onActivate={(entry) => {
            const localEntry = entry as LocalEntry;
            if (localEntry.is_dir) setLocalPath(localEntry.path);
          }}
          onDropRemote={(entry) => void download([entry])}
          onPathChange={setLocalPath}
          onRefresh={() => void loadLocal()}
          onSelect={selectLocal}
          path={localPath}
          selectedPaths={localSelectedPaths}
        />
        <div className="transfer-controls">
          <span className="connection-reuse">SFTP</span>
          <button
            aria-label="上传"
            disabled={!selectedLocal.length}
            onClick={() => void upload()}
            title={selectedLocal.length > 1 ? `上传 ${selectedLocal.length} 个项目` : "上传"}
            type="button"
          >
            <Icon name="upload" />
          </button>
          <button
            aria-label="下载"
            disabled={!selectedRemote.length}
            onClick={() => void download()}
            title={selectedRemote.length > 1 ? `下载 ${selectedRemote.length} 个项目` : "下载"}
            type="button"
          >
            <Icon name="download" />
          </button>
          <button
            aria-label="新建远程目录"
            onClick={() => setRemoteAction({ kind: "mkdir", value: "" })}
            title="新建远程目录"
            type="button"
          >
            <Icon name="plus" />
          </button>
          <button
            aria-label="重命名远程项目"
            disabled={selectedRemote.length !== 1}
            onClick={() =>
              selectedRemote.length === 1 &&
              setRemoteAction({
                kind: "rename",
                entry: selectedRemote[0],
                value: selectedRemote[0].name,
              })
            }
            title={selectedRemote.length > 1 ? "重命名仅支持单个项目" : "重命名"}
            type="button"
          >
            <Icon name="edit" />
          </button>
          <button
            aria-label="删除远程项目"
            disabled={!selectedRemote.length}
            onClick={() =>
              selectedRemote.length &&
              setRemoteAction({ kind: "delete", entries: [...selectedRemote] })
            }
            title={selectedRemote.length > 1 ? `删除 ${selectedRemote.length} 个项目` : "删除"}
            type="button"
          >
            <Icon name="trash" />
          </button>
        </div>
        <FilePane
          entries={remoteEntries}
          kind="remote"
          loading={remoteLoading}
          onActivate={(entry) => {
            const remoteEntry = entry as RemoteEntry;
            if (remoteEntry.is_dir) setRemotePath(remoteEntry.path);
          }}
          onDropLocal={(entry) => void upload([entry])}
          onPathChange={setRemotePath}
          onRefresh={() => void loadRemote()}
          onSelect={selectRemote}
          path={remotePath}
          selectedPaths={remoteSelectedPaths}
        />
      </div>
      <section className={`transfer-queue ${queueOpen ? "is-open" : ""}`}>
        <button
          className="queue-heading"
          onClick={() => setQueueOpen((value) => !value)}
          type="button"
        >
          <span>传输队列</span>
          <span className="queue-summary">
            {transferItems.filter((item) => item.state === "running").length} 进行中
            <Icon name="chevron" />
          </span>
        </button>
        {queueOpen ? (
          <div className="queue-list">
            {transferItems.length ? (
              transferItems.map((item) => {
                const percent = item.total ? Math.round((item.transferred / item.total) * 100) : 0;
                return (
                  <div className={`transfer-row transfer-${item.state}`} key={item.transfer_id}>
                    <span className="transfer-direction">
                      {item.direction === "upload" ? "↑" : "↓"}
                    </span>
                    <span className="transfer-name">{item.name}</span>
                    <div className="transfer-progress">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <span className="transfer-status">
                      {item.state === "done"
                        ? "完成"
                        : item.state === "cancelled"
                          ? "已取消"
                          : item.state === "failed"
                            ? `失败${item.error ? ` · ${item.error}` : ""}`
                            : `${percent}% · ${formatBytes(item.bytes_per_sec)}/s`}
                    </span>
                    <button
                      aria-label={`取消 ${item.name}`}
                      className="icon-button"
                      disabled={
                        item.state === "done" ||
                        item.state === "cancelled" ||
                        item.state === "failed"
                      }
                      onClick={() => void transferCancel(item.transfer_id)}
                      type="button"
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="queue-empty">暂无传输任务</div>
            )}
          </div>
        ) : null}
      </section>
      {remoteAction ? (
        <Modal
          footer={
            <>
              <button
                className="button-secondary"
                onClick={() => setRemoteAction(null)}
                type="button"
              >
                取消
              </button>
              <button
                className={remoteAction.kind === "delete" ? "button-danger" : "button-primary"}
                onClick={() => void applyRemoteAction()}
                type="button"
              >
                {remoteAction.kind === "delete" ? "删除" : "确认"}
              </button>
            </>
          }
          onClose={() => setRemoteAction(null)}
          size="small"
          title={
            remoteAction.kind === "mkdir"
              ? "新建远程目录"
              : remoteAction.kind === "rename"
                ? "重命名远程项目"
                : remoteAction.entries.length > 1
                  ? `删除 ${remoteAction.entries.length} 个远程项目`
                  : "删除远程项目"
          }
        >
          {remoteAction.kind === "delete" ? (
            <p className="confirm-copy">
              {remoteAction.entries.length === 1
                ? `确认删除“${remoteAction.entries[0].name}”吗？`
                : `确认删除所选的 ${remoteAction.entries.length} 个远程项目吗？`}
              {remoteAction.entries.some((entry) => entry.is_dir)
                ? "目录中的内容也会一并删除。"
                : ""}
            </p>
          ) : (
            <label className="field">
              <span>{remoteAction.kind === "mkdir" ? "目录名" : "新名称"}</span>
              <input
                onChange={(event) =>
                  setRemoteAction({ ...remoteAction, value: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") void applyRemoteAction();
                }}
                value={remoteAction.value}
              />
            </label>
          )}
        </Modal>
      ) : null}
    </div>
  );
}

interface FilePaneProps {
  kind: "local" | "remote";
  path: string;
  entries: FileEntry[];
  selectedPaths: Set<string>;
  loading: boolean;
  onPathChange: (path: string) => void;
  onRefresh: () => void;
  onSelect: (entry: FileEntry, modifiers: SelectionModifiers) => void;
  onActivate: (entry: FileEntry) => void;
  onDropLocal?: (entry: LocalEntry) => void;
  onDropRemote?: (entry: RemoteEntry) => void;
}

function FilePane({
  kind,
  path,
  entries,
  selectedPaths,
  loading,
  onPathChange,
  onRefresh,
  onSelect,
  onActivate,
  onDropLocal,
  onDropRemote,
}: FilePaneProps) {
  const parent =
    kind === "remote"
      ? path.split("/").slice(0, -1).join("/") || "/"
      : path.split("\\").slice(0, -1).join("\\") || path;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Keyboard users have equivalent upload and download buttons; this surface is the native drag target.
    <section
      className="file-pane"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const payload = event.dataTransfer.getData("application/myterm-file");
        if (!payload) return;
        try {
          const data = JSON.parse(payload) as { kind: "local" | "remote"; entry: FileEntry };
          if (kind === "remote" && data.kind === "local") onDropLocal?.(data.entry as LocalEntry);
          if (kind === "local" && data.kind === "remote") onDropRemote?.(data.entry as RemoteEntry);
        } catch {
          return;
        }
      }}
    >
      <header className="file-pane-header">
        <span className="pane-label">{kind === "local" ? "本地" : "远程"}</span>
        <button
          aria-label="上一级"
          className="path-up"
          onClick={() => onPathChange(parent)}
          type="button"
        >
          ↑
        </button>
        <input
          aria-label={`${kind === "local" ? "本地" : "远程"}路径`}
          onChange={(event) => onPathChange(event.target.value)}
          value={path}
        />
        <button
          aria-label={`刷新${kind === "local" ? "本地" : "远程"}目录`}
          className="icon-button"
          onClick={onRefresh}
          type="button"
        >
          <Icon name="refresh" />
        </button>
      </header>
      <div className="file-table-wrap">
        <table className="file-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>大小</th>
              <th>修改时间</th>
              {kind === "remote" ? <th>权限</th> : null}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                aria-selected={selectedPaths.has(entry.path)}
                className={selectedPaths.has(entry.path) ? "is-selected" : ""}
                draggable
                key={entry.path}
                onClick={(event) =>
                  onSelect(entry, {
                    toggle: event.ctrlKey || event.metaKey,
                    range: event.shiftKey,
                  })
                }
                onDoubleClick={() => onActivate(entry)}
                onDragStart={(event) =>
                  event.dataTransfer.setData(
                    "application/myterm-file",
                    JSON.stringify({ kind, entry }),
                  )
                }
              >
                <td>
                  <Icon name={entry.is_dir ? "folder" : "file"} />
                  <span>{entry.name}</span>
                </td>
                <td>{formatBytes(entry.size)}</td>
                <td>{formatTime(entry.modified)}</td>
                {kind === "remote" ? (
                  <td className="permissions">{"permissions" in entry ? entry.permissions : ""}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? (
          <div className="file-loading">
            <span className="spinner" /> 正在读取
          </div>
        ) : null}
      </div>
      <footer className="file-pane-footer">
        <span>{entries.length} 个项目</span>
        {selectedPaths.size ? <span>已选 {selectedPaths.size} 项</span> : null}
      </footer>
    </section>
  );
}
