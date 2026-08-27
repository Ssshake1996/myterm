import { useEffect, useState } from "react";
import { localShellList, profileSave, type SessionProfile } from "../../ipc";
import { useUiStore } from "../../store/ui";
import { Modal } from "../shell/Modal";

interface ProfileModalProps {
  profile: SessionProfile | null;
  onClose: () => void;
  onSaved: (profile: SessionProfile, connect: boolean) => void;
}

export function ProfileModal({ profile, onClose, onSaved }: ProfileModalProps) {
  const notify = useUiStore((state) => state.notify);
  const [targetKind, setTargetKind] = useState<"ssh" | "local">(profile?.target.kind ?? "ssh");
  const [name, setName] = useState(profile?.name ?? "");
  const [group, setGroup] = useState(profile?.group ?? "默认");
  const [environment, setEnvironment] = useState(profile?.environment ?? "production");
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
  const [shellsLoading, setShellsLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<"save" | "connect" | null>(null);

  useEffect(() => {
    let active = true;
    void localShellList()
      .then((values) => {
        if (!active) return;
        setShells(values);
        setShellsLoading(false);
        setShell((current) => current || values[0] || "powershell.exe");
      })
      .catch(() => {
        if (!active) return;
        setShellsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const shellOptions = shells.includes(shell) || !shell ? shells : [shell, ...shells];

  const save = async (connect: boolean) => {
    if (!name.trim()) {
      notify("请输入会话名称", "error");
      return;
    }
    if (targetKind === "ssh" && (!host.trim() || !username.trim())) {
      notify("请填写主机和用户名", "error");
      return;
    }
    if (targetKind === "ssh" && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      notify("端口必须在 1 到 65535 之间", "error");
      return;
    }
    if (targetKind === "ssh" && authKind === "private_key" && !keyPath.trim()) {
      notify("请填写私钥路径", "error");
      return;
    }
    const retainsPassword =
      profile?.target.kind === "ssh" && profile.target.auth.kind === "password";
    if (targetKind === "ssh" && authKind === "password" && !secret && !retainsPassword) {
      notify("首次保存密码认证会话时必须填写密码", "error");
      return;
    }
    const id = profile?.id ?? crypto.randomUUID();
    const passwordRef = `profile.${id}.password`;
    const passphraseRef = `profile.${id}.passphrase`;
    const next: SessionProfile = {
      id,
      name: name.trim(),
      group: group.trim() || "默认",
      environment,
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
    setSavingAction(connect ? "connect" : "save");
    try {
      const saved = await profileSave(next, secret || undefined);
      onSaved(saved, connect);
      notify("会话配置已保存", "success");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setSavingAction(null);
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
            className="button"
            disabled={savingAction !== null}
            onClick={() => void save(false)}
            type="button"
          >
            {savingAction === "save" ? "保存中" : "保存"}
          </button>
          <button
            className="button button-primary"
            disabled={savingAction !== null}
            onClick={() => void save(true)}
            type="button"
          >
            {savingAction === "connect"
              ? "连接中"
              : targetKind === "ssh"
                ? "保存并连接"
                : "保存并打开"}
          </button>
        </>
      }
      onClose={onClose}
      size="large"
      title={profile ? "编辑会话" : "新建会话"}
    >
      <div className="form-grid">
        <div className="form-section-title field-span">基本信息</div>
        <label className="field">
          <span>名称</span>
          <input
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label className="field">
          <span>分组</span>
          <input
            autoComplete="off"
            onChange={(event) => setGroup(event.target.value)}
            value={group}
          />
        </label>
        <label className="field">
          <span>环境</span>
          <select
            onChange={(event) =>
              setEnvironment(event.target.value as "production" | "staging" | "development")
            }
            value={environment}
          >
            <option value="production">生产</option>
            <option value="staging">预发布</option>
            <option value="development">开发</option>
          </select>
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
            <select
              aria-label="Shell"
              aria-busy={shellsLoading}
              onChange={(event) => setShell(event.target.value)}
              value={shell}
            >
              {shellOptions.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            {shellsLoading ? <small>正在读取可用 Shell，当前表单仍可继续编辑。</small> : null}
          </label>
        ) : (
          <>
            <div className="form-section-title field-span">连接</div>
            <label className="field field-wide">
              <span>主机</span>
              <input
                autoComplete="off"
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
              <input
                autoComplete="off"
                onChange={(event) => setUsername(event.target.value)}
                value={username}
              />
            </label>
            <div className="form-section-title field-span">认证</div>
            <div className="field field-span">
              <span>方式</span>
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
                  autoComplete="off"
                  onChange={(event) => setKeyPath(event.target.value)}
                  placeholder="C:\\Users\\me\\.ssh\\id_ed25519"
                  value={keyPath}
                />
              </label>
            ) : null}
            <label className="field field-span">
              <span>{authKind === "password" ? "密码" : "Passphrase"}</span>
              <input
                aria-label={authKind === "password" ? "密码" : "Passphrase"}
                autoComplete="off"
                onChange={(event) => setSecret(event.target.value)}
                placeholder={profile ? "已保存，留空保持不变" : "安全存入系统凭据管理器"}
                type="password"
                value={secret}
              />
              <small>凭据仅保存在 Windows 凭据管理器中；编辑时留空会保留原值。</small>
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
