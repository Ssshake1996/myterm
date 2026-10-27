# Remote Ops 浏览器测试

## 真实 DSH 热加载验收

Windows 主机可运行 `node e2e/runner/hot-reload-native.mjs <tgz>`，设置 `DSH_CLI` 为 DSH 0.2.0-rc.2 的 `lib/bin.js`，并先安装插件与 `e2e` 的依赖。可用 `HOT_RELOAD_OUTPUT` 指定证据目录，`NPM_CLI` 覆盖 npm 的 `bin/npm-cli.js` 路径。

测试安装传入包到独立 `DSH_HOME`，使用真实 DSH、Chrome、确定性模型和本地 SSH/网页/API 服务；临时合成后续版本以验证等待任务结束、前后端同步生效、连接与记录保留、同进程第二次升级及启动失败恢复。合成版本仅为测试夹具，不会发布。证据包含版本、包 SHA256、原生 Agent 工具结果检查与截图；不代表连接用户的生产设备。Windows Server CI 同时运行此验收。

这一层在真实 Chrome 里跑生产 `client.js`。后端是生产插件，SSH 连到进程内的假设备。它不启动完整的 DSH 宿主，所以不覆盖宿主登录、工作区选择和侧栏服务本身。

## 运行

```sh
npm ci --prefix integrations/dsh-remote-ops
npm ci --prefix e2e
npm test --prefix e2e
npm run e2e --prefix e2e
```

只跑一个场景：

```sh
npm run e2e --prefix e2e -- --grep 窄屏
```

需要本机的 Google Chrome。报告写到 `output/e2e/<时间>/`，包含 `report.html`、`report.md`、`report.json`、`junit.xml` 和每个关键步骤的截图。`report.html` 把截图内嵌进去，可以直接打开。

每个场景使用独立的数据目录和假设备。步骤结束、失败和明确调用截图时都会留下画面。控制台异常和 `/favicon.ico` 以外的 HTTP 错误会让场景失败。

## 场景

- 浏览器批量上传跨终端/运维面板卸载继续，下载回读内容一致（生产插件后端和本地文件系统，上传文件写入场景的独立临时目录）
- 历史传输不重复刷新，新完成任务合并刷新并保留选中和滚动（真实客户端，受控目录/任务 API 响应）
- 窄屏且传输历史较多时，两侧文件列表保留可用高度，目标 B 可滚动访问（受约束的 334px 面板与受控 API）
- 打开面板并在本地终端回显
- 设备 `(y/n)` 不会被自动回答
- 调整 SSH 终端大小，掉线后提示重连且不重放命令
- Agent 与界面读取同一终端输出；执行期间人工输入可用，原生对话取消信号结束发送等待
- 输入网址直接打开插件内实时网页；Agent 与人工共享点击/中文输入、取消阻止后续步骤、空白标签与键盘切换、模式切换和刷新恢复
- 可选登录配置与参数流程、XPath 唯一定位、iframe/原生弹窗/popup、Cookie 保留与显示偏好
- 长输出滚到末行，上移阅读时不被新输出抢走
- Agent/人工命令回显与 `dir` 文件/目录配色、深浅主题文字对比度、关键前缀高亮、日志分页读取、TXT/ZIP 实际下载及窄屏导出
- 环境密码按需显示/隐藏、关闭后清除、查看不改写、替换密码、慢请求取消及失败重试
- 390 像素窄屏没有横向溢出

测试宿主通过 `agent/pre-step` 绑定 canonical turn signal，取消端点模拟 DSH 的对话取消。原生停止按钮和主对话/右侧栏行为须在真实 DSH 验收。
