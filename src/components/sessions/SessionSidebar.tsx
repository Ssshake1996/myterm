import { useMemo, useState } from "react";
import { profileDelete, type SessionProfile } from "../../ipc";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";
import { Modal } from "../shell/Modal";
import { ProfileModal } from "./ProfileModal";

interface SessionSidebarProps {
  profiles: SessionProfile[];
  onProfilesChange: (profiles: SessionProfile[]) => void;
  onConnect: (profile: SessionProfile) => void;
  editorOpen: boolean;
  onEditorOpenChange: (open: boolean) => void;
}

interface GroupNode {
  name: string;
  path: string;
  groups: GroupNode[];
  profiles: SessionProfile[];
}

function buildTree(profiles: SessionProfile[]): GroupNode[] {
  const roots: GroupNode[] = [];
  for (const profile of profiles) {
    const segments = (profile.group || "默认").split("/").filter(Boolean);
    let level = roots;
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let node = level.find((candidate) => candidate.name === segment);
      if (!node) {
        node = { name: segment, path, groups: [], profiles: [] };
        level.push(node);
      }
      level = node.groups;
      if (segment === segments.at(-1)) node.profiles.push(profile);
    }
  }
  return roots;
}

function ProfileRow({
  profile,
  onConnect,
  onEdit,
  onDelete,
}: {
  profile: SessionProfile;
  onConnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const detail =
    profile.target.kind === "ssh"
      ? `${profile.target.username}@${profile.target.host}:${profile.target.port}`
      : profile.target.shell.replace(".exe", "");
  return (
    <div className="profile-row">
      <button
        className="profile-main"
        aria-label={`连接 ${profile.name}`}
        onClick={onConnect}
        onContextMenu={(event) => {
          event.preventDefault();
          onEdit();
        }}
        title={`连接 ${profile.name}`}
        type="button"
      >
        <span className={`profile-glyph ${profile.target.kind}`}>
          {profile.target.kind === "ssh" ? "S" : ">"}
        </span>
        <span className="profile-copy">
          <strong>{profile.name}</strong>
          <small>{detail}</small>
        </span>
      </button>
      <div className="profile-actions">
        <button
          aria-label={`编辑 ${profile.name}`}
          className="icon-button"
          onClick={onEdit}
          title="编辑会话"
          type="button"
        >
          <Icon name="edit" />
        </button>
        <button
          aria-label={`删除 ${profile.name}`}
          className="icon-button danger"
          onClick={onDelete}
          title="删除会话"
          type="button"
        >
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}

function Group({
  node,
  depth,
  onConnect,
  onEdit,
  onDelete,
}: {
  node: GroupNode;
  depth: number;
  onConnect: (profile: SessionProfile) => void;
  onEdit: (profile: SessionProfile) => void;
  onDelete: (profile: SessionProfile) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="profile-group">
      <button
        className="group-label"
        onClick={() => setOpen((value) => !value)}
        style={{ paddingLeft: 10 + depth * 12 }}
        type="button"
      >
        <span className={open ? "group-chevron is-open" : "group-chevron"}>›</span>
        <span>{node.name}</span>
        <span className="group-count">{node.profiles.length + node.groups.length}</span>
      </button>
      {open ? (
        <div className="group-content" style={{ paddingLeft: depth * 8 }}>
          {node.groups.map((child) => (
            <Group
              depth={depth + 1}
              key={child.path}
              node={child}
              onConnect={onConnect}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
          {node.profiles.map((profile) => (
            <ProfileRow
              key={profile.id}
              onConnect={() => onConnect(profile)}
              onDelete={() => onDelete(profile)}
              onEdit={() => onEdit(profile)}
              profile={profile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SessionSidebar({
  profiles,
  onProfilesChange,
  onConnect,
  editorOpen,
  onEditorOpenChange,
}: SessionSidebarProps) {
  const notify = useUiStore((state) => state.notify);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<SessionProfile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SessionProfile | null>(null);
  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    if (!value) return profiles;
    return profiles.filter((profile) => {
      const host = profile.target.kind === "ssh" ? profile.target.host : profile.target.shell;
      const username = profile.target.kind === "ssh" ? profile.target.username : "";
      return `${profile.name} ${profile.group} ${username} ${host}`
        .toLocaleLowerCase()
        .includes(value);
    });
  }, [profiles, query]);
  const groups = useMemo(() => buildTree(filtered), [filtered]);

  const remove = async (profile: SessionProfile) => {
    try {
      await profileDelete(profile.id);
      onProfilesChange(profiles.filter((candidate) => candidate.id !== profile.id));
      notify("会话已删除", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败", "error");
    }
  };

  const localProfile = profiles.find((profile) => profile.target.kind === "local");
  const modalOpen = editorOpen || editing !== null;

  return (
    <aside className="session-sidebar">
      <div className="sidebar-heading">
        <div>
          <span className="eyebrow">WORKSPACES</span>
          <h2>
            会话 <small>{profiles.length}</small>
          </h2>
        </div>
        <button
          aria-label="新建会话配置"
          className="button sidebar-new-button"
          onClick={() => onEditorOpenChange(true)}
          type="button"
        >
          <Icon name="plus" />
          新建
        </button>
      </div>
      <label className="searchbox">
        <Icon name="search" />
        <input
          aria-label="搜索会话"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名称或主机"
          value={query}
        />
        {query ? (
          <button aria-label="清除搜索" onClick={() => setQuery("")} type="button">
            <Icon name="close" />
          </button>
        ) : null}
      </label>
      <div className="profile-tree">
        {groups.length ? (
          groups.map((node) => (
            <Group
              depth={0}
              key={node.path}
              node={node}
              onConnect={onConnect}
              onDelete={setPendingDelete}
              onEdit={setEditing}
            />
          ))
        ) : (
          <div className="sidebar-empty">未找到会话</div>
        )}
      </div>
      <div className="sidebar-footer">
        <button
          className="local-launch"
          disabled={!localProfile}
          onClick={() => localProfile && onConnect(localProfile)}
          type="button"
        >
          <span className="local-launch-icon">›_</span>
          <span>
            <strong>本地终端</strong>
            <small>
              {localProfile?.target.kind === "local" ? localProfile.target.shell : "不可用"}
            </small>
          </span>
          <span className="local-launch-arrow">↗</span>
        </button>
      </div>
      {modalOpen ? (
        <ProfileModal
          onClose={() => {
            setEditing(null);
            onEditorOpenChange(false);
          }}
          onSaved={(profile, connect) => {
            const index = profiles.findIndex((candidate) => candidate.id === profile.id);
            const next = [...profiles];
            if (index >= 0) next[index] = profile;
            else next.push(profile);
            onProfilesChange(next);
            if (connect) onConnect(profile);
          }}
          profile={editing}
        />
      ) : null}
      {pendingDelete ? (
        <Modal
          footer={
            <>
              <button className="button" onClick={() => setPendingDelete(null)} type="button">
                取消
              </button>
              <button
                className="button button-danger"
                onClick={() => {
                  const profile = pendingDelete;
                  setPendingDelete(null);
                  void remove(profile);
                }}
                type="button"
              >
                删除会话
              </button>
            </>
          }
          onClose={() => setPendingDelete(null)}
          size="small"
          title="删除会话"
        >
          <p className="confirm-copy">
            确认删除“{pendingDelete.name}”？对应的系统凭据也会一并清除。
          </p>
        </Modal>
      ) : null}
    </aside>
  );
}
