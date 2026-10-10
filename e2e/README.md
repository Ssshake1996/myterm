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

仿宿主的每个场景使用独立的数据目录和假设备。步骤结束、失败和明确调用截图时都会留下画面。控制台异常和 `/favicon.ico` 以外的 HTTP 错误会让场景失败。

## 完整 DSH 宿主

这一层启动公网 npm 上钉死的 `@deepseek-ai/dsh@0.2.0-rc.2`。宿主进程必须是 Node 24；当前进程更低时设置 `DSH_NODE`。每次使用全新的 `DSH_HOME`，并把工作区的 Documents 目录指到这个临时目录里，避免系统文件选择框。插件用 `dsh plugin --profile web add` 安装当前源码打出来的包，再执行 `pnpm rebuild`，让 `ssh2` 按 Node 24 编译。

```sh
npm ci --prefix e2e/host
DSH_NODE=/path/to/node24 npm run e2e:host --prefix e2e
```

Node 24 本身在跑测试时可以省略 `DSH_NODE`。还需要本机的 `pnpm` 和 Google Chrome。报告写到 `output/e2e-host/<时间>/`。一次启动的宿主和假设备跑完六个场景：打开面板并在真实本地 Shell 回显、设备 `(y/n)` 不会被自动回答、调整终端大小后掉线重连且不重放、人工输入后可以交还、长输出滚动、390 像素下面板没有横向溢出。它不调用模型，也不读取用户自己的 `~/.dsh`。Agent 直接调用工具仍由仿宿主层覆盖。

## 场景

- 打开面板并在本地终端回显
- 设备 `(y/n)` 不会被自动回答
- 调整 SSH 终端大小，掉线后提示重连且不重放命令
- Agent 发送与界面看到同一条输出，人工输入时拒绝
- 长输出滚到末行，上移阅读时不被新输出抢走
- 390 像素窄屏没有横向溢出
