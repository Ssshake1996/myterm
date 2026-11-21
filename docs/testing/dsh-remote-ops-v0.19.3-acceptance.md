# v0.19.3 网页点击显示与鼠标光标验收

日期：2026-11-21。Windows 本地隔离 DSH 0.2.1-rc.5，真实 Chromium、正式安装方式与 DSH 工具链；网页和模型响应来自确定性本地测试服务。未操作用户另一台电脑，不修改日常 DSH 配置或 Agent。

最终包：247109336 字节，SHA256 `abd74dcf68fd9642a58a5b6befa1b3c11d66a11e404d709eeb23ce3ab97a0db1`。103 个源码与说明文件和工作区一致，包含 Windows/Linux x64 运行库。

| 验收项 | 结果 |
| --- | --- |
| 点击显示 | 插件点击位置叠加层不存在；实际 DSH 截图确认点击输入框后只有网页自己的焦点边框和文字，没有额外蓝白方块。 |
| 标准光标 | 输入框、文本域、contenteditable、开放 Shadow DOM 输入框为 text；链接为 pointer；原生按钮为 default；声明 grab 的区域为 grab。 |
| 内嵌页面 | 跨域 iframe 内的输入框与链接分别为 text 和 pointer，边框和坐标换算正确。 |
| 连续移动 | 首次查询延迟期间快速经过多个元素，只有一个在途请求；恢复后仅补发最新位置，共两个请求，最终光标为 grab。 |
| 生命周期 | 离开画面恢复默认光标；页面、视口或可见性变化时取消待发查询、丢弃旧结果。单元回归覆盖过期页面、非法坐标、弹窗和查询中途导航。 |
| 操作语义 | 只读查询没有触发 pointermove 或改变网页焦点；真实 DSH 点击后中文输入正常，滚动条拖动、录制、Agent 定位与坐标点击仍通过。 |
| 热加载 | 正式 v0.19.2 的活动网页经 DSH 安装和热激活 v0.19.3，原页面及草稿保留，新客户端可调用光标查询。 |
| 自动化回归 | 543 项桌面、单元、客户端、契约检查与 smoke，12 项真实浏览器专项、5 项录制测试、26 个界面场景通过。 |
| 最终安装包 | 17 项真实 DSH 网页/录制检查、6 项 Agent/MCP 检查通过，二者包摘要均与最终 tgz 一致。 |

证据：`output/browser-cursor-0193-native/evidence.json`、`output/browser-cursor-0193-native/step-12.png`、`output/browser-cursor-0193-mcp/evidence.json`、`output/browser-cursor-0193-live/evidence.json`、`output/browser-cursor-0193-ui/report.json`、`output/browser-cursor-0193-package-audit.json`。

鼠标形状通过实际 DSH 画面元素的计算样式断言；截图用于核对叠加方块和输入结果，不把截图中未捕获的系统鼠标图形当作证据。网页点击继续使用 [Playwright 主 frame CSS 像素坐标](https://playwright.dev/docs/api/class-mouse)，没有改变点击、定位或录制坐标。
