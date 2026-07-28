# M3 任务指令:配置服务与凭据保险库(Rust)

## 需要附上的上下文

- `02-architecture.md` 全文(重点:内核类型的 SessionProfile/AuthMethod、前端 IPC 契约的配置部分、错误处理约定)
- `src-tauri/src/types.rs`、`src-tauri/src/ipc.rs`

## 任务

实现配置的持久化和凭据的 OS 级加密存储,并接通 profile CRUD 的 Tauri 命令。完成后 M2 的会话管理器表单可以真实保存与连接。

## 交付物

### 1. `src-tauri/src/config/service.rs`

- `ConfigService`:
  - 数据文件 `%APPDATA%/myterm/config.json`(结构:`{ version: 1, profiles: [...], settings: {...} }`;`settings` 为任意键值,供 M6 插件配置复用);
  - `--portable` 启动参数时改用 exe 同目录 `data/config.json`(路径解析逻辑集中在一个函数,带单测);
  - 读:文件不存在返回默认空配置;JSON 损坏时把原文件改名为 `config.json.bak-<时间戳>` 后返回默认配置(不得静默丢弃,tracing 记 warn);
  - 写:**原子写**(写临时文件 + rename);
  - profile 的 `upsert(profile)` / `delete(id)` / `list()`;settings 的 `get(key)` / `set(key, value)`。

### 2. `src-tauri/src/config/vault.rs`

- `CredentialVault` trait:`set(ref, secret)` / `get(ref) -> Option<String>` / `delete(ref)`;
- 两个实现:`KeyringVault`(service 名 `dev.myterm.app`,底层 keyring crate)、`MemoryVault`(测试用);
- 实现 M1 定义的 `SecretResolver`,把 `vault_ref` 解析接到 vault 上;
- `profileDelete` 时级联删除其引用的 vault 条目。

### 3. `src-tauri/src/ipc.rs`(配置部分)

- 按 IPC 契约实现:`profile_list` / `profile_save` / `profile_delete` / `vault_set` / `vault_delete`;
- `main.rs` 装配:`KeyringVault` 注入 `SessionManager` 作为 `SecretResolver`,替换 M1 的环境变量实现。

### 4. 测试

- config:临时目录下测 CRUD、原子写(写入过程中不存在半成品文件)、损坏文件的 .bak 行为、portable 路径解析;
- vault:用 `MemoryVault` 测 SecretResolver 解析、profile 删除级联;`KeyringVault` 的真实读写用例标 `#[ignore]`(CI 无凭据库环境),交付说明中给出手动运行命令;
- 回归:全量 `cargo test` 中,M1 的集成测试仍通过(SecretResolver 替换未破坏契约)。

## 禁止事项

- 不要自造加密(不要用对称密钥加密后存文件——必须走 OS 凭据库)。
- 不要把明文密码写进任何日志、错误消息、config.json。
- 不要动 `SessionManager` 的公共接口。
