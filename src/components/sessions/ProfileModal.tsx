import { useEffect, useState } from "react";
import { localShellList, profileSave, type SessionProfile, vaultSet } from "../../ipc";
import { useUiStore } from "../../store/ui";
import { Modal } from "../shell/Modal";

interface ProfileModalProps {
  profile: SessionProfile | null;
  onClose: () => void;
  onSaved: (profile: SessionProfile) => void;
}

export function ProfileModal({ profile, onClose, onSaved }: ProfileModalProps) {
  const notify = useUiStore((state) => state.notify);
  const [targetKind, setTargetKind] = useState<"ssh" | "local">(profile?.target.kind ?? "ssh");
  const [name, setName] = useState(profile?.name ?? "");
  const [group, setGroup] = useState(profile?.group ?? "默认");
  const [host, setHost] = useState(profile?.target.kind === "ssh" ? profile.target.host : "");
  const [port, setPort] = useState(profile?.target.kind === "ssh" ? profile.target.port : 22);
  const [username, setUsername] = useState(
    profile?.target.kind === "ssh" ? profile.target.username : "root",
  );
  const [authKind, setAuthKind] = useState<"password" | "private_key">(
    profile?.target.kind === "ssh" ? profile.target.auth.kind : "password",
  );
  const [secret, setSecret] = useState("");
  const [keyPath, setKeyPath] = useState(
    profile?.target.kind === "ssh" && profile.target.auth.kind === "private_key"
      ? profile.target.auth.key_path
      : "",
  );
  const [shell, setShell] = useState(
    profile?.target.kind === "local" ? profile.target.shell : "powershell.exe",
  );
  const [shells, setShells] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void localShellList()
      .then((values) => {
        setShells(values);
        if (!shell && values[0]) setShell(values[0]);
      })
      .catch(() => setShells([]));
  }, [shell]);

  const save = async () => {
    if (!name.trim()) {
      notify("请输入会话名称", "error");
      return;
    }
    if (targetKind === "ssh" && (!host.trim() || !username.trim())) {
      notify("请填写主机和用户名", "error");
      return;
    }
    const id = profile?.id ?? crypto.randomUUID();
    const passwordRef = `profile.${id}.password`;
    const passphraseRef = `profile.${id}.passphrase`;
    const next: SessionProfile = {
      id,
      name: name.trim(),
      group: group.trim() || "默认",
      target:
        targetKind === "local"
          ? { kind: "local", shell }
          : {
              kind: "ssh",
              host: host.trim(),
              port,
              username: username.trim(),
              auth:
                authKind === "password"
                  ? { kind: "password", vault_ref: passwordRef }
                  : {
                      kind: "private_key",
                      key_path: keyPath.trim(),
                      passphrase_ref: secret ? passphraseRef : null,
                    },
            },
    };
    setSaving(true);
    try {
      if (secret) await vaultSet(authKind === "password" ? passwordRef : passphraseRef, secret);
      await profileSave(next);
      onSaved(next);
      notify("会话配置已保存", "success");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败", "error");
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
            {saving ? "保存中" : "保存"}
          </button>
        </>
      }
      onClose={onClose}
      title={profile ? "编辑会话" : "新建会话"}
    >
      <div className="form-grid">
        <label className="field">
          <span>名称</span>
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="field">
          <span>分组</span>
          <input onChange={(event) => setGroup(event.target.value)} value={group} />
        </label>
        <div className="field field-span">
          <span>类型</span>
          <div className="segmented">
            <button
              className={targetKind === "ssh" ? "is-active" : ""}
              onClick={() => setTargetKind("ssh")}
              type="button"
            >
              SSH
            </button>
            <button
              className={targetKind === "local" ? "is-active" : ""}
              onClick={() => setTargetKind("local")}
              type="button"
            >
              本地终端
            </button>
          </div>
        </div>
        {targetKind === "local" ? (
          <label className="field field-span">
            <span>Shell</span>
            <select onChange={(event) => setShell(event.target.value)} value={shell}>
              {shells.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="field field-wide">
              <span>主机</span>
              <input
                onChange={(event) => setHost(event.target.value)}
                placeholder="192.168.1.10"
                value={host}
              />
            </label>
            <label className="field field-port">
              <span>端口</span>
              <input
                max={65535}
                min={1}
                onChange={(event) => setPort(Number(event.target.value))}
                type="number"
                value={port}
              />
            </label>
            <label className="field field-span">
              <span>用户名</span>
              <input onChange={(event) => setUsername(event.target.value)} value={username} />
            </label>
            <div className="field field-span">
              <span>认证</span>
              <div className="segmented">
                <button
                  className={authKind === "password" ? "is-active" : ""}
                  onClick={() => setAuthKind("password")}
                  type="button"
                >
                  密码
                </button>
                <button
                  className={authKind === "private_key" ? "is-active" : ""}
                  onClick={() => setAuthKind("private_key")}
                  type="button"
                >
                  私钥
                </button>
              </div>
            </div>
            {authKind === "private_key" ? (
              <label className="field field-span">
                <span>私钥路径</span>
                <input
                  onChange={(event) => setKeyPath(event.target.value)}
                  placeholder="C:\\Users\\me\\.ssh\\id_ed25519"
                  value={keyPath}
                />
              </label>
            ) : null}
            <label className="field field-span">
              <span>{authKind === "password" ? "密码" : "Passphrase"}</span>
              <input
                autoComplete="new-password"
                onChange={(event) => setSecret(event.target.value)}
                placeholder={profile ? "已保存，留空保持不变" : "安全存入系统凭据管理器"}
                type="password"
                value={secret}
              />
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
