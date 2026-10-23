# Remote Ops v0.8.0 验收

日期：2026-10-23。开发机 Windows，原生宿主 DSH 0.2.0-rc.2，Chrome 155。测试目标是本机隔离 HTTP 服务；原生 Agent 调度使用确定性测试模型服务，没有修改用户 Agent、全局 skill 或日常 DSH profile。

## 自动回归

- `npm run check --prefix integrations/dsh-remote-ops`：语法与 API 内联源同步检查；后端、客户端行为、契约及烟测。
- 新增 API 后端用例：保存/更新/删除与重启恢复、账号密码写入凭据服务、JSON/form、响应体/响应头 Token、Cookie/CSRF、Schema 与 skill JSON 示例、会话隔离、超时/取消/401 不重试、重复 ID、跨域/路径拒绝、请求/响应大小与记录数量边界、并发环境更新、凭据脱敏。
- `npm test --prefix e2e`：测试服务与报告生成回归。
- 完整浏览器套件 16/16 场景通过，生产客户端与插件后端、仿宿主、隔离设备。新增 API 场景覆盖 UI 配置/登录、Agent 调用、记录导出、切页持续执行和窄屏恢复。原生打包修正后再次运行 API 场景通过。
- DSH UI 契约检查 14 项通过，0 错误；唯一提示为本包不是 Codex 插件，不要求 `.codex-plugin/plugin.json`。

## 原生 DSH 候选包验证

候选包通过 DSH `plugin --profile web add` 安装，已安装客户端 SHA256 与源码相符。最终候选 `api080-candidate3` 的七项场景全部通过：

1. UI 保存独立 API 环境与 DSH 凭据，无需 SSH 配置。
2. UI 登录获取 Token、执行请求并显示业务响应。
3. 原生 Agent 发现四个随包 skill 中的 `remote-ops-api`，六个 API 工具全部注册；八次原生调用完成 skill 加载、环境查询/创建/修改/删除、Cookie 登录、CSRF 请求与记录读取。
4. 从 API 切换终端再返回，后台请求继续、草稿保留，没有重复发送。
5. JSON 导出覆盖 Token/Cookie 两种环境，测试密码/Token/Cookie/CSRF 值均未出现在导出中。
6. DSH 原生停止对话中断已发出的请求等待，回执为 `unknown / API_CANCELLED`，不自动重发。
7. 原生深色主题及 390px 右栏无横向溢出；截图已人工检查。

初次候选发现 DSH 连接服务的虚拟路由不能作为浏览器原生动态 import 入口。已改为把 API 界面随原生客户端包内联，不使用 CDN、eval 或额外前端运行时；门禁验证生成产物与源文件一致。

## 正式发布安装复验

待发布后下载 GitHub 官方 tgz、核对 SHA256，再使用相同原生流程复验；此节在验证完成后更新。

## 验证边界

已验证真实 DSH 的加载、原生工具/skill 注册、凭据服务、界面与取消行为。业务目标使用隔离测试服务，没有连接用户内网设备，也没有声称覆盖具体厂商的登录协议。真实厂商字段、业务成功判据和私有 CA 需要按设备 API 文档配置。多步 SSO/MFA/验证码不在本版范围。

本机详细证据（不随安装包分发）：`output/api080-check-final2.log`、`output/e2e/api080-full/report.json`、`output/e2e/api080-final/report.json`、`output/playwright/api080-candidate3-acceptance.json` 与对应截图。
