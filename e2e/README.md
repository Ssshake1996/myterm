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

- 打开面板并在本地终端回显
- 设备 `(y/n)` 不会被自动回答
- 调整 SSH 终端大小，掉线后提示重连且不重放命令
- Agent 发送与界面看到同一条输出，人工输入时拒绝
- 长输出滚到末行，上移阅读时不被新输出抢走
- 390 像素窄屏没有横向溢出
