# Remote Ops 浏览器测试

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
- 390 像素窄屏没有横向溢出

测试宿主通过 `agent/pre-step` 绑定 canonical turn signal，取消端点模拟 DSH 的对话取消；不提供额外 Agent 接管/暂停/停止工具。原生停止按钮和主对话/右侧栏行为仍须另行在真实 DSH 验收。
