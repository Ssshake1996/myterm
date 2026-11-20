# Remote Ops v0.17.0 浏览器 MCP 与网络验收

2026-11-20。插件使用官方 Playwright MCP 0.0.83、MCP SDK 1.25.2 和现有 Playwright Core 1.64.0，通过进程内 MCP 连接现有浏览器。没有修改 DSH Agent，也没有为 MCP 新增监听端口。

## 功能与安装包

- 本机完整检查：366 项单元、136 项客户端、12 项契约、11 项桌面测试及 smoke 全部通过。DSH UI 契约 14 项通过，0 错误。
- 真实浏览器 9 项通过：菜单层级、引用展开、表单填写与提交、截图点击 Canvas、旧截图拒绝、人工变更失效、对话隔离、同 URL 多标签精确选择、MCP 释放后浏览器保持打开。
- Windows 独立 DSH 0.2.1-rc.5 安装正式候选包，4 项通过：随包 skill 加载、原生 Agent 获取结构快照、实际截图字节进入配置的图片模型接口、坐标点击改变真实网页。页面 JavaScript 错误为 0。
- 原生 DSH 模型端使用本地确定性服务，以便检查实际工具与图片传递；这不是对某个真实视觉模型准确率的评测。
- 打包后的 100 个源码、说明和 skill 文件与候选源码一致；包不包含测试配置、凭据或 node_modules。Windows/Linux 随包浏览器沿用现有打包方式。
- 正式候选包 SHA256：`8f17a703ea2665a047b1a7a095ef1e1ee3e6c163094559a6da2020839afe8098`，247,095,420 字节。发布资产仅 tgz 和 SHA256，摘要固定在[包校验记录](../releases/dsh-remote-ops-v0.17.0.sha256)。

## 系统级网络验收

[隔离网络验收](https://github.com/Ssshake1996/myterm/actions/runs/44697265513)通过。安装依赖在隔离前完成；运行时使用独立 Linux network/mount namespace，没有外部网卡、默认路由、桥接或 NAT。两端均在内部的虚拟网卡模拟内网链路，DNS 由仅返回 NXDOMAIN、从不转发的本地服务处理。

负向对照确认外部地址被系统返回 `ENETUNREACH`；DNS 负向对照确认查询被本地拒绝。随后跟踪 Node、浏览器和原生 DSH 的网络系统调用，实际完成上述网页操作。审计与功能测试使用真实进程，没有替换 MCP 或浏览器工具实现。

| 项目 | 实际结果 |
| --- | --- |
| MCP/浏览器审计 | 118 个解析到的目标记录；5 次 Chromium IPv6 路由探测被系统阻断；没有其他非 loopback 目标 |
| 原生 DSH 审计 | 131 个解析到的目标记录；10 次同类探测被系统阻断；没有其他非 loopback 目标；4 项工具/图片验收通过 |
| DNS | 220 次查询，全部在本地拒绝，未转发；包含负向测试域名及下述 Chrome 后台域名 |
| 发布门禁 | 正式发布流程已对同一 SHA256 候选包完成网络隔离、Windows 与原生 DSH 门禁 |

Chrome 后台查询包括 `www.gstatic.com`、`www.google.com`、`accounts.google.com`、`content-autofill.googleapis.com` 和 `update.googleapis.com`。这说明“运行本地 MCP”不能替代浏览器和整机出站策略。测试未发现微软服务请求，但不能据此保证所有网站、浏览器版本和宿主配置永远没有外联尝试。

IPv6 记录对应 `2001:4860:4860::8888:443`。只有已核实 UDP socket 的 `connect` 明确返回 `ENETUNREACH` 时，审计才将其归为被阻断的路由检查；其余非 loopback 连接/发送使门禁失败。依据是 [Chromium 的 IPv6 连通性实现说明](https://github.com/chromium/chromium/blob/main/net/dns/README.md#ipv6-and-connectivity)。完整查询和系统调用日志保存在该工作流的 `browser-mcp-network-evidence` 资产；摘要见[结构化回执](receipts/browser-mcp-v0.17.0.json)。

早期验收保留了将 IPv6 探测一律视为失败、Linux 未配置文档目录、浏览器读取 CI 默认外部 DNS 时的失败记录。最终配置使用独立工作区和不转发的内网 DNS；没有通过删除流量记录或忽略任意外部地址使测试通过。

## 其他发布检查

- [完整浏览器回归](https://github.com/Ssshake1996/myterm/actions/runs/44696964964)、[Windows 桌面](https://github.com/Ssshake1996/myterm/actions/runs/44696965000)、[Windows OpenSSH](https://github.com/Ssshake1996/myterm/actions/runs/44696965060)均通过。
- [正式发布流程](https://github.com/Ssshake1996/myterm/actions/runs/44697265513)全部通过，包含原生 DSH 串口与网页录制回归，以及本文网络门禁。
- Release 已公开并标记 Latest，只有 tgz 和 SHA256 两个资产。
- 已匿名下载公开发布的完整 tgz 与 SHA256 文件，核对文件大小及整个文件的 SHA256，结果与上述正式验收包一致；下载回执见[结构化回执](receipts/browser-mcp-v0.17.0.json)的 `publishedDownload`。

## 使用边界与复验

视觉判断由当前配置的 DSH 图片模型完成；纯文本模型可使用结构快照，读取截图会明确报错。尚未验收用户内网中的真实模型、生产网站或 Windows 防火墙规则。生产环境需要配置本机/内网模型、批准的业务地址、内网 DNS 与出站白名单，详见[操作与网络指南](../../integrations/dsh-remote-ops/BROWSER-MCP.md)。

截图或页面发生变化时，动作可能被 `BROWSER_OBSERVATION_STALE` 拒绝。Agent 应重新观察，在确认之前没有发生副作用后再作决定。测试对这种执行前拒绝进行有限次数的重新观察，不重试未知状态的业务操作。

```powershell
npm run check --prefix integrations/dsh-remote-ops
node integrations/dsh-remote-ops/test/browser-mcp-live.mjs
$env:DSH_CLI = '已安装 DSH 的 lib\bin.js 绝对路径'
$env:MCP_NATIVE_OUTPUT = '新的独立验收目录'
node e2e/runner/browser-mcp-native.mjs ./dsh-remote-ops-v0.17.0.tgz
```

网络复验通过 `.github/workflows/browser-mcp-network.yml` 在临时 Linux namespace 中执行；该工作流同时记录路由、负向探测、DNS 和网络系统调用。
