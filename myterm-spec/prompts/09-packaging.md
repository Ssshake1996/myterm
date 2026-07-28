# M8 任务指令:打包与分发

## 需要附上的上下文

- `01-product-spec.md`(重点:U9、非功能要求、命令行接口)
- `02-architecture.md`(重点:进程模型的 sidecar 说明)
- `src-tauri/tauri.conf.json`、`src-tauri/src/plugin/supervisor.rs`、根 `package.json`

## 任务

把 myterm 做成可分发的 Windows 产品:NSIS 安装包 + 绿色便携版,插件宿主的 Node 运行时以 sidecar 随包,收尾命令行参数与日志。macOS/Linux 保持可构建即可。

## 交付物

### 1. 构建管线

- 根 scripts `build:release`:依次构建 SDK → plugin-host(esbuild 打成单文件 `dist/main.js`)→ 三个插件(各自 `dist/`)→ 前端 → `tauri build`;
- 内置/官方插件作为资源打进安装包,首次启动复制到 `%APPDATA%/myterm/plugins/`(便携模式为 `data/plugins/`)。

### 2. Node sidecar

- `src-tauri/sidecar/` 放官方 node.exe(构建脚本从 nodejs.org 下载校验 sha256,不入 git);`tauri.conf.json` 以 externalBin 声明;
- `supervisor.rs` 的宿主启动路径改为:优先 sidecar,开发模式(debug build)回退系统 node;
- NSIS 安装包中"插件支持"做成可选组件(不选则不装 sidecar 与插件,主程序纯终端可用;supervisor 检测 sidecar 缺失时,在插件管理页显示引导而不是报错)。

### 3. 安装包与便携版

- NSIS:安装向导(中文)、开始菜单/桌面快捷方式、卸载(询问是否保留 `%APPDATA%/myterm`)、内置 WebView2 Evergreen Bootstrapper;
- 便携版:单目录 zip(exe + resources),启动脚本或默认检测同目录 `portable.flag` 即启用 `--portable`;
- Tauri updater 配置就位(签名密钥占位,更新 URL 留待用户填,README 说明生成方法)。

### 4. 收尾

- `--debug`:tracing 输出到 `%APPDATA%/myterm/logs/myterm-<日期>.log`(tracing-appender 滚动);plugin-host 的 stderr 也入同目录;
- `--profile <name>`:启动后自动连接该名称的 profile;
- 版本信息:关于页显示 app 版本 + 内核 commit hash(构建时注入)。

### 5. 测试与验收

- 单测:portable.flag 检测、插件资源首启复制(临时目录模拟);
- 构建产物检查脚本 `scripts/check-dist.ts`:安装包 < 25MB 断言(不含 sidecar 组件)、便携版 zip 内文件清单符合预期;
- **人工验收(干净 Windows 11 虚拟机)**:
  1. 安装包全组件安装 → U1–U8 全过;
  2. 安装包去掉"插件支持"→ 终端/SFTP 正常,插件页显示引导;
  3. 便携版解压到 U 盘路径 → 配置写在 data/ 下,机器无 %APPDATA% 残留;
  4. 任务管理器:1 个空闲会话、零插件 → 内存合计 < 80MB。

## 禁止事项

- 不要引入自定义安装框架(用 Tauri 自带 NSIS 目标)。
- 不要把 node.exe 提交进 git。
- 不要在本任务改任何业务逻辑;发现 bug 记录下来,回对应里程碑的模块修。
