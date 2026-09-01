# myterm 标准构建与发布流程

本文是 Windows 开发机上的标准发布流程。正常发布不再临时拼接命令，统一使用仓库脚本：

```powershell
cd F:\myterm
npm run release -- -Version 0.11.1 -RunRustTests
```

把 `0.10.0` 换成下一个三段式版本号。脚本会自动更新版本文件、执行校验、构建安装包、生成便携包和 SHA256，并推送 GitHub Release。除非只做本地诊断，不要临时拼接另一套发布命令。

## 脚本执行顺序

`scripts/release.ps1` 固定执行以下步骤：

1. 检查 `docs/releases/v<版本>.md` 是否存在。
2. 同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`Cargo.lock`、Tauri 配置和文档中的版本号。
3. 使用单线程 Vitest 执行前端测试，避免 Windows 多 Worker 抢占内存。
4. 执行 Biome lint、Vite 类型检查和前端生产构建。
5. 执行官方 DeepSeek Harness 门禁：版本锁/profile 检查和 ACP 创建会话 smoke test。
6. 执行桌面宿主 `cargo fmt --check` 和 `cargo check -j 1`；传入 `-RunRustTests` 时再单线程执行宿主 Rust 全量测试。
7. 使用 `npm run build:release`：先按 lockfile 准备 Harness + 私有 Node resources，再生成新的 NSIS 安装器和便携 ZIP。Rust 构建固定使用 `CARGO_BUILD_JOBS=1`，不复用旧版本二进制。
8. 执行 `npm run check:dist`，检查包体积、便携包内容和必需文件。
9. 启动本次新构建的便携版 35 秒，采样私有内存、工作集和句柄；若私有内存持续增加超过 8 MiB 或句柄增加超过 32，则终止发布。
10. 生成 `dist-release/SHA256SUMS-v<版本>.txt`。
11. 提交当前工作区、创建 `v<版本>` 标签，并推送 `main` 和标签。
12. 使用 Git Credential Manager 中的 GitHub 凭据创建 Release，上传安装器、便携包和校验文件。

## 只构建不发布

需要检查本地产物但不创建 GitHub Release 时：

```powershell
npm run release -- -Version 0.11.1 -SkipPublish -RunRustTests
```

该模式仍会提交、打标签并推送代码；如果连 Git 操作也不希望执行，应直接使用：

```powershell
npm run build:release
npm run check:dist
```

## 可选 Rust 测试

默认发布流程使用 `cargo check`，因为 Windows Debug 测试链接会构建大型桌面依赖。具备足够虚拟内存和完整工具链时，可以额外执行：

```powershell
npm run release -- -Version 0.11.1 -RunRustTests
```

Core Rust、N-API 边界或宿主 Rust 测试失败时脚本不会创建 Release。不能通过跳过失败、复用旧 EXE、旧 `.node` 或把旧产物改名来发布。

## 构建环境约束

- Node 20+、npm、Rust、Cargo、Tauri CLI、NSIS 必须可执行。构建机 Node 会被复制进安装资源，最终用户不需要预装 Node。
- `npm run prepare:harness-runtime` 会按 `integrations/deepseek-harness-runtime/package-lock.json` 安装固定生产依赖并生成 `src-tauri/resources/deepseek-harness-runtime`。该目录是构建产物，不提交 Git。
- 仓库根目录 `.cargo/config.toml` 默认启用 `aws-lc-sys` 随 crate 提供的 Windows x64 预编译汇编对象，因此干净构建不要求全局安装 NASM，同时保留 Release 的汇编优化。若未来升级 TLS 后端或改为其他目标架构，必须先做一次无缓存构建验证再调整该设置。
- Windows 建议保留充足页面文件，并避免同时运行多个 `vite`、`vitest`、`rustc` 编译进程。
- 若 `src-tauri/target/debug` 因长期增量构建异常膨胀，可在确认路径后执行 `cargo clean --profile dev`；该命令只清理可再生成的 dev 构建缓存，不删除源码、配置或 `target/release` 安装产物。
- `dist-release` 是本地发布输出目录并被 Git 忽略；Release 上传的是脚本刚生成的文件。
- GitHub 发布需要 `gh auth login` 或 Git Credential Manager 中存在 `github.com` 凭据。
- 运行时内存采样只判断明显持续增长，不替代长时间压力测试和干净 Windows 虚拟机验收。

## 故障处理原则

- 前端测试内存不足：确认脚本使用了单线程参数，不要并行重复启动测试。
- Rust 编译失败：保留完整原始输出，先检查页面文件、工具链和剩余虚拟内存。
- Release API 失败：确认 GitHub 凭据和仓库权限；不要重新上传旧版本资产。
- 任何步骤失败都不应声称发布完成；先查看 `git status`、版本号、标签和 `dist-release` 文件名。
