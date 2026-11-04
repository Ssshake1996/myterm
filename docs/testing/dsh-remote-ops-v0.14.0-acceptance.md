# dsh-remote-ops v0.14.0 验收记录

2026-11-04。SERIAL 与 SSH、TELNET 在现有环境表单的连接协议中并列，复用终端标签、用户和 Agent 输入、设备回显、日志及关闭流程。

| 验收层 | 结果 |
| --- | --- |
| 本地完整回归 | 481 项通过（桌面 11、后端 331、客户端 127、契约 12），smoke 通过。新增 6 项针对串口的回归。 |
| 浏览器回归 | 24 个场景、106 步通过。使用真实客户端和插件后端的浏览器测试框架。 |
| Windows 真实 DSH 0.2.1-rc.5 | 安装候选 tgz，2/2 场景通过。验证三个协议选项、原生 COM 枚举、串口表单、保存、Agent 修改参数和不存在端口的诊断。 |
| Linux 真实 DSH 0.2.1-rc.5 | 4/4 场景通过。通过内核 PTY 完成实际打开、收发、独占冲突、可见回显、日志下载、关闭和重连。[候选包运行记录](https://github.com/Ssshake1996/myterm/actions/runs/41795168163) |
| UI 与随包 skill | UI 契约 14 项通过、0 错误，1 个提示为此包不是 Codex 插件。环境与日志 skill 结构检查及工具示例 Schema 校验通过。 |

Linux 的设备端为脚本独占的内核伪终端。用户输入和 Agent 工具发送的两条命令各被设备收到一次，下载的 TXT 含两条设备回复，且其 SHA256 与工具收据一致。在连接期间测试同一端口得到 `SERIAL_PORT_BUSY`。关闭标签后得到新 sessionId，再次收发成功。模型回复使用本地确定性测试服务，工具经过实际 DSH 分发。本次没有使用实体交换机、生产串口设备或 macOS 电脑。

回归包含 Windows 和 Unix 设备路径校验、无主机/账号的环境持久化、切换协议时清理旧端点与凭据、编码与行尾、独占及迟到的驱动打开回调、拔出后的输出保留及 SSH 专用能力边界。首次 Linux GUI 验收因空白宿主缺少工作区停在首次输入前，改用临时 DSH 配置指定测试工作区后通过；没有修改宿主或 Agent。早期完整门禁还发现旧发布依赖清单和表单契约中的断言需要同步，保留对原有 SSH 名称回退与 CLI 配置的检查。

## 复现

```powershell
npm run check --prefix integrations/dsh-remote-ops
$env:DSH_CLI = 'path-to-installed-dsh/lib/bin.js'
$env:SERIAL_OUTPUT = 'output/serial-native-new-run'
node e2e/runner/serial-native.mjs path-to-package.tgz
```

原生验收需要 Chrome、pnpm 和已安装的 DSH，Linux 另需 Python 3 创建 PTY。Windows 路径只枚举端口，并用已确认为空的设备号验证故障提示。发布工作流从 Windows 构建桌面运行时，将最终 tgz 和 SHA256 文件交给 Linux 原生验收任务，通过后才上传 Release 附件。
