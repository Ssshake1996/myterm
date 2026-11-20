# dsh-remote-ops v0.17.0

网页操作加入菜单结构观察、元素引用与截图坐标定位，让 Agent 在找不到正确入口时及时改用视觉判断。

- `remote_browser_read` 新增 `snapshot:true` 和 `image:true`：返回可访问菜单层级、元素 ref、观察 ID，并通过 DSH 原生图片附件传递真实截图。
- `remote_browser_run` 支持观察引用的点击、悬停、填写，以及截图坐标点击与悬停。保留现有 CSS、XPath、role 等定位方式。
- 使用官方 Playwright MCP 的进程内连接，复用当前浏览器和登录状态，不新增 MCP 监听端口；固定经过兼容测试的依赖版本。
- 拦截过期、跨页面和重复使用的观察，校验视口、结构与截图变化，沿用原生对话取消和任务去重。
- 随包 `remote-ops-browser` skill 说明如何发现入口、何时使用视觉及如何验证结果。不修改 DSH Agent；图片仅进入当前配置的模型。
- 新增系统级网络隔离验收与发布门禁，区分依赖安装、运行流量、网站请求及模型请求。

视觉操作需要 DSH 当前配置的模型支持图片输入。内网部署应配置内网模型，并由操作系统或网关控制出站网络；本地 MCP 本身不等于网络隔离。

使用方式与网络边界见[网页操作指南](https://github.com/Ssshake1996/myterm/blob/main/integrations/dsh-remote-ops/BROWSER-MCP.md)。验证范围见[验收记录](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.17.0-acceptance.md)。

仅发布 `dsh-remote-ops-v0.17.0.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.17.0.txt`。
