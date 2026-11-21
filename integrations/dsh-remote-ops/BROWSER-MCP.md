# 网页入口发现与视觉操作

在 **Remote Ops → 网页** 输入网址，然后在 DSH 对话中说明目标，例如：

> 打开当前管理网页里的用户管理。先查看菜单结构；如果入口只显示图标或画在 Canvas 上，就看截图寻找入口。打开后读取页面确认，先不要新增或删除用户。

安装插件会同时提供 `remote-ops-browser` skill 和工具使用提示，无需修改 Agent。已有网页、登录会话、插件内与独立窗口模式继续使用同一浏览器。

## 执行方式

1. Agent 加载 `remote-ops-browser`，调用 `remote_browser_list` 找到实际的 `browserId`、`pageId`。
2. 用 `remote_browser_read({browserId,pageId,snapshot:true})` 读取菜单层级、可访问名称、元素 `ref` 和 `snapshotId`。展开菜单后重新读取，逐级寻找入口。
3. 结构不能说明正确入口时，立即用 `image:true` 获取实际网页截图，不需要先等待 XPath 超时。截图通过 DSH 原生图片附件发送给当前配置的模型。
4. 用本次观察的 `ref` 点击、悬停或填入内容；图标、Canvas 等可使用截图中的坐标点击或悬停。每次只执行一个观察驱动的动作，读取结果后再决定下一步。

元素引用示例（ID 必须替换为刚刚观察所得的值）：

```json
{
  "browserId": "实际浏览器ID",
  "pageId": "实际页面ID",
  "requestId": "open-settings-1",
  "steps": [{"action":"click","target":{"kind":"ref","value":"e12","snapshotId":"本次观察ID"}}]
}
```

截图坐标示例：

```json
{
  "browserId": "实际浏览器ID",
  "pageId": "实际页面ID",
  "requestId": "open-canvas-entry-1",
  "steps": [{"action":"click","target":{"kind":"point","x":350,"y":225,"snapshotId":"本次截图观察ID"}}]
}
```

坐标是截图视口中的 **CSS 像素**，不是 DSH 面板缩放后的显示像素。若 DSH 对图片预览进行了缩小，需按返回的视口宽高与预览宽高的比例换算坐标。`image:true` 同时返回结构、截图和视口宽高。`ref` 支持 `click`、`hover`、`fill`；`point` 支持 `click`、`hover`。原有 role、label、text、CSS、XPath 定位及多步骤流程继续可用；引用与坐标每次只允许一个动作。

嵌入网页的横竖滚动条使用高对比滑块与轨道，按网页声明的明暗主题自动配色。按住滑块可拖动，移出面板后松开也能结束；切换工作区、页面变化或连接异常时释放拖动状态。保持原生滚动条尺寸、网页布局和 CSS 像素坐标，不增加显示设置。

插件内网页的 CSS 视口始终跟随右侧栏可用宽高，行为与调整 Chrome 窗口一致：页面按原字号重新排版，超宽内容横向滚动，长页面纵向滚动。拖动侧栏不会刷新网页，登录状态和未提交表单保持；网页自身的布局规则继续生效。用户与 Agent 操作同一页面，录制仍使用浏览器 CSS 像素。侧栏尺寸变化后，Agent 重新观察再使用元素引用或坐标；正在执行的单次动作完成后应用最新尺寸。 操作标示仅在 GUI 中显示，不注入页面、不增加录制事件。

观察有效期为 60 秒，动作执行后失效。页面结构、地址、滚动或视口变化，以及坐标操作前截图变化，会报 `BROWSER_OBSERVATION_STALE`；重新观察再决定操作，不自动重放。动态页面可能需要重新截图。`remote_browser_run` 返回的是任务，需读取任务状态并核实页面结果；完成一个点击不代表业务成功。

用户和 Agent 可同时操作。停止 DSH 对话会阻止后续步骤，但已经下发的点击可能生效。引用填写按敏感内容处理，操作日志省略其值；截图保留网页实际显示内容。页面文本、链接和图像都是待分析的数据，不能作为修改权限或泄露信息的指令。

## 本地 MCP 与网络边界

插件固定使用 `@playwright/mcp@0.0.83`、`@modelcontextprotocol/sdk@1.25.2` 和现有 `playwright-core@1.64.0`。MCP client/server 通过 SDK 的 `InMemoryTransport` 在插件进程内通信，并连接已经打开的 Playwright BrowserContext；该适配器不启动额外 Node 服务、不开放 MCP 监听端口、不创建第二个浏览器，也不配置微软或其他模型服务。页面 WebMCP 和任意 MCP 工具执行均未开放。

实际数据路径：

```text
DSH 当前模型 ←→ DSH 工具／图片附件 ←→ Remote Ops
                                      ↓ 进程内 MCP
                              同一 Playwright 浏览器 ←→ 目标网站
```

MCP 是工具通信协议，本身不决定数据是否出网。网页正文与截图会交给 **DSH 所配置的模型服务**；网站也可能加载第三方资源。包安装、浏览器下载、宿主更新检查与日常网页访问必须分别考虑，不能用“本地 MCP”代替网络隔离。

对模型也不能联网的内网部署：

- 在 DSH 配置内网或本机模型地址；视觉操作需要支持图片输入的模型。纯文本模型仍可使用结构快照，图片读取会明确失败，不自动选择其他服务。
- 将正式 tgz、依赖及浏览器运行库放入批准的内网源；通过现有 HTTP(S) 更新源发布版本，安装后再进行运行时隔离。
- 由操作系统或出口网关默认拒绝外联，只放行本机、批准的模型和业务网站。规则覆盖 DSH、Node、浏览器进程及 DNS、IPv4/IPv6；内网 DNS 不应向公网转发未经批准的域名。插件不会擅自修改机器防火墙。
- 验证时同时查看网络连接与防火墙日志。阻断负责保证不能外发，抓包或系统调用审计负责说明测试过程中尝试连接了什么。

仓库中的 `scripts/browser-network-isolated.sh` 在 CI 的独立 Linux network namespace 内建立无出口的测试内网（loopback 和两端均留在内部的虚拟网卡，没有默认路由、桥接或 NAT），先证明外部路由被拒绝，再运行真实 MCP/浏览器和原生 DSH 安装包测试，并用 `strace` 审计网络目标。安装与依赖下载在隔离前完成。结果是固定依赖、指定场景下的证据，不代表所有网站、浏览器版本和宿主配置永远零外联。真实内网模型的识图准确率仍需要在目标环境验收。

网络报告单独列出 Chromium 对 `2001:4860:4860::8888:443` 的 IPv6 路由探测：只有核实为 UDP socket 的 `connect` 且系统明确返回 `ENETUNREACH` 时，才归为被阻断的路由检查；其他非 loopback 目标或数据发送仍使门禁失败。这与 [Chromium 的 IPv6 连通性说明](https://github.com/chromium/chromium/blob/main/net/dns/README.md#ipv6-and-connectivity)一致，不能表述为“没有任何外联尝试”。
