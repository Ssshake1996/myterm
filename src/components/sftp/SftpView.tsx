import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type LocalEntry,
  localReadDir,
  onTransferProgress,
  type RemoteEntry,
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
  | { kind: "delete"; entry: RemoteEntry };

function joinRemotePath(parent: string, name: string) {
  return `${parent.replace(/\/$/u, "")}/${name}` || "/";
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

export function SftpView({ sessionId }: SftpViewProps) {
  const notify = useUiStore((state) => state.notify);
  const [localPath, setLocalPath] = useState("C:\\deploy");
  const [remotePath, setRemotePath] = useState("/opt/app");
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntry[]>([]);
  const [selectedLocal, setSelectedLocal] = useState<LocalEntry | null>(null);
  const [selectedRemote, setSelectedRemote] = useState<RemoteEntry | null>(null);
  const [transfers, setTransfers] = useState<Map<string, TransferItem>>(new Map());
  const [queueOpen, setQueueOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [remoteAction, setRemoteAction] = useState<RemoteAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [local, remote] = await Promise.all([
        localReadDir(localPath),
        sftpReadDir(sessionId, remotePath),
      ]);
      setLocalEntries(local);
      setRemoteEntries(remote);
    } catch (error) {
      notify(error instanceof Error ? error.message : "目录读取失败", "error");
    } finally {
      setLoading(false);
    }
  }, [localPath, notify, remotePath, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const upload = async (entry = selectedLocal) => {
    if (!entry) return;
    try {
      const transferId = await sftpUpload(sessionId, entry.path, `${remotePath}/${entry.name}`);
      registerTransfer(transferId, entry.name, "upload", entry.size);
    } catch (error) {
      notify(error instanceof Error ? error.message : "上传失败", "error");
    }
  };

  const download = async (entry = selectedRemote) => {
    if (!entry) return;
    try {
      const transferId = await sftpDownload(sessionId, entry.path, `${localPath}\\${entry.name}`);
      registerTransfer(transferId, entry.name, "download", entry.size);
    } catch (error) {
      notify(error instanceof Error ? error.message : "下载失败", "error");
    }
  };

  const transferItems = useMemo(() => [...transfers.values()].reverse(), [transfers]);

  const applyRemoteAction = async () => {
    if (!remoteAction) return;
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
      } else {
        await sftpDelete(sessionId, remoteAction.entry.path, remoteAction.entry.is_dir);
      }
      setRemoteAction(null);
      setSelectedRemote(null);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "远程文件操作失败", "error");
    }
  };

  return (
    <div className="sftp-view">
      <div className="file-panes">
        <FilePane
          entries={localEntries}
          kind="local"
          loading={loading}
          onActivate={(entry) => {
            const localEntry = entry as LocalEntry;
            if (localEntry.is_dir) setLocalPath(localEntry.path);
            else setSelectedLocal(localEntry);
          }}
          onDropRemote={(entry) => void download(entry)}
          onPathChange={setLocalPath}
          onSelect={(entry) => setSelectedLocal(entry as LocalEntry)}
          path={localPath}
          selectedPath={selectedLocal?.path ?? null}
        />
        <div className="transfer-controls">
          <span className="connection-reuse">SFTP</span>
          <button
            aria-label="上传"
            disabled={!selectedLocal}
            onClick={() => void upload()}
            title="上传"
            type="button"
          >
            <Icon name="upload" />
          </button>
          <button
            aria-label="下载"
            disabled={!selectedRemote}
            onClick={() => void download()}
            title="下载"
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
            disabled={!selectedRemote}
            onClick={() =>
              selectedRemote &&
              setRemoteAction({ kind: "rename", entry: selectedRemote, value: selectedRemote.name })
            }
            title="重命名"
            type="button"
          >
            <Icon name="edit" />
          </button>
          <button
            aria-label="删除远程项目"
            disabled={!selectedRemote}
            onClick={() =>
              selectedRemote && setRemoteAction({ kind: "delete", entry: selectedRemote })
            }
            title="删除"
            type="button"
          >
            <Icon name="trash" />
          </button>
        </div>
        <FilePane
          entries={remoteEntries}
          kind="remote"
          loading={loading}
          onActivate={(entry) => {
            const remoteEntry = entry as RemoteEntry;
            if (remoteEntry.is_dir) setRemotePath(remoteEntry.path);
            else setSelectedRemote(remoteEntry);
          }}
          onDropLocal={(entry) => void upload(entry)}
          onPathChange={setRemotePath}
          onSelect={(entry) => setSelectedRemote(entry as RemoteEntry)}
          path={remotePath}
          selectedPath={selectedRemote?.path ?? null}
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
                          : `${percent}% · ${formatBytes(item.bytes_per_sec)}/s`}
                    </span>
                    <button
                      aria-label={`取消 ${item.name}`}
                      className="icon-button"
                      disabled={item.state === "done" || item.state === "cancelled"}
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
                : "删除远程项目"
          }
        >
          {remoteAction.kind === "delete" ? (
            <p className="confirm-copy">
              确认删除“{remoteAction.entry.name}”吗？
              {remoteAction.entry.is_dir ? "目录中的内容也会一并删除。" : ""}
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

type FileEntry = LocalEntry | RemoteEntry;

interface FilePaneProps {
  kind: "local" | "remote";
  path: string;
  entries: FileEntry[];
  selectedPath: string | null;
  loading: boolean;
  onPathChange: (path: string) => void;
  onSelect: (entry: FileEntry) => void;
  onActivate: (entry: FileEntry) => void;
  onDropLocal?: (entry: LocalEntry) => void;
  onDropRemote?: (entry: RemoteEntry) => void;
}

function FilePane({
  kind,
  path,
  entries,
  selectedPath,
  loading,
  onPathChange,
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
          aria-label="刷新目录"
          className="icon-button"
          onClick={() => onPathChange(`${path}`)}
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
                className={entry.path === selectedPath ? "is-selected" : ""}
                draggable
                key={entry.path}
                onClick={() => onSelect(entry)}
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
      <footer className="file-pane-footer">{entries.length} 个项目</footer>
    </section>
  );
}
