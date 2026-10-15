# dsh-remote-ops v0.5.2

- 修复插件工具参数字段表未转换为标准 JSON Schema 的注册问题；全部工具现在声明标准对象结构和 required 数组，网页步骤按动作声明必填字段及动作/定位器枚举。
- 修复网页步骤可选 null/空白 iframe 字段导致 `BROWSER_STEP_INVALID`、`expect: null` 导致 TypeError；保留空文本填充、精确空 role 名称、网站凭据隔离和请求去重。
- 步骤错误明确指出下标和字段路径；整次步骤在派发前完成校验，不自动重试、猜测定位器或替换动作。`read` 步骤需要 target，整页观察使用 `remote_browser_read`。
- 同步中英文 README、WEB 文档和随包 `remote-ops-browser` skill；未修改 Agent 实现、已有 Agent 提示段或 DSH 内核。Ajv 仅用于开发测试，没有新增运行时依赖。
- 新增完整 Schema、条件必填、空值与不派发动作回归；真实 DSH 验证检查实际发送给模型的工具 Schema。验收详情见 [v0.5.2 验收说明](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.5.2-acceptance.md)。

安装到实际运行 DSH 的用户、DSH_HOME 和 profile；完全停止旧进程、重新启动并刷新网页，确认插件显示 `v0.5.2`。保存配置保留，运行任务不跨重启恢复；随包 skill 自动注册，不需要另行复制或迁移 Agent 配置。

另一台电脑的完整失败入参尚未取得，真实内网站点与模型组合仍需现场验收；本版本修复的是已独立复现的插件参数协议与空值问题。
