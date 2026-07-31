# M7 任务指令:打包与分发(MVP 完成线)

## 需要附上的上下文

- `01-product-spec.md`(重点:U10、非功能要求、命令行接口)
- `src-tauri/tauri.conf.json`、根 `package.json`、`src-tauri/src/main.rs`

## 任务

把 myterm 做成可分发的 Windows 产品:NSIS 安装包 + 绿色便携版,收尾命令行参数与日志。macOS/Linux 保持可构建即可。MVP 无插件宿主,**不涉及任何 sidecar**。

## 交付物

### 1. 构建管线

- 根 scripts `build:release`:前端构建 → `tauri build`(NSIS + 便携目标);
- 版本信息:关于页显示 app 版本 + 内核 commit hash(构建时注入)。

### 2. 安装包与便携版

- NSIS:安装向导(中文)、开始菜单/桌面快捷方式、卸载(询问是否保留 `%APPDATA%/myterm`)、内置 WebView2 Evergreen Bootstrapper;
- 便携版:单目录 zip(exe + resources),检测同目录 `portable.flag` 即启用 `--portable`(等价于命令行参数);
- Tauri updater 配置就位(签名密钥占位,更新 URL 留待用户填,README 说明生成方法)。

### 3. 命令行与日志收尾

- `--debug`:tracing 输出到 `%APPDATA%/myterm/logs/myterm-<日期>.log`(tracing-appender 滚动;AI 相关只记元数据);
- `--profile <name>`:启动后自动连接该名称的 profile;
- `--portable`:见 M3,确认打包形态下路径正确。

### 4. 测试与验收

- 单测:portable.flag 检测、版本注入;
- 构建产物检查脚本 `scripts/check-dist.ts`:安装包 < 20MB 断言、便携版 zip 内文件清单符合预期;
- **人工验收(干净 Windows 11 虚拟机)**:
  1. 安装包安装 → 产品规格 U1–U10 全过;
  2. 便携版解压到 U 盘路径 → 配置写在 data/ 下,机器无 %APPDATA% 残留;
  3. 任务管理器:1 个空闲 SSH 会话 → 内存合计 < 80MB;
  4. 无 WebView2 的系统 → 安装包引导安装成功。

## 禁止事项

- 不要引入自定义安装框架(用 Tauri 自带 NSIS 目标)。
- 不要打包 Node/插件宿主(那是 P2 的事)。
- 不要在本任务改任何业务逻辑;发现 bug 记录下来,回对应里程碑的模块修。
