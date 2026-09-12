# dsh-remote-ops v0.2.1

## 修复

- 修复部分 DSH Web 环境因硬依赖 `sidebarRight`、`sidebarRightTabs` 而停留在 `pending`、阻塞 Web 启动的问题。
- 改为在右侧 Sidebar 服务实际可用时动态挂载；旧版或非 Web 配置不会再阻塞整个 DSH 启动。

## 版本与升级

- Sidebar 顶部显示当前插件版本。
- 增加 GitHub Release 更新检查。
- 支持在 Sidebar 中一键安装最新插件包，安装完成后提示重启 DSH。
- 更新来源固定为 `Ssshake1996/myterm` 官方 Release，不接受任意外部包地址。

## English

Version 0.2.1 removes the hard activation dependency on `sidebarRight` and
`sidebarRightTabs`, so older or non-Web DSH profiles no longer block the whole
Web boot. The right Sidebar attaches when its services become available. The
Sidebar now displays the installed version, checks the official GitHub Release,
and can install the latest package with one click; restart DSH after updating.
