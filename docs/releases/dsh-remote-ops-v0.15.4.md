# dsh-remote-ops v0.15.4

环境抽屉现在按组显示终端和 API 环境。点击组名可单独展开或收起该组，右侧数字显示组内的环境数量。键盘可用 Tab 聚焦组名，用 Enter 或空格切换。

- 分组默认展开。当前 DSH 客户端记住每个组的状态，关闭抽屉、切换工作区或重启后仍可恢复。终端与 API 的同名分组各自保存。
- 搜索会临时展开有匹配项的组。清空搜索后恢复原来的折叠布局。
- 批量选择只包含当前可见的环境。收起分组会清除该组内的选择。

桌面版可在 DSH 插件管理中安装发布附件 `dsh-remote-ops-v0.15.4.tgz`，然后完整退出并重新打开 DSH。打开 Remote Ops 设置的更新页，可核对当前运行和已安装版本。Web profile 可执行：

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.15.4.tgz
```

安装包的 SHA256 见同页附件 `SHA256SUMS-dsh-remote-ops-v0.15.4.txt`。
