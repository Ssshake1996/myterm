# dsh-remote-ops v0.2.30

修正 DSH 左侧 Remote Ops 入口的对齐：展开时图标与文字靠左，缩进与原生入口一致；收起时仅显示居中图标与 Tooltip。点击继续打开原生右侧 Sidebar，保留主对话与草稿。

## 变化

- 用宿主传入的 `wide` 区分展开与收起样式，避免展开状态的图标文字整组居中。只调整插件按钮，采用 16px currentColor 图标，不改宿主布局或全局 CSS。
- 保留 v0.2.29 的原生右栏、唯一标签页、键盘和会话 owner 行为，以及 v0.2.28 的 SFTP 上传生命周期和目录刷新改进。
- 同步四份 README 的行为、版本和安装示例；同步 [dsh-plugin-ui Skill v0.1.3](https://github.com/Ssshake1996/dsh-plugin-ui-skill/releases/tag/v0.1.3) 的规则、右栏示例及展开/收起验收。

## 安装

下载本版本 tgz，在运行 DSH 的同一用户、`DSH_HOME` 和实际 profile 下安装，完全重启 DSH 并刷新浏览器：

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.2.30.tgz
dsh web
```

确认 Remote Ops 标题显示 `v0.2.30`；展开左侧栏时入口靠左，点击打开右栏。

## 验证

- 真实 DSH `0.2.0-rc.2`：先测 v0.2.29 的居中错误，再安装候选包复验。1280×900 下图标/文字左边缘从 88.90625/114.90625px 改为 22/46px，与宿主原生入口的 22/46px 一致。
- 收起时无文字且图标居中，公开 Tooltip 正常，重新展开恢复左对齐。主对话为同一编辑器、草稿保留，右栏无覆盖，重复点击仅一个标签页；关闭/重开、Enter / Space、390×844 无横向溢出及 reduced-motion 检查通过，无捕获页面异常。
- E2E 单元 4/4、浏览器 9/9，覆盖 SFTP 跨页面上传、刷新去重和选择/滚动保留等既有交互；使用真实 client/后端与仿宿主、假 SSH 设备。报告：`output/e2e/2026-10-12T04-53-58-726Z/report.html`。
- Skill 验证器及 checker 15 项回归通过；插件静态契约检查 14 通过、0 错误，只有纯 DSH 包缺少 Codex manifest 的提示。
- 发布脚本执行完整 `npm run check` 门禁并校验版本、README、安装包和摘要；正式 GitHub 安装包的下载、安装及真实宿主复验结果在交付时报告。

## 边界

本轮为入口样式补丁，真实宿主验收使用本机独立 profile，未直接验证其他物理电脑或其他 DSH 版本。真实远端 SSH/SFTP、IME 与模型调用未重测；仿宿主回归不能替代这些证据。右栏宽度、停靠和窄屏全屏行为由 DSH 负责。
