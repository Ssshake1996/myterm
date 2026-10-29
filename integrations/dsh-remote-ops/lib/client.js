window.__ModuleLoader__.load({
  id: "@dsh/remote-ops",
  factory: (require) => {
    const React = require("react");
    const icons = require("@deepseek-ai/dsh-client-ui-primitives");
    // DSH 0.2 uses weight-based icon names; older hosts use size-based names.
    const IconStopFill16 = icons.IconStopFillRegular ?? icons.IconStopFill16;
    const IconRefreshOutline16 = icons.IconRefreshOutlineRegular ?? icons.IconRefreshOutline16;
    const IconDownloadOutline16 = icons.IconDownloadOutlineRegular ?? icons.IconDownloadOutline16;
    const IconPanelLeftOutline16 = icons.IconPanelLeftOutlineRegular ?? icons.IconPanelLeftOutline16;
    const IconCopyOutline16 = icons.IconCopyOutlineRegular ?? icons.IconCopyOutline16;
    const IconEditOutline16 = icons.IconEditOutlineRegular ?? icons.IconEditOutline16;
    const IconFolderClose16 = icons.IconFolderCloseRegular ?? icons.IconFolderClose16;
    const IconPlayOutline16 = icons.IconPlayOutlineRegular ?? icons.IconPlayOutline16;
    const IconSearchOutline16 = icons.IconSearchOutlineRegular ?? icons.IconSearchOutline16;
    const IconPlusOutline16 = icons.IconPlusOutlineRegular ?? icons.IconPlusOutline16;
    const IconSettingsOutline16 = icons.IconSettingsOutlineRegular ?? icons.IconSettingsOutline16;
    const IconCloseOutline16 = icons.IconCloseOutlineRegular ?? icons.IconCloseOutline16;
    const IconChevronLeftOutline14 = icons.IconChevronLeftOutlineRegular ?? icons.IconChevronLeftOutline14;
    const IconChevronDownOutline14 = icons.IconChevronDownOutlineRegular ?? icons.IconChevronDownOutline14;
    const IconChevronUpOutline14 = icons.IconChevronUpOutlineRegular ?? icons.IconChevronUpOutline14;
    const { createElement: h, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
    const NS = "dshRemoteOps";
    const TAB_ID = "@dsh/remote-ops";
    const TAB_KIND = "dsh-remote-ops";
    const styleId = "dsh-remote-ops-style";
    if (!document.getElementById(styleId)) { const style = document.createElement("style"); style.id = styleId; document.head.appendChild(style); }
    const remoteOpsStyle = document.getElementById(styleId);
    if (remoteOpsStyle) remoteOpsStyle.textContent = `
        .dsh-remote-ops{height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#182230);font:13px/1.45 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
        .dsh-remote-ops button{border:1px solid var(--dsw-alias-border-l3,#d8dce5);background:var(--dsw-alias-bg-layer-1,#f6f8fa);color:inherit;border-radius:7px;padding:5px 8px;cursor:pointer;font:inherit}.dsh-remote-ops button:hover{background:var(--dsw-alias-interactive-bg-hover,#edf1f5)}.dsh-remote-ops button:disabled{opacity:.5;cursor:default}.dsh-remote-ops input,.dsh-remote-ops textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:6px;padding:6px 7px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit}
        .dsh-remote-ops__head{display:flex;align-items:center;gap:7px;padding:9px 11px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}.dsh-remote-ops__head strong{flex:1;min-width:0}.dsh-remote-ops__headEnv{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#667085)}.dsh-remote-ops__muted{color:var(--dsw-alias-label-tertiary,#98a2b3)}.dsh-remote-ops__error{margin:7px 9px;padding:7px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 36%,transparent);border-radius:7px;color:var(--dsw-alias-state-error-primary,#d92d20);white-space:pre-wrap;overflow:auto;max-height:80px;flex:none}.dsh-remote-ops__launcherError{display:flex;align-items:flex-start;gap:10px;max-width:min(420px,calc(100vw - 32px));margin:16px;padding:12px 12px 12px 14px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 45%,transparent);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-state-error-primary,#d92d20);box-shadow:0 8px 28px rgba(16,24,40,.18)}.dsh-remote-ops__launcherErrorBody{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-remote-ops__launcherErrorClose{flex:none;padding:2px 6px!important;border-color:transparent!important;background:transparent!important;color:inherit!important;font-size:18px!important;line-height:1!important}
        .dsh-remote-ops__workspace{display:flex;position:relative;min-height:0;flex:1;overflow:hidden}
        .dsh-remote-ops__main{display:grid;grid-template-rows:minmax(0,1fr) auto;flex:1;min-width:0;min-height:0;gap:8px;padding:8px;overflow:hidden}.dsh-remote-ops__terminal{display:flex;min-height:0;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 1px 2px rgba(16,24,40,.08)}.dsh-remote-ops__terminalHead{display:flex;align-items:center;gap:6px;padding:7px 8px;background:var(--dsw-alias-bg-layer-1,#f7f9fb);color:var(--dsw-alias-label-primary,#182230);flex:none}.dsh-remote-ops__terminalHead strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__terminalHead small{color:var(--dsw-alias-label-tertiary,#98a2b3)}.dsh-remote-ops__tabs{display:flex;gap:4px;overflow:auto;padding:5px 6px;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb);border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#f7f9fb);flex:none}.dsh-remote-ops__tabs button{padding:3px 7px;border-color:var(--dsw-alias-border-l3,#d8dce5);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#667085);white-space:nowrap;font-size:11px}.dsh-remote-ops__tabs button[data-active=true]{border-color:var(--ro-accent);background:color-mix(in srgb,var(--ro-accent) 11%,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary,#182230)}.dsh-remote-ops__screen{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#fff)}.dsh-remote-ops__output{box-sizing:border-box;position:absolute;inset:0;width:100%;height:100%;min-height:0;overflow-y:scroll;overflow-x:auto;margin:0;padding:10px 12px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-primary,#182230);scrollbar-gutter:stable;scrollbar-width:auto;scrollbar-color:var(--dsw-alias-border-l1,#aeb7c4) var(--dsw-alias-bg-layer-1,#f4f6f8)}.dsh-remote-ops__output::-webkit-scrollbar{width:12px;height:12px}.dsh-remote-ops__output::-webkit-scrollbar-track{background:var(--dsw-alias-bg-layer-1,#f4f6f8)}.dsh-remote-ops__output::-webkit-scrollbar-thumb{min-height:32px;border:3px solid var(--dsw-alias-bg-layer-1,#f4f6f8);border-radius:999px;background:var(--dsw-alias-border-l1,#aeb7c4)}.dsh-remote-ops__inputCapture{position:absolute;inset:0;z-index:2;width:100%;height:100%;margin:0;padding:0;border:0!important;outline:none!important;border-radius:0!important;resize:none;overflow:hidden;background:transparent!important;color:transparent!important;caret-color:transparent!important;opacity:.02;cursor:text;pointer-events:none;user-select:none}.dsh-remote-ops__screenHint{position:absolute;right:20px;bottom:10px;z-index:1;padding:3px 7px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#f7f9fb) 88%,transparent);color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:11px;pointer-events:none}.dsh-remote-ops__empty{display:grid;place-items:center;min-height:150px;padding:20px;text-align:center;color:var(--dsw-alias-label-tertiary,#98a2b3)}
        .dsh-remote-ops__quick{display:flex;flex:1;min-height:0;max-height:none;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#f8fafb)}.dsh-remote-ops__quickHead{display:flex;align-items:center;gap:6px;padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}.dsh-remote-ops__quickHead strong{flex:1}.dsh-remote-ops__quickBody{display:flex;gap:7px;min-height:0;max-height:none;flex:1;padding:7px;overflow:auto}.dsh-remote-ops__quickGroups{display:flex;flex:none;width:88px;flex-direction:column;gap:4px;overflow:auto;padding-right:5px;border-right:1px solid var(--dsw-alias-border-l2,#d8dce5)}.dsh-remote-ops__quickGroups button{text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-color:transparent;background:transparent;padding:5px;font-size:12px}.dsh-remote-ops__quickGroups button[data-active=true]{border-color:color-mix(in srgb,var(--ro-accent) 28%,transparent);background:color-mix(in srgb,var(--ro-accent) 11%,transparent);color:var(--ro-accent);font-weight:600}.dsh-remote-ops__quickItems{display:grid;grid-template-columns:repeat(auto-fill,minmax(115px,1fr));align-content:start;gap:6px;min-width:0;flex:1;overflow:auto}.dsh-remote-ops__quickItem{display:flex;align-items:center;gap:4px;min-width:0;padding:6px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:7px;background:var(--dsw-alias-bg-base,#fff)}.dsh-remote-ops__quickItem span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__tiny{padding:3px 5px!important;font-size:11px!important}.dsh-remote-ops__drawer{left:0;width:min(270px,74%);border-right:1px solid var(--dsw-alias-border-l2,#d8dce5)}.dsh-remote-ops__drawerHead{display:flex;align-items:center;gap:5px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}.dsh-remote-ops__drawerHead strong{flex:1}.dsh-remote-ops__tools{display:flex;gap:5px;margin-bottom:7px}.dsh-remote-ops__tools input{flex:1}.dsh-remote-ops__group{margin-bottom:10px}.dsh-remote-ops__groupTitle{display:flex;align-items:center;gap:4px;padding:3px;color:var(--dsw-alias-label-secondary,#667085);font-weight:650}.dsh-remote-ops__groupTitle span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__env{display:flex;align-items:center;gap:5px;padding:6px 4px;border-radius:7px}.dsh-remote-ops__env:hover{background:var(--dsw-alias-interactive-bg-hover,#edf1f5)}.dsh-remote-ops__dot{width:7px;height:7px;flex:none;border-radius:50%;background:#a5adba}.dsh-remote-ops__dot[data-connected=true]{background:#35a16c;box-shadow:0 0 0 3px rgba(53,161,108,.13)}.dsh-remote-ops__envInfo{flex:1;min-width:0;cursor:pointer}.dsh-remote-ops__envName,.dsh-remote-ops__envMeta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__envName{font-weight:600}.dsh-remote-ops__envMeta{font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3)}.dsh-remote-ops__emptyList{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-tertiary,#98a2b3)}.dsh-remote-ops__card{border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:8px;padding:8px;margin-bottom:7px}.dsh-remote-ops__row{display:flex;align-items:center;gap:6px;min-width:0}.dsh-remote-ops__row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__version{font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3);white-space:nowrap}.dsh-remote-ops__update{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#35a16c) 46%,var(--dsw-alias-border-l3,#d8dce5));color:var(--dsw-alias-state-success-primary,#267c50);white-space:nowrap}.dsh-remote-ops__form{display:flex;flex-direction:column;gap:7px;margin-bottom:9px;padding:9px;border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#f7f9fb)}.dsh-remote-ops__form label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#667085)}.dsh-remote-ops__formActions{display:flex;gap:6px;justify-content:flex-end}.dsh-remote-ops__formNote{font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3)}.dsh-remote-ops__quickDock{display:flex;min-height:72px;max-height:50vh;min-width:0;flex-direction:column}.dsh-remote-ops__quickResize{height:9px;flex:none;display:grid;place-items:center;cursor:ns-resize;color:var(--dsw-alias-label-tertiary,#98a2b3);touch-action:none}.dsh-remote-ops__quickResize::before{content:"";width:38px;height:3px;border-radius:999px;background:var(--dsw-alias-border-l2,#c9d0db);transition:width .16s ease,background .16s ease}.dsh-remote-ops__quickResize:hover::before{width:54px;background:var(--ro-accent)}.dsh-remote-ops__headNotice{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-state-success-primary,#267c50)}.dsh-remote-ops__headNotice[data-error=true]{color:var(--dsw-alias-state-error-primary,#d92d20)}.dsh-remote-ops__launchControl{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:36px;padding:8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#182230);font:inherit;cursor:pointer}.dsh-remote-ops__launchControl[data-wide=true]{justify-content:flex-start;text-align:start;padding-inline:10px}.dsh-remote-ops__launchControl:hover{background:var(--dsw-alias-interactive-bg-hover,#edf1f5)}.dsh-remote-ops__launchControl:focus-visible{outline:2px solid var(--ro-accent);outline-offset:-2px}.dsh-remote-ops__launchControl svg{flex:none}.dsh-remote-ops__error{display:flex;align-items:flex-start;gap:8px}.dsh-remote-ops__errorBody{flex:1;min-width:0;max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-remote-ops__errorClose{flex:none;padding:2px 6px!important;border-color:transparent!important;background:transparent!important;color:inherit!important;font-size:16px!important;line-height:1}.dsh-remote-ops__errorClose:hover{background:color-mix(in srgb,currentColor 10%,transparent)!important}.dsh-remote-ops__screenEmpty{cursor:text}.dsh-remote-ops__pendingCommand{margin:12px 0 0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#f7f9fb);color:var(--dsw-alias-label-primary,#182230);font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left}

.dsh-remote-ops__head{flex-wrap:wrap}.dsh-remote-ops__headAction{min-height:36px!important;padding:7px 10px!important;font-size:12px!important;font-weight:650!important;white-space:nowrap}.dsh-remote-ops__drawerClose{min-width:36px;min-height:36px;padding:5px 9px!important;border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 52%,transparent)!important;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 10%,var(--dsw-alias-bg-base,#fff))!important;color:var(--dsw-alias-state-error-primary,#d92d20)!important;font-size:20px!important;font-weight:700!important;line-height:1!important}.dsh-remote-ops__drawerClose:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 18%,var(--dsw-alias-bg-base,#fff))!important}
.dsh-remote-ops__inputCursor{display:inline-block;width:2px;height:1.15em;vertical-align:-.18em;background:var(--ro-accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--ro-accent) 18%,transparent);animation:dsh-remote-ops-caret 1s steps(1,end) infinite;pointer-events:none}@keyframes dsh-remote-ops-caret{0%,45%{opacity:1}46%,100%{opacity:0}}
.dsh-remote-ops__formAdvanced{padding:6px 8px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:6px}.dsh-remote-ops__formAdvanced summary{cursor:pointer;font-weight:600;font-size:12px}.dsh-remote-ops__formAdvancedBody{display:flex;flex-direction:column;gap:7px;margin-top:7px}
.dsh-remote-ops__main[data-module=sftp]{display:flex;padding:0;gap:0}.dsh-remote-ops__tab{display:flex;align-items:stretch;flex:none}.dsh-remote-ops__tab>button:first-child{border-radius:7px 0 0 7px}.dsh-remote-ops__tabClose{border-left:0!important;border-radius:0 7px 7px 0!important;padding:3px 6px!important}.dsh-remote-ops__dangerAction{color:var(--dsw-alias-state-error-primary,#d92d20)!important}.dsh-remote-ops__env{flex-wrap:wrap}.dsh-remote-ops__envConnections{width:100%;display:flex;flex-direction:column;gap:3px;margin:2px 0 0 13px;padding-left:7px;border-left:2px solid color-mix(in srgb,var(--ro-accent) 22%,transparent)}.dsh-remote-ops__envConnection{display:flex;align-items:center;gap:5px;min-width:0}.dsh-remote-ops__connectionLink{flex:1;min-width:0;padding:2px 4px!important;border:0!important;background:transparent!important;text-align:left;font-size:11px!important;color:var(--dsw-alias-label-secondary,#667085)!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__sftpWorkspace{display:flex;min-width:0;min-height:0;flex:1;flex-direction:column;background:var(--dsw-alias-bg-base,#fff)}.dsh-remote-ops__sftpHead{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}.dsh-remote-ops__sftpHead strong{flex:none}.dsh-remote-ops__sftpHead select{min-width:170px;max-width:260px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit}.dsh-remote-ops__sftpHead .dsh-remote-ops__muted{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__sftpSplit{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:0;flex:1}.dsh-remote-ops__sftpPane{display:flex;min-width:0;min-height:0;flex-direction:column}.dsh-remote-ops__sftpPane+ .dsh-remote-ops__sftpPane{border-left:1px solid var(--dsw-alias-border-l2,#d8dce5)}.dsh-remote-ops__sftpPaneHead{display:flex;align-items:center;gap:5px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}.dsh-remote-ops__sftpPaneHead strong{flex:1}.dsh-remote-ops__sftpPath{padding:8px;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb);flex:none}.dsh-remote-ops__sftpEntries{min-height:0;flex:1;overflow:auto;padding:7px}.dsh-remote-ops__sftpEntry{display:flex;align-items:center;gap:6px;padding:6px 5px;border-bottom:1px solid var(--dsw-alias-border-l3,#eef0f3)}.dsh-remote-ops__sftpEntry:hover{background:var(--dsw-alias-interactive-bg-hover,#edf1f5)}.dsh-remote-ops__sftpName{display:flex;align-items:center;gap:6px;flex:1;min-width:0;border:0!important;background:transparent!important;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__sftpLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__sftpIcon{display:inline-grid;place-items:center;width:18px;flex:none;font-size:15px;font-weight:700;line-height:1}.dsh-remote-ops__sftpIcon[data-type=directory]{color:#c78100}.dsh-remote-ops__sftpIcon[data-type=file]{color:#3e72c4}.dsh-remote-ops__sftpSize{width:70px;text-align:right;color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:11px}.dsh-remote-ops__sftpEmpty{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-tertiary,#98a2b3)}@media (max-width:720px){.dsh-remote-ops__sftpSplit{grid-template-columns:1fr;grid-template-rows:minmax(220px,1fr) minmax(220px,1fr)}.dsh-remote-ops__sftpPane+ .dsh-remote-ops__sftpPane{border-left:0;border-top:1px solid var(--dsw-alias-border-l2,#d8dce5)}.dsh-remote-ops__sftpHead{flex-wrap:wrap}.dsh-remote-ops__sftpHead .dsh-remote-ops__muted{flex-basis:100%;order:3}}

      .dsh-remote-ops__main{padding:0;gap:0}
      .dsh-remote-ops__terminal{border:0;border-radius:0;box-shadow:none}
      .dsh-remote-ops__head{padding:6px 10px;gap:8px}
      .dsh-remote-ops__headAction{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;min-width:36px;flex:none;padding:8px!important;border-radius:6px!important}
      .dsh-remote-ops__headAction svg{width:18px;height:18px}
      .dsh-remote-ops__headAction[aria-expanded=true]{background:color-mix(in srgb,var(--ro-accent) 12%,transparent);border-color:var(--ro-accent)}
      .dsh-remote-ops__headAction[aria-busy=true]{opacity:.5}
      .dsh-remote-ops__headNotice{flex-basis:100%;max-width:none;white-space:normal;overflow-wrap:anywhere}
      .dsh-remote-ops__terminalHead{padding:8px 10px;gap:8px}
      .dsh-remote-ops__terminalIdentity{display:flex;flex-direction:column;flex:1;min-width:0;gap:2px}
      .dsh-remote-ops__terminalIdentity strong,.dsh-remote-ops__terminalIdentity small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-remote-ops__terminalIdentity small{font:11px/1.5 ui-monospace,Consolas,monospace}
      .dsh-remote-ops__tabs{gap:6px;padding:5px 10px}
      .dsh-remote-ops__tabs button{min-height:30px}
      .dsh-remote-ops__output{font-size:13px;line-height:1.55;outline:none}
      .dsh-remote-ops__screen[data-focused=false] .dsh-remote-ops__inputCursor{animation:none;opacity:.35}
      .dsh-remote-ops__terminalStatus{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:5px 10px;min-height:22px;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb);font-size:11px;color:var(--dsw-alias-label-secondary,#667085);flex:none}
      .dsh-remote-ops__terminalStatus [data-state=connected]{color:var(--dsw-alias-state-success-primary,#267c50)}
      .dsh-remote-ops__terminalStatus [data-state=retrying]{color:var(--dsw-alias-state-error-primary,#d92d20)}
      .dsh-remote-ops__sessionIdentity{font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere}
      .dsh-remote-ops__newOutput{position:absolute;right:24px;bottom:12px;z-index:3;min-height:32px!important;border-color:var(--ro-accent)!important;background:var(--dsw-alias-bg-base,#fff)!important;box-shadow:0 2px 6px #0002}
      .dsh-remote-ops__quick{border:0;border-top:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:0}
      .dsh-remote-ops__quickDock{min-width:0}
      .dsh-remote-ops__quickHead{flex-wrap:wrap}
      .dsh-remote-ops button:focus-visible{outline:2px solid var(--ro-accent);outline-offset:-2px}
      @media(prefers-reduced-motion:reduce){.dsh-remote-ops__inputCursor{animation:none}}


      .dsh-remote-ops{position:relative;container-type:inline-size;letter-spacing:0}
      .dsh-remote-ops__quickHead strong{flex:none;white-space:nowrap}.dsh-remote-ops__quickHead select{max-width:160px}.dsh-remote-ops__modal button{overflow-wrap:anywhere}
      .dsh-remote-ops select{min-width:0;max-width:100%;padding:5px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:5px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit}
      .dsh-remote-ops input[type=checkbox]{width:16px;height:16px;flex:none}
      .dsh-remote-ops__toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l3,#d8dce5);flex:none}
      .dsh-remote-ops__toolbar button{display:inline-flex;align-items:center;justify-content:center;min-width:30px;min-height:30px}
      .dsh-remote-ops__toolbar input[type=number]{width:55px}.dsh-remote-ops__toolbar label{display:flex;align-items:center;gap:3px}
      .dsh-remote-ops__search{flex:1;min-width:110px!important;max-width:260px}.dsh-remote-ops__output [data-match=true]{background:#e6b82240}
      .dsh-remote-ops__modalBackdrop{position:absolute;inset:0;z-index:8;background:#0005;display:flex;align-items:center;justify-content:center;padding:12px}
      .dsh-remote-ops__modal{box-sizing:border-box;width:100%;max-width:520px;max-height:100%;overflow:auto;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:0 12px 36px #0003}
      .dsh-remote-ops__modal label{display:flex;flex-direction:column;gap:4px}.dsh-remote-ops__modal textarea{min-height:150px;font-family:Consolas,monospace;resize:vertical}.dsh-remote-ops__modal pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
      .dsh-remote-ops__sftpPaneHead{flex-wrap:wrap}.dsh-remote-ops__sftpPaneHead select{flex:1;max-width:100%}.dsh-remote-ops__sftpPath{display:flex;gap:4px}.dsh-remote-ops__sftpPath input{min-width:0}
      .dsh-remote-ops__sftpEntry[data-selected=true]{background:color-mix(in srgb,var(--ro-accent) 10%,transparent)}
      .dsh-remote-ops__transfers{flex:none;max-height:28%;min-height:30px;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2,#d8dce5);padding:6px 8px}
      .dsh-remote-ops__transfer{display:flex;align-items:center;gap:6px;padding:5px 0;flex-wrap:wrap}.dsh-remote-ops__transfer span{flex:1;min-width:0;overflow-wrap:anywhere}.dsh-remote-ops__transfer small{width:100%;overflow-wrap:anywhere}
      .dsh-remote-ops__error{max-height:210px}.dsh-remote-ops__errorBody details{font:11px/1.4 Consolas,monospace}.dsh-remote-ops__errorBody summary{cursor:pointer}
      .dsh-remote-ops__transfer>details{width:100%}.dsh-remote-ops__transfer pre,.dsh-remote-ops__fileError{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 Consolas,monospace}
      .dsh-remote-ops__tab>button:first-child{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-remote-ops__sftpPaneHead select{flex-basis:90px}.dsh-remote-ops__sftpPaneHead button[aria-pressed=true]{color:#c78100}
      @container(max-width:600px){.dsh-remote-ops__sftpSplit{grid-template-columns:1fr;grid-template-rows:repeat(2,minmax(340px,1fr));overflow-y:auto}.dsh-remote-ops__sftpPane+.dsh-remote-ops__sftpPane{border-left:0;border-top:1px solid var(--dsw-alias-border-l2,#d8dce5)}.dsh-remote-ops__quickItems{grid-template-columns:1fr}.dsh-remote-ops__sftpSize{width:50px}}


      .dsh-remote-ops__quickDock{min-height:0;max-height:none;overflow:hidden;background:var(--dsw-alias-bg-base,#fff)}
      .dsh-remote-ops__quickResize{height:12px;border-top:1px solid var(--dsw-alias-border-l2,#d8dce5);outline-offset:-2px}
      .dsh-remote-ops__quickHead{flex-wrap:nowrap;padding:3px 8px;border:0;min-height:36px;box-sizing:border-box}
      .dsh-remote-ops__quickIdentity{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;overflow:hidden}
      .dsh-remote-ops__quickIdentity small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#667085)}
      .dsh-remote-ops__quickIcon{display:inline-grid!important;place-items:center;width:30px;height:30px;flex:none;padding:5px!important}
      .dsh-remote-ops__quickFilters{display:flex;gap:6px;padding:4px 8px 8px;flex:none}
      .dsh-remote-ops__quickFilters input{flex:1;min-width:0}.dsh-remote-ops__quickFilters select{max-width:35%}
      .dsh-remote-ops__quickButtons{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(138px,100%),1fr));grid-auto-rows:44px;align-content:start;gap:6px;padding:0 8px 8px;overflow:auto;min-height:0;flex:1;scrollbar-gutter:stable}
      .dsh-remote-ops__quickButtons button{display:flex;align-items:center;gap:6px;min-width:0;border-radius:5px;padding:4px 8px;text-align:left}
      .dsh-remote-ops__quickButtons svg{flex:none;color:var(--dsw-alias-state-success-primary,#267c50)}
      .dsh-remote-ops__quickButtons span{overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere;font-size:12px;line-height:16px}
      .dsh-remote-ops__quickReceipt{margin:0;padding:4px 8px;border-top:1px solid var(--dsw-alias-border-l3,#d8dce5);font-size:11px;max-height:72px;flex:none;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
      .dsh-remote-ops__quickLibrary{min-height:0;overflow:auto;max-height:42vh}.dsh-remote-ops__quickLibraryRow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l3,#d8dce5)}
      .dsh-remote-ops__quickLibraryRow>span{flex:1;min-width:110px;overflow-wrap:anywhere}.dsh-remote-ops__quickLibraryRow small{display:block;color:var(--dsw-alias-label-secondary,#667085)}
      .dsh-remote-ops__quickForm{display:flex;flex-direction:column;gap:10px}.dsh-remote-ops__quickCheck{flex-direction:row!important;align-items:center}
      .dsh-remote-ops__quickModalHead{display:flex;align-items:center;gap:8px}.dsh-remote-ops__quickModalHead strong{flex:1;min-width:0}
      .dsh-remote-ops__quickEmpty{grid-column:1/-1;font-size:12px;color:var(--dsw-alias-label-secondary,#667085);padding:8px 0}


      .dsh-remote-ops__main[data-module=browser]{display:flex;min-height:0}
      .dsh-remote-ops__web{flex:1;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;background:var(--dsw-alias-bg-base,#fff);font-size:12px;line-height:1.6;scrollbar-gutter:stable}
      .dsh-remote-ops__webSection{display:flex;flex-direction:column;gap:9px;padding:14px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);min-width:0;overflow-wrap:anywhere}
      .dsh-remote-ops__webSection p{margin:0}.dsh-remote-ops__web label{display:flex;flex-direction:column;gap:4px;min-width:0}
      .dsh-remote-ops__web input,.dsh-remote-ops__web select{width:100%;box-sizing:border-box;min-width:0;min-height:32px}
      .dsh-remote-ops__webActions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.dsh-remote-ops__webActions strong{margin-right:auto}
      .dsh-remote-ops__web button{min-height:32px;white-space:normal;overflow-wrap:anywhere}.dsh-remote-ops__webActions select{width:auto;max-width:110px}
      .dsh-remote-ops__webTarget{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;padding:7px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:5px;min-width:0}
      .dsh-remote-ops__webTarget>select{width:100px}.dsh-remote-ops__webTarget>input{flex:1;min-width:100px}.dsh-remote-ops__webTarget>label,.dsh-remote-ops__webTarget>details{flex-basis:100%;min-width:0}
      .dsh-remote-ops__webStep{display:flex;flex-direction:column;gap:5px;border-left:2px solid var(--dsw-alias-border-l2,#d8dce5);padding:10px;margin:10px 0}
      .dsh-remote-ops__web summary{cursor:pointer;padding:5px 0;outline-offset:2px}.dsh-remote-ops__web details>button{margin:4px 4px 4px 0}
      .dsh-remote-ops__webCheck{flex-direction:row!important;align-items:center}.dsh-remote-ops__webCheck input{width:16px!important;min-height:16px}
      .dsh-remote-ops__webResult{padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__web pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto;font:11px/1.6 ui-monospace,Consolas,monospace;margin:6px 0}
      .dsh-remote-ops__web img{display:block;width:100%;height:auto;border:1px solid var(--dsw-alias-border-l3,#d8dce5);box-sizing:border-box}
      .dsh-remote-ops__web :is(input,select,summary):focus-visible{outline:2px solid var(--ro-accent);outline-offset:1px}


      .dsh-remote-ops__main[data-module=browser]{display:flex;padding:0;gap:0}
      .dsh-remote-ops__webBrowser{display:flex;flex-direction:column;gap:0;min-width:0}
      .dsh-remote-ops__webBar{display:flex;align-items:center;gap:8px;padding:9px 12px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__webBar>label{margin-left:auto;display:flex;flex-direction:row;align-items:center;gap:6px}.dsh-remote-ops__webBar select,.dsh-remote-ops__liveTools select{width:auto;flex:none;min-width:82px}
      .dsh-remote-ops__webAddress{display:flex;gap:4px;padding:8px;flex:none;min-width:0;align-items:center}
      .dsh-remote-ops__webAddress input{min-width:0;flex:1;width:0}.dsh-remote-ops__webAddress button{flex:none;min-width:30px;min-height:32px;padding:4px 7px}
      .dsh-remote-ops__webPages{display:flex;gap:3px;overflow-x:auto;padding:5px 8px;flex:none}
      .dsh-remote-ops__webPages button{flex:none;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-remote-ops__webPages button[aria-selected=true]{border-color:var(--ro-accent);color:var(--ro-accent)}
      .dsh-remote-ops__webState{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;padding:6px 12px;flex:none;font-size:12px}
      .dsh-remote-ops__webNotice,.dsh-remote-ops__webError{padding:6px 12px;flex:none;overflow-wrap:anywhere}.dsh-remote-ops__webNotice{color:var(--dsw-alias-label-secondary,#667085)}.dsh-remote-ops__webError{color:var(--dsw-alias-state-error-primary,#d92d20)}
      .dsh-remote-ops__webPage{display:flex;flex:1;min-height:240px;min-width:0;overflow:hidden}.dsh-remote-ops__live{display:flex;flex:1;min-height:240px;flex-direction:column;min-width:0;overflow:hidden;border-block:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__liveTools{display:flex;gap:8px;align-items:center;padding:4px 8px;flex:none;font-size:11px;color:var(--dsw-alias-label-secondary,#667085)}.dsh-remote-ops__liveTools>span{flex:1;min-width:0;overflow-wrap:anywhere}
      .dsh-remote-ops__liveSurface{flex:1;min-height:0;position:relative;overflow:auto;background:var(--dsw-alias-bg-layer-1,#f7f9fb)}.dsh-remote-ops__liveSurface:focus-within{outline:2px solid var(--ro-accent);outline-offset:-2px}
      .dsh-remote-ops__liveSurface img{display:block;user-select:none;cursor:default;height:auto;margin:0}
      .dsh-remote-ops__webCapture{position:absolute!important;left:1px;top:1px;width:1px!important;height:1px!important;min-height:0!important;padding:0!important;border:0!important;opacity:.01;resize:none}
      .dsh-remote-ops__webWelcome,.dsh-remote-ops__webWindow{flex:1;min-height:180px;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:20px;color:var(--dsw-alias-label-secondary,#667085)}
      .dsh-remote-ops__webLog,.dsh-remote-ops__webSettings{flex:none;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb)}.dsh-remote-ops__webLog[open]{max-height:35%;overflow:auto}.dsh-remote-ops__webLog summary,.dsh-remote-ops__webSettings summary{cursor:pointer}
      .dsh-remote-ops__webSettings>label{display:flex;align-items:center;gap:7px;margin-block:7px}.dsh-remote-ops__webSettings>small{display:block;margin-block:5px}.dsh-remote-ops__webSettings>.dsh-remote-ops__web{display:block;max-height:520px;overflow:auto}
      @container(max-width:420px){.dsh-remote-ops__webAddress{flex-wrap:wrap}.dsh-remote-ops__webAddress input{flex-basis:180px}.dsh-remote-ops__webAddress button[type=submit]{margin-left:auto}.dsh-remote-ops__webState .dsh-remote-ops__muted{flex-basis:100%}}


      .dsh-remote-ops{position:relative;container-type:inline-size;font-size:13px;line-height:1.5;--ro-bg:var(--dsw-alias-bg-base,#fff);--ro-soft:var(--dsw-alias-bg-layer-1,#f6f7f9);--ro-text:var(--dsw-alias-label-primary,#20242c);--ro-muted:var(--dsw-alias-label-secondary,#667085);--ro-border:var(--dsw-alias-border-l3,#e7e9ee);--ro-brand:#3e60d9;--ro-accent:color-mix(in srgb,var(--dsw-alias-link,#4176e6) 90%,var(--ro-text));--ro-control:34px;--ro-space:12px;--ro-row:42px}
      .dsh-remote-ops [hidden]{display:none!important}
      .dsh-remote-ops button{min-height:var(--ro-control);border-radius:7px;display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:5px 8px;font-weight:400}
      .dsh-remote-ops :is(input,textarea,select){max-width:100%;min-width:0;min-height:var(--ro-control);border-radius:7px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit;box-sizing:border-box}
      .dsh-remote-ops select{padding:4px 6px}.dsh-remote-ops input:is([type=checkbox],[type=radio]){width:16px;min-height:16px;flex:none}
      .dsh-remote-ops :is(button,input,select,textarea,summary):focus-visible{outline:2px solid var(--ro-accent);outline-offset:2px}
      .dsh-remote-ops :is(small,.dsh-remote-ops__version,.dsh-remote-ops__formNote){font-size:12px}
      .dsh-remote-ops__muted{color:var(--dsw-alias-label-secondary,#667085)}
      .dsh-remote-ops .dsh-remote-ops__primary{background:var(--ro-brand);border-color:transparent;color:#fff}
      .dsh-remote-ops__head{padding:8px 14px;gap:8px;min-height:50px;border-bottom:0;position:relative;z-index:20;flex-wrap:nowrap}
      .dsh-remote-ops__headAction{width:auto!important;min-width:32px;height:32px;padding:5px 7px!important;border-color:transparent!important;background:transparent!important;white-space:nowrap}
      .dsh-remote-ops__head strong{font-size:14px;font-weight:600}.dsh-remote-ops__version{padding:6px 8px}
      .dsh-remote-ops__menu{position:relative;flex:none}.dsh-remote-ops__menu>summary{display:flex;align-items:center;justify-content:center;width:32px;min-height:32px;cursor:pointer;list-style:none;border-radius:6px}
      .dsh-remote-ops__menu>summary::-webkit-details-marker{display:none}.dsh-remote-ops__menu[open]>summary{background:var(--dsw-alias-interactive-bg-hover,#edf1f5)}
      .dsh-remote-ops__menu>div{position:absolute;right:0;top:calc(100% + 5px);min-width:170px;padding:5px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 6px 20px #0002;display:flex;flex-direction:column;z-index:30}
      .dsh-remote-ops__menu>div>button{justify-content:flex-start;border-color:transparent;background:transparent}
      .dsh-remote-ops__notice{padding:5px 12px;font-size:12px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb);overflow-wrap:anywhere}
      .dsh-remote-ops__notice[data-error=true]{color:var(--dsw-alias-state-error-primary,#d92d20)}
      .dsh-remote-ops__workspaceTabs{display:flex;justify-content:flex-start;gap:4px;flex:none;min-width:0;overflow-x:auto;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__workspaceTabs>button{flex:0 0 auto;gap:5px;min-width:88px;white-space:nowrap;flex-wrap:nowrap;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;padding:9px 14px;color:var(--dsw-alias-label-secondary,#667085);font-size:13px}
      .dsh-remote-ops__workspaceTabs>button[aria-selected=true]{background:transparent;border-bottom-color:var(--ro-accent);color:var(--ro-accent)}
      .dsh-remote-ops__workspace{position:relative;display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}
      .dsh-remote-ops__main{display:flex!important;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden;padding:0!important;gap:0!important}
      .dsh-remote-ops__terminal{flex:1;border:0;border-radius:0;box-shadow:none;min-height:120px}
      .dsh-remote-ops__terminalHead{padding:5px 10px;background:var(--ro-soft);min-height:44px;flex-wrap:wrap;border-bottom:1px solid var(--ro-border)}
      .dsh-remote-ops__terminalIdentity{min-width:110px;display:flex;flex:1;flex-direction:row;align-items:center;justify-content:flex-start;text-align:left;flex-wrap:wrap;gap:4px 12px}
      .dsh-remote-ops__terminalHead{justify-content:flex-start;text-align:left}.dsh-remote-ops__terminalHead>.dsh-remote-ops__toolbar{border:0;padding:0;flex:0 0 auto;min-height:0;margin-left:auto}.dsh-remote-ops__terminalIdentity strong{flex:none}
      .dsh-remote-ops__terminalIdentity small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#667085)}
      .dsh-remote-ops__tabs{background:transparent;padding:4px 8px;gap:4px}
      .dsh-remote-ops__tabs button{font-size:12px;min-height:30px;border-color:transparent;background:transparent}
      .dsh-remote-ops__tab>button[data-active=true]{background:var(--dsw-alias-bg-layer-1,#f6f8fa);border-color:var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__toolbar{gap:6px;padding:5px 10px;min-height:36px;flex:none}
      .dsh-remote-ops__terminal>.dsh-remote-ops__toolbar{border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__toolbar>button{border-color:transparent;background:transparent}.dsh-remote-ops__toolbar>label{font-size:12px}
      .dsh-remote-ops__terminalLook{margin-left:auto;position:relative;flex:none}.dsh-remote-ops__terminalLook>summary{list-style:none;display:flex;align-items:center;justify-content:center;min-height:32px;min-width:32px;cursor:pointer}
      .dsh-remote-ops__terminalLook>div{position:absolute;top:100%;right:0;width:190px;padding:12px;z-index:15;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:7px;box-shadow:0 5px 16px #0002;display:grid;gap:10px}
      .dsh-remote-ops__terminalLook label{display:flex;align-items:center;gap:8px}.dsh-remote-ops__terminalLook input[type=number]{width:72px}.dsh-remote-ops__terminalLook select{width:auto}
      .dsh-remote-ops__terminalStatus{padding:6px 12px;font-size:12px;gap:4px 10px;min-height:32px;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__statusDetails{margin-left:auto;position:relative;color:var(--dsw-alias-label-secondary,#667085)}
      .dsh-remote-ops__statusDetails>summary{cursor:pointer}.dsh-remote-ops__statusDetails>div{position:absolute;bottom:calc(100% + 8px);right:0;z-index:10;width:min(300px,calc(100cqw - 30px));padding:12px;display:grid;gap:6px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:7px;box-shadow:0 4px 16px #0002;overflow-wrap:anywhere}
      .dsh-remote-ops__quickDock{flex:none;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb);border-radius:0;background:var(--dsw-alias-bg-base,#fff)}
      .dsh-remote-ops__quickHead{padding:6px 10px;border-bottom:0;gap:6px}.dsh-remote-ops__quickHead strong{font-weight:500}
      .dsh-remote-ops__quickFilters{padding:4px 12px 8px;gap:6px}.dsh-remote-ops__quickFilters select{max-width:125px}
      .dsh-remote-ops__quickButtons{padding:2px 12px 12px;gap:6px}.dsh-remote-ops__quickButtons>button{border-color:var(--dsw-alias-border-l3,#e5e7eb);font-size:12px;min-height:32px}
      .dsh-remote-ops__quickIcon{min-width:30px;width:30px;min-height:30px!important;border-color:transparent!important;background:transparent!important}
      .dsh-remote-ops__quickLibraryRow{padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__drawer,.dsh-remote-ops__utilityView{position:static!important;inset:auto!important;width:100%!important;max-width:none!important;height:100%;min-height:0;display:flex;flex:1;flex-direction:column;border:0!important;border-radius:0!important;box-shadow:none!important;background:var(--dsw-alias-bg-base,#fff)}
      .dsh-remote-ops__drawerHead{padding:10px 14px;min-height:48px;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb);gap:6px}
      .dsh-remote-ops__drawerHead strong{margin-right:auto;font-weight:500}.dsh-remote-ops__drawerBody{padding:16px;overflow:auto;flex:1;min-height:0}
      .dsh-remote-ops .dsh-remote-ops__drawerClose{width:30px;min-height:30px;padding:4px;border-color:transparent!important;background:transparent!important;color:var(--dsw-alias-label-secondary,#667085)!important}
      .dsh-remote-ops__group{border:0;margin:8px 0 14px;border-radius:0}.dsh-remote-ops__groupTitle{padding:4px 0;background:transparent;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__env{padding:14px 4px;border-radius:0;border:0;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__envConnections{padding-top:6px}.dsh-remote-ops__envConnection{font-size:12px}.dsh-remote-ops__connectionLink{font-size:12px!important}
      .dsh-remote-ops__form{padding:0;gap:16px;border:0;background:transparent;box-shadow:none}.dsh-remote-ops__form label{gap:7px;font-size:13px;align-items:stretch;text-align:left}.dsh-remote-ops__formNote{color:var(--dsw-alias-label-secondary,#667085)}
      .dsh-remote-ops__formAdvanced{padding:8px 0;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb);border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__modalBackdrop{position:absolute;inset:0;z-index:70;padding:12px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-label-primary,#182230) 16%,transparent)}
      .dsh-remote-ops__modal{box-sizing:border-box;width:100%;max-width:600px;max-height:100%;min-width:0;overflow:auto;padding:18px;border-radius:10px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);background:var(--dsw-alias-bg-base,#fff);box-shadow:0 8px 24px #0002;display:flex;flex-direction:column;gap:10px}
      .dsh-remote-ops__quickModalHead{display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__quickModalHead>strong{flex:1;font-weight:500}.dsh-remote-ops__modal form{display:flex;flex-direction:column;gap:10px}.dsh-remote-ops__modal textarea{min-height:100px;resize:vertical}
      .dsh-remote-ops__modal :is(pre,p){margin:0;overflow-wrap:anywhere}.dsh-remote-ops__modal pre{white-space:pre-wrap;max-height:280px;overflow:auto;font:12px/1.6 ui-monospace,Consolas,monospace}
      .dsh-remote-ops__modal .dsh-remote-ops__toolbar{padding:0}.dsh-remote-ops__modal .dsh-remote-ops__toolbar label{display:flex;align-items:center;gap:7px}.dsh-remote-ops__modal .dsh-remote-ops__toolbar input{width:80px}
      .dsh-remote-ops__updateVersions{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:8px}.dsh-remote-ops__updateVersions>span{display:flex;flex-direction:column;gap:4px;color:var(--dsw-alias-label-secondary,#657083)}.dsh-remote-ops__updateVersions strong{font:600 18px/1.4 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-primary,#182230)}
      .dsh-remote-ops__resultTabs{display:flex;gap:5px;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}.dsh-remote-ops__resultTabs>button{background:transparent;border-color:transparent}.dsh-remote-ops__resultTabs>button[aria-selected=true]{color:var(--ro-accent)}
      .dsh-remote-ops__diagnostics{flex:1;min-height:0;display:flex;flex-direction:column}.dsh-remote-ops__diagnosticEvents{flex:1;min-height:0;overflow:auto;padding:8px 12px}
      .dsh-remote-ops__diagnosticEvents>details{padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}.dsh-remote-ops__diagnosticEvents summary{cursor:pointer;overflow-wrap:anywhere}.dsh-remote-ops__diagnosticEvents time{float:right;font-size:12px;color:var(--dsw-alias-label-secondary,#667085)}
      .dsh-remote-ops__diagnosticEvents pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,Consolas,monospace}
      .dsh-remote-ops__sftpWorkspace{flex:1;display:flex;flex-direction:column;min-height:0;gap:0;padding:0;overflow:auto;border:0;border-radius:0}
      .dsh-remote-ops__fileHost{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;overflow:hidden}
      .dsh-remote-ops__sftpHead{padding:4px 12px;min-height:34px}.dsh-remote-ops__sftpHead strong{font-weight:500}
      .dsh-remote-ops__sftpSplit{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);flex:1;min-height:220px;gap:0;overflow:hidden}
      .dsh-remote-ops__sftpPane{border:0;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb);border-radius:0;min-height:220px}.dsh-remote-ops__sftpPane+section{border-left:1px solid var(--dsw-alias-border-l3,#e5e7eb)}
      .dsh-remote-ops__sftpPaneHead{padding:7px 8px;gap:4px;background:transparent}.dsh-remote-ops__sftpPaneHead select{font-size:12px;max-width:150px}.dsh-remote-ops__sftpPaneHead>button{border-color:transparent;background:transparent;min-width:28px}
      .dsh-remote-ops__sftpPath{padding:4px 8px;gap:4px}.dsh-remote-ops__sftpPath input{font-size:12px}
      .dsh-remote-ops__fileFilter{display:flex;align-items:center;gap:8px;padding:4px 8px 8px;min-width:0}.dsh-remote-ops__fileFilter>input{flex:1;width:0;font-size:12px}.dsh-remote-ops__fileFilter>label{display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap}.dsh-remote-ops__fileFilter>small{white-space:nowrap}
      .dsh-remote-ops__sftpEntries{min-height:100px;flex:1;padding:0 8px}.dsh-remote-ops__sftpEntry{padding:5px 6px;min-height:var(--ro-row);border:0;border-radius:6px;gap:8px}.dsh-remote-ops__sftpEntry:hover{background:var(--ro-soft)}.dsh-remote-ops__sftpEntry[data-selected=true]{background:color-mix(in srgb,var(--ro-accent) 10%,var(--ro-bg))}.dsh-remote-ops__sftpEntry[data-selected=true]:hover{background:color-mix(in srgb,var(--ro-accent) 16%,var(--ro-bg))}
      .dsh-remote-ops__sftpName{min-width:0;border:0!important;background:transparent!important;justify-content:flex-start!important;padding:4px!important;font-size:13px!important}.dsh-remote-ops__sftpSize{font-size:12px;color:var(--dsw-alias-label-secondary,#667085)}
      .dsh-remote-ops__sftpPane>.dsh-remote-ops__toolbar{border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb);align-items:flex-start}.dsh-remote-ops__sftpPane>.dsh-remote-ops__toolbar>label{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}.dsh-remote-ops__sftpPane input[type=file]{font-size:12px;width:100%;padding:3px}
      .dsh-remote-ops__fileError{padding:6px 8px;display:flex;gap:6px;align-items:center;font-size:12px;overflow-wrap:anywhere}
      .dsh-remote-ops__fileTime{font-size:12px;white-space:nowrap;color:var(--dsw-alias-label-secondary,#667085)}.dsh-remote-ops__fileActions{flex-wrap:wrap;justify-content:flex-start}.dsh-remote-ops__fileActions>button{overflow-wrap:anywhere;max-width:100%}.dsh-remote-ops__sftpIcon{color:var(--dsw-alias-label-secondary,#667085)!important}
      .dsh-remote-ops__fileSides{display:none;padding:4px 8px;gap:6px}.dsh-remote-ops__fileSides>button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1,#f6f8fa);color:var(--ro-accent)}
      .dsh-remote-ops__transfers{flex:none;max-height:30%;min-height:32px;padding:8px 12px;overflow:auto;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb);font-size:12px}.dsh-remote-ops__transfer{padding:5px 0;gap:6px;overflow-wrap:anywhere}
      .dsh-remote-ops__transferHistory>summary{cursor:pointer;padding:4px 0;color:var(--dsw-alias-label-secondary,#667085)}
      .dsh-remote-ops__webBrowser{flex:1;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base,#fff)}
      .dsh-remote-ops__webBar{padding:6px 10px;min-height:36px;border:0}.dsh-remote-ops__webBar>span,.dsh-remote-ops__webBar>select{min-width:0;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
      .dsh-remote-ops__webDisplayWarning{font-size:12px;padding:0 10px 5px;color:var(--dsw-alias-label-secondary,#667085);flex:none;overflow-wrap:anywhere}
      .dsh-remote-ops__webPagesBar{display:flex;align-items:center;gap:3px;padding-right:8px;flex:none;min-width:0;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb)}.dsh-remote-ops__webPagesBar>button{min-width:28px;border-color:transparent;background:transparent}
      .dsh-remote-ops__webPages{flex:1;min-width:0;padding:4px 8px;gap:4px}.dsh-remote-ops__webPages button{min-height:30px;border-color:transparent;background:transparent;font-size:12px;max-width:200px;display:block}.dsh-remote-ops__webPages button[aria-selected=true]{border-color:var(--dsw-alias-border-l3,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
      .dsh-remote-ops__webAddress{flex-wrap:nowrap!important;padding:6px 8px;gap:4px}.dsh-remote-ops__webAddress input{flex:1 1 0!important;width:0;min-width:0;font-size:12px}.dsh-remote-ops__webAddress button{min-width:28px;padding:4px 6px;min-height:32px}.dsh-remote-ops__webAddress button[type=submit]{margin-left:0}
      .dsh-remote-ops__webPage{flex:1;min-height:180px}.dsh-remote-ops__live{min-height:180px}.dsh-remote-ops__liveTools{padding:4px 8px;font-size:12px;flex-wrap:wrap}.dsh-remote-ops__liveTools select{font-size:12px;min-width:80px;min-height:28px}
      .dsh-remote-ops__liveSurface img{border:0}.dsh-remote-ops__webState{padding:5px 10px;min-height:30px;gap:6px;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb)}.dsh-remote-ops__webState>strong{font-weight:400}.dsh-remote-ops__webState>details{margin-left:auto}
      .dsh-remote-ops__webLog,.dsh-remote-ops__webSettings{padding:5px 10px;font-size:12px}.dsh-remote-ops__webSettings[open]{max-height:50%;overflow:auto;min-height:100px}.dsh-remote-ops__webSettings>.dsh-remote-ops__web{padding:0}.dsh-remote-ops__webSettings details>.dsh-remote-ops__web{padding:8px 0;display:block}
      .dsh-remote-ops__webWelcome{gap:8px}.dsh-remote-ops__webWelcome p{margin:0;font-size:12px}
      @container(max-width:600px){.dsh-remote-ops__sftpSplit{display:flex;min-height:240px}.dsh-remote-ops__sftpPane{flex:1;width:100%;border-left:0!important}.dsh-remote-ops__sftpPane:not([data-focused=true]){display:none}.dsh-remote-ops__fileSides{display:flex}.dsh-remote-ops__fileActions>button:not([data-focused=true]){display:none}.dsh-remote-ops__fileTime{display:none}}
      @container(max-width:420px){.dsh-remote-ops__head{gap:4px}.dsh-remote-ops__version{font-size:12px}.dsh-remote-ops__modalBackdrop{padding:8px}.dsh-remote-ops__modal{padding:12px}.dsh-remote-ops__terminalIdentity small{max-width:100%}.dsh-remote-ops__toolbar{gap:4px}.dsh-remote-ops__quickFilters{flex-wrap:nowrap}.dsh-remote-ops__quickFilters>input{flex:1;width:0;min-width:0}.dsh-remote-ops__quickFilters select{width:104px}.dsh-remote-ops__webBar>label{gap:3px}.dsh-remote-ops__webBar select{min-width:80px}}
      .dsh-remote-ops[data-density=compact]{--ro-control:28px;--ro-space:8px;--ro-row:34px}
      .dsh-remote-ops :is(button,input,textarea,select){transition:background-color .12s ease,border-color .12s ease}
      .dsh-remote-ops__density{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px;font-size:12px}
      .dsh-remote-ops__density select{width:auto}
      .dsh-remote-ops__menu>div{min-width:240px;max-width:calc(100cqw - 24px);padding:8px}
      .dsh-remote-ops__envMeta{font-size:12px}.dsh-remote-ops__envName{font-weight:500}
      /* Catppuccin Latte / Mocha, with darker light-theme accents for text contrast. See THIRD_PARTY_NOTICES.md. */
      .dsh-remote-ops__output{--ro-terminal-command:light-dark(#7e3bd6,#cba6f7);--ro-terminal-directory:light-dark(#287482,#94e2d5);--ro-terminal-file:light-dark(#1e5cd6,#89b4fa);padding:16px;line-height:1.65;background:light-dark(#eff1f5,#1e1e2e);color:light-dark(#4c4f69,#cdd6f4)}
      .dsh-remote-ops__output :is([data-terminal-role=agent-command],[data-terminal-role=command]){color:var(--ro-terminal-command)!important;font-weight:650;background:color-mix(in srgb,var(--ro-terminal-command) 8%,transparent);border-radius:2px}
      .dsh-remote-ops__output [data-terminal-role=directory]{color:var(--ro-terminal-directory);font-weight:650}
      .dsh-remote-ops__output [data-terminal-role=file]{color:var(--ro-terminal-file)}
      .dsh-remote-ops__output [data-tone=error]{color:light-dark(#d20f39,#f38ba8)}
      .dsh-remote-ops__output [data-tone=warning]{color:light-dark(#875e28,#f9e2af)}
      .dsh-remote-ops__output [data-tone=success]{color:light-dark(#3c7333,#a6e3a1)}
      .dsh-remote-ops__logMenu{margin-left:0!important}.dsh-remote-ops__logMenu>div{width:220px}.dsh-remote-ops__logMenu button{text-align:start;width:100%}
      .dsh-remote-ops__terminalLegend{color:var(--ro-accent);font-size:11px;white-space:nowrap}.dsh-remote-ops__terminalLegend::before{content:"";display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:2px;background:currentColor}
      .dsh-remote-ops__quickLibraryRow{padding:12px 0}.dsh-remote-ops__diagnosticEvents>details{padding:14px 0}
      .dsh-remote-ops__web :is(label,.dsh-remote-ops__webField){text-align:left;justify-content:flex-start}
      .dsh-remote-ops__web :is(input,select,textarea){font:inherit}

      .dsh-remote-ops__webBrowser{padding:0;gap:0;overflow:hidden}
      .dsh-remote-ops__webMain{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;overflow:hidden}
      .dsh-remote-ops__webContext{display:flex;align-items:center;gap:6px;padding:4px 10px;flex:none;min-height:42px;background:var(--ro-soft)}
      .dsh-remote-ops__webContextPages{min-width:0;flex:1;display:flex;align-items:center;gap:6px}
      .dsh-remote-ops__webContextPages>select{max-width:130px;width:35%;font-size:12px}
      .dsh-remote-ops__webContext>select{font-size:12px;width:94px;flex:none;border-color:transparent;background:transparent}
      .dsh-remote-ops__webSettingsTrigger{border-color:transparent!important;background:transparent!important;min-width:30px;padding:5px!important}
      .dsh-remote-ops__webPagesBar{border:0;flex:1;padding:0;min-width:0}.dsh-remote-ops__webPages{padding:0}
      .dsh-remote-ops__webPages button[aria-selected=true]{border-color:transparent;background:var(--ro-bg)}
      .dsh-remote-ops__webPages button{max-width:180px}.dsh-remote-ops__webPagesBar>button{padding:3px;min-width:26px}
      .dsh-remote-ops__webAddress{background:var(--ro-soft);border-bottom:1px solid var(--ro-border);padding:5px 10px 8px}
      .dsh-remote-ops__webAddress>button:not([type=submit]){border-color:transparent;background:transparent}
      .dsh-remote-ops__webState{min-height:34px;font-size:12px}.dsh-remote-ops__webState>button{margin-left:auto;border-color:transparent;background:transparent;font-size:12px;min-height:28px;padding:3px 5px}
      .dsh-remote-ops__liveTools{order:2;border-top:1px solid var(--ro-border);min-height:28px;padding:2px 10px;gap:6px}
      .dsh-remote-ops__liveOptions{position:relative;margin-left:auto}.dsh-remote-ops__liveOptions>summary{padding:3px;cursor:pointer}
      .dsh-remote-ops__liveOptions>div{position:absolute;bottom:100%;right:0;z-index:15;width:180px;background:var(--ro-bg);border:1px solid var(--ro-border);border-radius:7px;padding:12px;display:grid;gap:8px;box-shadow:0 5px 18px #0002}
      .dsh-remote-ops__webUtility{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
      .dsh-remote-ops__webSettings,.dsh-remote-ops__webLog{overflow:auto;min-height:0;flex:1;border:0;padding:16px}
      .dsh-remote-ops__webSettings>label{display:flex;flex-direction:column;align-items:stretch;gap:7px;text-align:left;margin:0 0 18px}
      .dsh-remote-ops__webSettings>small{margin:8px 0 16px;line-height:1.6;color:var(--ro-muted)}
      .dsh-remote-ops__webSettings>details{margin-top:20px;border-top:1px solid var(--ro-border);padding-top:14px}
      .dsh-remote-ops__webSettings>details>summary{cursor:pointer}.dsh-remote-ops__webSettings>details>.dsh-remote-ops__web{padding:12px 0}
      .dsh-remote-ops__webResult{padding:12px 0;border-bottom:1px solid var(--ro-border)}
      .dsh-remote-ops__webResult pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,Consolas,monospace}
      .dsh-remote-ops__fileActions{order:2;border-top:1px solid var(--ro-border);background:var(--ro-soft);padding:8px 12px}
      .dsh-remote-ops__transfers{order:3}.dsh-remote-ops__fileUpload{padding:6px 10px}
      .dsh-remote-ops__fileUpload>label{position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 1 auto!important;min-height:var(--ro-control);padding:6px 10px;border:1px solid var(--ro-border);border-radius:7px;cursor:pointer;font-size:12px!important;overflow:hidden}
      .dsh-remote-ops__fileUpload input[type=file]{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;padding:0;min-height:0}
      .dsh-remote-ops__fileUpload>label:focus-within{outline:2px solid var(--ro-accent);outline-offset:2px}.dsh-remote-ops__fileUpload>label:has(input:disabled){opacity:.5;cursor:default}
      .dsh-remote-ops__uploadProgress{flex-basis:100%;width:100%;height:4px;accent-color:var(--ro-brand);border:0}
      @container(max-width:420px){.dsh-remote-ops__webPagesBar>button{min-width:24px}.dsh-remote-ops__webContext{padding:4px 8px;gap:3px}.dsh-remote-ops__webContext>select{width:88px}.dsh-remote-ops__webPages button{max-width:140px}}
      .dsh-remote-ops__passwordField{display:flex;flex-direction:column;gap:5px;min-width:0}.dsh-remote-ops__passwordRow{display:flex;gap:6px;align-items:stretch}.dsh-remote-ops__passwordRow input{flex:1;min-width:0;width:0}.dsh-remote-ops__passwordToggle{flex:none;display:flex;align-items:center;justify-content:center;min-width:34px;padding:6px!important}
      @media(pointer:coarse){.dsh-remote-ops button,.dsh-remote-ops summary{min-height:40px}.dsh-remote-ops input:not([type=checkbox]),.dsh-remote-ops textarea{font-size:16px}}
      @media(prefers-reduced-motion:reduce){.dsh-remote-ops *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}

      .dsh-remote-ops__moduleHost{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}
      .dsh-remote-ops__settingsBody{padding:18px;display:flex;flex-direction:column;gap:16px;overflow:auto;min-height:0}.dsh-remote-ops__settingsBody h3{font-size:14px;font-weight:600;margin:0 0 4px}.dsh-remote-ops__settingsBody p{margin:0;line-height:1.6}.dsh-remote-ops__settingsBody label{display:flex;align-items:center;gap:12px}.dsh-remote-ops__settingsBody label>select,.dsh-remote-ops__settingsBody label>input[type=number]{margin-left:auto;width:140px}.dsh-remote-ops__settingsActions{display:flex;gap:8px;flex-wrap:wrap}.dsh-remote-ops__utilityHead{flex:none}
      .dsh-remote-ops__subTabs{display:flex;padding:0 14px;gap:20px;border-bottom:1px solid var(--ro-border)}.dsh-remote-ops__subTabs>button{background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;padding:8px 0;color:var(--ro-muted)}.dsh-remote-ops__subTabs>button[aria-selected=true]{color:var(--ro-accent);border-bottom-color:var(--ro-accent)}
      .dsh-remote-ops__tabBadge{font-size:10px;line-height:1.5;padding:1px 5px;border-radius:4px;background:color-mix(in srgb,var(--ro-accent) 12%,var(--ro-bg));color:var(--ro-accent);white-space:nowrap}.dsh-remote-ops__tabBadge[data-tone=error]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#b42318) 12%,var(--ro-bg));color:var(--dsw-alias-state-error-primary,#b42318)}
      .dsh-remote-ops__operationMenu>summary{padding-inline:7px;gap:4px}.dsh-remote-ops__operationMenu>div{width:min(270px,calc(100cqw - 24px));padding:6px;gap:2px;max-height:65cqh;overflow:auto}.dsh-remote-ops__operationMenu>div>button{justify-content:flex-start;background:transparent;border:0;text-align:left}.dsh-remote-ops__operationMenu>div>small{padding:5px 8px;color:var(--ro-muted)}.dsh-remote-ops__operationMenu>div>label{padding:6px 8px;border-top:1px solid var(--ro-border)}
      .dsh-remote-ops__quickDock[data-open=false] .dsh-remote-ops__quickHead{padding-block:2px}.dsh-remote-ops__quickDock[data-open=false] .dsh-remote-ops__quickIdentity small{display:none}.dsh-remote-ops__quickDock[data-open=false] .dsh-remote-ops__quickButtons{display:flex;flex:none;overflow-x:auto;padding:2px 10px 7px;max-height:44px;scrollbar-gutter:auto}.dsh-remote-ops__quickDock[data-open=false] .dsh-remote-ops__quickButtons>button{flex:none;max-width:180px;white-space:nowrap}.dsh-remote-ops__quickDock[data-open=false] .dsh-remote-ops__quickEmpty{padding:0;font-size:12px}
      .dsh-remote-ops__fileOptions{position:relative;flex:none}.dsh-remote-ops__fileOptions>summary{cursor:pointer;padding:6px}.dsh-remote-ops__fileOptions>div{position:absolute;top:100%;right:0;z-index:10;width:min(210px,calc(100cqw - 32px));background:var(--ro-bg);border:1px solid var(--ro-border);border-radius:7px;padding:10px;display:grid;gap:8px;box-shadow:0 5px 18px #0002}.dsh-remote-ops__sftpPaneHead{overflow:visible}.dsh-remote-ops__sftpPaneHead>select{min-width:80px;flex:1}
      .dsh-remote-ops__webLogBottom{flex:0 1 auto;max-height:35%;border-top:1px solid var(--ro-border);padding:8px 12px}.dsh-remote-ops__webBrowser>.dsh-remote-ops__webSettings{flex:1;overflow:auto}.dsh-remote-ops__headAction[aria-expanded=true]{color:var(--ro-accent);background:var(--ro-soft)!important}
      .dsh-remote-ops__tabs{flex:1;min-width:0;gap:4px;padding:0;height:32px;min-height:0;border:0;background:transparent;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;align-items:stretch;flex-wrap:nowrap}
      .dsh-remote-ops__tabs::-webkit-scrollbar{display:none}
      .dsh-remote-ops__tab{flex:0 0 auto;min-width:96px;max-width:min(200px,100%);height:32px;box-sizing:border-box;align-items:center;border:1px solid var(--ro-border);border-bottom:2px solid transparent;border-radius:5px;background:var(--ro-bg)}
      .dsh-remote-ops__tab[data-active=true]{border-color:color-mix(in srgb,var(--ro-accent) 45%,var(--ro-border));border-bottom-color:var(--ro-accent);background:color-mix(in srgb,var(--ro-accent) 9%,var(--ro-bg))}
      .dsh-remote-ops__tabs .dsh-remote-ops__tab>button[role=tab]{flex:1;min-width:0;min-height:28px;height:28px;padding:2px 8px;border:0;border-radius:4px;background:transparent;font-size:12px;font-weight:500;color:var(--ro-text);gap:5px}
      .dsh-remote-ops__tabs .dsh-remote-ops__tab>button[aria-selected=true]{font-weight:650;color:var(--ro-accent)}
      .dsh-remote-ops__tabName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__tab svg{flex:none}.dsh-remote-ops__tabState{flex:none;font-size:10px;color:var(--ro-accent)}
      .dsh-remote-ops__tabs .dsh-remote-ops__tabClose{min-width:26px;min-height:28px;height:28px;padding:3px!important;border:0!important;border-radius:4px!important;background:transparent;color:var(--ro-muted)}
      .dsh-remote-ops__tabs .dsh-remote-ops__tabClose:hover{color:var(--dsw-alias-state-error-primary,#b42318);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#b42318) 9%,var(--ro-bg))}
      .dsh-remote-ops__terminalHead{min-height:36px;padding:2px 6px;gap:6px;flex-wrap:nowrap;box-sizing:border-box;background:var(--ro-soft)}
      .dsh-remote-ops__terminalActions{gap:2px;align-items:center;flex-wrap:nowrap}
      .dsh-remote-ops__terminalActions>button{width:30px;height:30px;min-height:30px;padding:5px}
      .dsh-remote-ops__terminalActions>button.dsh-remote-ops__closeAll{width:auto;padding:4px 7px;font-size:11px;white-space:nowrap}
      .dsh-remote-ops__connectionState{box-sizing:border-box;flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:light-dark(#237b4b,#81c995)}
      .dsh-remote-ops__connectionState[data-state=busy]{width:10px;height:10px;flex-basis:10px;background:transparent;border:2px solid light-dark(#9a6700,#e8b85b);border-right-color:transparent;animation:remote-ops-state-spin 1s linear infinite}
      .dsh-remote-ops__connectionState[data-state=disconnected]{background:transparent;border:2px solid light-dark(#687384,#a5adba)}
      @keyframes remote-ops-state-spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.dsh-remote-ops__connectionState[data-state=busy]{animation:none}}
      .dsh-remote-ops__terminalActions .dsh-remote-ops__operationMenu>summary{min-height:30px;height:30px;box-sizing:border-box;padding:4px 6px;font-size:12px;white-space:nowrap}
      .dsh-remote-ops__terminalStatus{flex-wrap:nowrap;white-space:nowrap}
      .dsh-remote-ops__terminalLocation{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis}
      .dsh-remote-ops__statusDetails>div{white-space:normal;overflow-wrap:anywhere}
      @media(pointer:coarse){.dsh-remote-ops__tabs,.dsh-remote-ops__tab{height:42px}.dsh-remote-ops__tabs .dsh-remote-ops__tab>button[role=tab],.dsh-remote-ops__tabs .dsh-remote-ops__tabClose,.dsh-remote-ops__terminalActions>button,.dsh-remote-ops__terminalActions .dsh-remote-ops__operationMenu>summary{min-height:40px;height:40px}.dsh-remote-ops__terminalActions>button{width:40px}}
      .dsh-remote-ops .dsh-remote-ops__environmentBack{flex:none;min-height:36px;padding:6px 12px;border-color:transparent;background:var(--ro-brand);color:#fff;font-weight:600;gap:6px}
      .dsh-remote-ops .dsh-remote-ops__environmentBack:hover{background:color-mix(in srgb,var(--ro-brand) 88%,#000)}
      .dsh-remote-ops .dsh-remote-ops__environmentBack:focus-visible{outline:2px solid var(--ro-text);outline-offset:2px}
      .dsh-remote-ops__environmentHead{gap:12px}.dsh-remote-ops__environmentHead strong{text-align:right;color:var(--ro-muted)}
      @container(max-width:480px){.dsh-remote-ops__workspaceTabs>button{min-width:72px;padding-inline:10px}}
      @container(max-width:380px){.dsh-remote-ops__workspaceTabs>button>svg{display:none}.dsh-remote-ops__workspaceTabs{padding-inline:8px}.dsh-remote-ops__workspaceTabs>button{min-width:64px;padding-inline:8px}.dsh-remote-ops__terminalIdentity{min-width:80px;gap:2px}.dsh-remote-ops__terminalIdentity small{flex-basis:100%}.dsh-remote-ops__settingsBody{padding:14px}.dsh-remote-ops__tools{flex-wrap:wrap}.dsh-remote-ops__tools>input{flex-basis:100%}}
    `;
    // BEGIN generated HTTP diagnostics
    // Shared by the server and the generated browser client. Never include request bodies or headers.
    function safeRequestUrl(address, base = 'http://local.invalid/') {
      try {
        const url = new URL(String(address), base);
        url.username = ''; url.password = ''; url.hash = '';
        for (const key of [...new Set(url.searchParams.keys())]) url.searchParams.set(key, '[REDACTED]');
        return url.href;
      } catch { return '[无效地址]'; }
    }

    function safeDiagnosticText(value, limit = 1200) {
      const sensitive = /password|passwd|secret|token|cookie|authorization|api[-_]?key|credential|signature/i;
      const scrub = text => String(text)
        .replace(/https?:\/\/[^\s<>"']+/gi, address => safeRequestUrl(address))
        .replace(/((?:authorization|proxy-authorization|set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
        .replace(/\b(Bearer|Basic)\s+[^\s,;"'<>]+/gi, '$1 [REDACTED]')
        .replace(/(["']?[\w-]*(?:password|passwd|secret|token|cookie|authorization|api[-_]?key|credential|signature)[\w-]*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*(?:"|$)|'[^']*(?:'|$)|[^\s,;<>]+)/gi, '$1[REDACTED]');
      const clean = (item, depth = 0) => {
        if (depth > 12) return '[内容省略]';
        if (typeof item === 'string') return scrub(item);
        if (Array.isArray(item)) return item.slice(0, 50).map(child => clean(child, depth + 1));
        if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).slice(0, 80).map(([key, child]) => [key, sensitive.test(key) ? '[REDACTED]' : clean(child, depth + 1)]));
        return item;
      };
      let text = String(value ?? '');
      try { text = JSON.stringify(clean(JSON.parse(text))); } catch { text = scrub(text); }
      text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
      return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
    }

    function requestFailure({ url, base, method = 'GET', status = null, stage = 'request', responseSummary = '', cause = '', at } = {}) {
      return { url: safeRequestUrl(url, base), method: String(method).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12) || 'GET', status: Number.isInteger(status) ? status : null, stage, responseSummary: safeDiagnosticText(responseSummary), cause: safeDiagnosticText(cause, 300), at: at ?? new Date().toISOString() };
    }

    function requestFailureTitle(failure) {
      if (['update-manifest', 'update-checksum', 'update-package'].includes(failure?.stage)) return '插件更新失败';
      return { 'state-refresh': '状态刷新失败', 'terminal-output': '终端输出刷新失败', 'update-status': '更新状态读取失败', 'update-settings': '更新来源保存失败', 'update-check': '更新检查失败', 'update-install': '插件更新失败' }[failure?.stage] ?? '请求失败';
    }

    function formatRequestFailure(value) {
      const failure = requestFailure(value);
      const stages = { 'state-refresh': '读取工作区状态', 'terminal-output': '读取终端输出', 'update-status': '读取本地更新状态', 'update-settings': '保存更新来源', 'update-check': '检查更新', 'update-install': '安装更新', 'update-manifest': '读取版本清单', 'update-checksum': '下载 SHA256 校验文件', 'update-package': '下载安装包' };
      return [requestFailureTitle(failure), `请求：${failure.method} ${failure.url}`, failure.status === null ? '状态：未收到 HTTP 响应' : `状态：HTTP ${failure.status}`, `阶段：${stages[failure.stage] ?? '插件请求'}`, failure.cause && `原因：${failure.cause}`, `响应摘要：${failure.responseSummary || '响应为空'}`, `时间：${failure.at}`].filter(Boolean).join('\n');
    }

    function createRefreshNoticeGate(storage) {
      const key = 'remote-ops.refresh-notices';
      let runtime = '', seen = new Set();
      try { const saved = JSON.parse(storage?.getItem(key) ?? 'null'); runtime = typeof saved?.runtime === 'string' ? saved.runtime : ''; seen = new Set(Array.isArray(saved?.seen) ? saved.seen.filter(item => typeof item === 'string').slice(-100) : []); } catch { /* Storage is optional. */ }
      const save = () => { try { storage?.setItem(key, JSON.stringify({ runtime, seen: [...seen].slice(-100) })); } catch { /* Memory still suppresses duplicate notices. */ } };
      return {
        setRuntime(id) { if (!id || id === runtime) return; if (runtime) seen.clear(); runtime = id; save(); },
        shouldNotify(error, manual = false) {
          const failure = error?.requestFailure;
          const signature = failure ? [failure.stage, failure.method, safeRequestUrl(failure.url), failure.status, error.code ?? ''].join('|') : String(error?.message ?? error);
          if (!manual && seen.has(signature)) return false;
          seen.add(signature); if (seen.size > 100) seen.delete(seen.values().next().value); save(); return true;
        },
      };
    }

    // END generated HTTP diagnostics
    const failureMessage = (value, status) => [value.title, `HTTP ${status}`, value.code, value.stage, value.error, value.details ?? value.stack, value.cleanupError].filter(Boolean).join("\n");
    async function request(path, init) {
      const base = window.location?.href, method = init?.method ?? "GET";
      const pathname = String(path).split("?")[0];
      let stage = pathname.endsWith("/state") ? "state-refresh" : pathname.endsWith("/terminal") ? "terminal-output" : "request";
      if (pathname.endsWith("/update")) {
        let action; try { action = JSON.parse(init?.body ?? "{}").action; } catch { /* The server validates request bodies. */ }
        stage = { settings: "update-settings", check: "update-check", install: "update-install" }[action] ?? "update-status";
      }
      let response, text;
      try { response = await fetch(path, init); text = await response.text(); }
      catch (cause) {
        if (cause?.name === "AbortError") throw cause;
        const diagnostic = requestFailure({ url: path, base, method, stage, status: response?.status, cause: cause?.message ?? String(cause) });
        throw Object.assign(new Error(formatRequestFailure(diagnostic)), { requestFailure: diagnostic });
      }
      let value = {}, invalidJson = false;
      try { value = text ? JSON.parse(text) : {}; } catch { invalidJson = true; }
      if (!response.ok || invalidJson) {
        const transport = requestFailure({ url: path, base, method, stage, status: response.status, responseSummary: text, cause: invalidJson && response.ok ? "接口未返回有效 JSON" : "" });
        const upstream = value?.requestFailure && typeof value.requestFailure === "object" ? requestFailure(value.requestFailure) : null;
        const diagnostic = upstream ?? transport;
        const error = Object.assign(new Error(), value && typeof value === "object" ? value : {}, { requestFailure: diagnostic });
        error.message = formatRequestFailure(diagnostic) + (value?.code ? `\n错误代码：${safeDiagnosticText(value.code, 120)}` : "") + (upstream ? `\n插件接口：${transport.method} ${transport.url}（HTTP ${transport.status}）` : "");
        throw error;
      }
      return value;
    }
    const refreshNotices = createRefreshNoticeGate((() => { try { return sessionStorage; } catch { return undefined; } })());
    const requestErrorDetails = message => h(React.Fragment, null, h("strong", null, message.split("\n")[0]), h("details", null, h("summary", null, "错误详情"), h("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, message.split("\n").slice(1).join("\n") || message)));
    const empty = { groups: [], environments: [], quickGroups: [], quickCommands: [], sessions: [], events: [], bound: false, pluginName: "dsh-remote-ops", pluginVersion: "0.12.0", update: { currentVersion: "0.12.0", latestVersion: "0.12.0", updateAvailable: false } };
    const terminalScreenModel = (value, rows = 40, columns = 160, options = {}) => {
      const source = String(value ?? "");
      let rendition = {};
      const palette = ["#263445", "#cc4545", "#27845a", "#947000", "#3779c5", "#9b54b4", "#12858a", "#b5bdc9", "#667588", "#ee6868", "#46b980", "#d5ae42", "#6aabef", "#c58bdd", "#45bac1", "#e8edf4"];
      const ansiColor = code => code < 16 ? `var(--ro-ansi-${code},${palette[code]})` : code < 232 ? (() => { const index = code - 16, level = [0, 95, 135, 175, 215, 255]; return `rgb(${level[Math.floor(index / 36)]},${level[Math.floor(index / 6) % 6]},${level[index % 6]})`; })() : `rgb(${8 + (code - 232) * 10},${8 + (code - 232) * 10},${8 + (code - 232) * 10})`;
      const sgr = parameters => {
        const values = parameters.split(";").map(value => Number(value || 0));
        rendition = { ...rendition };
        for (let at = 0; at < values.length; at++) {
          const code = values[at];
          if (code === 0) rendition = {};
          else if (code === 1) rendition.fontWeight = 700;
          else if (code === 22) delete rendition.fontWeight;
          else if (code === 3) rendition.fontStyle = "italic";
          else if (code === 23) delete rendition.fontStyle;
          else if (code === 4) rendition.textDecoration = "underline";
          else if (code === 24) delete rendition.textDecoration;
          else if (code >= 30 && code <= 37 || code >= 90 && code <= 97) rendition.color = ansiColor(code >= 90 ? code - 82 : code - 30);
          else if (code >= 40 && code <= 47 || code >= 100 && code <= 107) rendition.backgroundColor = ansiColor(code >= 100 ? code - 92 : code - 40);
          else if (code === 39) delete rendition.color;
          else if (code === 49) delete rendition.backgroundColor;
          else if (code === 38 || code === 48) {
            const key = code === 38 ? "color" : "backgroundColor";
            if (values[at + 1] === 5 && values[at + 2] >= 0 && values[at + 2] <= 255) { rendition[key] = ansiColor(values[at + 2]); at += 2; }
            else if (values[at + 1] === 2 && values.slice(at + 2, at + 5).length === 3 && values.slice(at + 2, at + 5).every(value => value >= 0 && value <= 255)) { rendition[key] = `rgb(${values.slice(at + 2, at + 5).join(",")})`; at += 4; }
          }
        }
      };
      const annotations = options.commandAnnotations ?? [];
      let annotationIndex = 0;
      const roleAt = index => {
        const offset = (options.startOffset ?? 0) + index;
        while (annotationIndex < annotations.length && annotations[annotationIndex].endOffset <= offset) annotationIndex++;
        const item = annotations[annotationIndex];
        return options.highlight !== false && item && item.startOffset <= offset && item.endOffset > offset ? "agent-command" : undefined;
      };
      const addRun = (runs, text, style, role) => {
        const last = runs[runs.length - 1];
        if (last && last.style === style && last.role === role) last.text += text;
        else runs.push({ text, style, role });
      };
      const trimRuns = runs => {
        while (runs.length) { const last = runs[runs.length - 1]; last.text = last.text.replace(/\s+$/u, ""); if (last.text) break; runs.pop(); }
        return runs;
      };
      // Append-only ASCII logs (including SGR colour codes) need no per-cell emulator.
      // Cursor motion, alternate screens, Unicode and incomplete sequences use the VT path.
      const plain = source.replace(/\x1b\[[0-9;]*m/g, "");
      if (Number.isInteger(columns) && columns > 0 && !/[^\x20-\x7e\r\n]/.test(plain) && !/\r(?!\n)|(?<!\r)\n/.test(plain)) {
        if (options.decorate && (source !== plain || annotations.length)) {
          const runs = [[]]; let column = 0;
          for (const token of source.matchAll(/\x1b\[([0-9;]*)m|[^\x1b]+/gu)) {
            if (token[1] !== undefined) { sgr(token[1]); continue; }
            for (let at = 0; at < token[0].length; at++) {
              const char = token[0][at];
              if (char === "\r") { at++; runs.push([]); column = 0; continue; }
              if (column >= columns) { runs.push([]); column = 0; }
              addRun(runs[runs.length - 1], char, rendition, roleAt(token.index + at)); column++;
            }
          }
          runs.forEach(trimRuns);
          let first = 0; while (first < runs.length - 1 && !runs[first].length) first++;
          const visibleRuns = runs.slice(first);
          return { text: visibleRuns.map(line => line.map(run => run.text).join("")).join("\n"), runs: visibleRuns, alternateScreen: false, cursorVisible: true, cursor: { row: visibleRuns.length - 1, column } };
        }
        const lines = [];
        let cursorColumn = 0;
        for (const line of plain.split("\r\n")) {
          if (!line.length) { lines.push(""); cursorColumn = 0; continue; }
          for (let offset = 0; offset < line.length; offset += columns) lines.push(line.slice(offset, offset + columns).replace(/ +$/g, ""));
          cursorColumn = (line.length - 1) % columns + 1;
        }
        let first = 0;
        while (first < lines.length - 1 && !lines[first]) first++;
        return { text: lines.slice(first).join("\n"), alternateScreen: false, cursorVisible: true, cursor: { row: lines.length - first - 1, column: cursorColumn } };
      }
      let screen = Array.from({ length: rows }, () => []);
      let scrollback = [];
      let normalScreen;
      let cursorVisible = true;
      let scrollTop = 0, scrollBottom = rows - 1;
      let row = 0;
      let column = 0;
      let savedRow = 0;
      let savedColumn = 0;
      const cellText = cell => typeof cell === "object" ? cell.text : cell;
      const lineText = (line) => line.map(cellText).join("").replace(/\s+$/g, "");
      const fillTo = (line, target) => { while (line.length < target) line.push(" "); };
      const lineFeed = () => {
        if (row !== scrollBottom) { row = Math.min(rows - 1, row + 1); return; }
        const removed = screen.splice(scrollTop, 1)[0];
        if (!normalScreen && scrollTop === 0 && scrollBottom === rows - 1) scrollback.push(removed);
        screen.splice(scrollBottom, 0, []);
      };
      const put = (character, origin) => {
        if (/\p{Mark}/u.test(character)) {
          const line = screen[row];
          let previous = column - 1;
          if (line[previous] === "") previous -= 1;
          if (previous >= 0) { if (typeof line[previous] === "object") line[previous].text += character; else line[previous] = (line[previous] || " ") + character; }
          return;
        }
        const point = character.codePointAt(0);
        const width = point >= 0x1100 && (point <= 0x115f || point >= 0x2e80 && point <= 0xa4cf || point >= 0xac00 && point <= 0xd7a3 || point >= 0xf900 && point <= 0xfaff || point >= 0xfe10 && point <= 0xfe6f || point >= 0xff01 && point <= 0xff60 || point >= 0x1f300) ? 2 : 1;
        if (column + width > columns) { column = 0; lineFeed(); }
        const line = screen[row];
        fillTo(line, column);
        if (line[column] === "" && column > 0) line[column - 1] = " ";
        if (line[column + width] === "") line[column + width] = " ";
        line[column] = options.decorate ? { text: character, style: rendition, role: normalScreen ? undefined : roleAt(origin) } : character;
        if (width === 2) line[column + 1] = "";
        column += width;
      };
      const clearDisplay = (mode) => {
        if (mode === 2 || mode === 3) {
          for (let index = 0; index < rows; index += 1) screen[index] = [];
          return;
        }
        if (mode === 1) {
          for (let index = 0; index < row; index += 1) screen[index] = [];
          const line = screen[row];
          fillTo(line, column + 1);
          for (let index = 0; index <= column; index += 1) line[index] = " ";
          return;
        }
        screen[row].length = Math.min(screen[row].length, column);
        for (let index = row + 1; index < rows; index += 1) screen[index] = [];
      };
      const clearLine = (mode) => {
        const line = screen[row];
        if (mode === 2) { screen[row] = []; return; }
        if (mode === 1) {
          fillTo(line, column + 1);
          for (let index = 0; index <= column; index += 1) line[index] = " ";
          return;
        }
        line.length = Math.min(line.length, column);
      };
      const applyCsi = (parameters, final) => {
        const values = parameters.replace(/^[?>!]/, "").split(";").map((item) => Number(item || 0));
        const amount = Math.max(1, values[0] || 1);
        if (parameters.startsWith("?") && ["h", "l"].includes(final)) {
          if (values.includes(25)) cursorVisible = final === "h";
          if (values.some(value => [47, 1047, 1049].includes(value))) {
            if (final === "h" && !normalScreen) { normalScreen = { screen, scrollback, row, column, scrollTop, scrollBottom }; screen = Array.from({ length: rows }, () => []); scrollback = []; row = 0; column = 0; scrollTop = 0; scrollBottom = rows - 1; }
            else if (final === "l" && normalScreen) { ({ screen, scrollback, row, column, scrollTop, scrollBottom } = normalScreen); normalScreen = undefined; }
          }
          return;
        }
        if (final === "m") { if (options.decorate) sgr(parameters); }
        else if (final === "r") { scrollTop = Math.max(0, Math.min(rows - 1, (values[0] || 1) - 1)); scrollBottom = Math.max(scrollTop, Math.min(rows - 1, (values[1] || rows) - 1)); row = 0; column = 0; }
        else if (final === "L" && row >= scrollTop && row <= scrollBottom) { const n = Math.min(amount, scrollBottom - row + 1); screen.splice(row, 0, ...Array.from({ length: n }, () => [])); screen.splice(scrollBottom + 1, n); }
        else if (final === "M" && row >= scrollTop && row <= scrollBottom) { const n = Math.min(amount, scrollBottom - row + 1); screen.splice(row, n); screen.splice(scrollBottom - n + 1, 0, ...Array.from({ length: n }, () => [])); }
        else if (final === "H" || final === "f") { row = Math.max(0, Math.min(rows - 1, (values[0] || 1) - 1)); column = Math.max(0, Math.min(columns - 1, (values[1] || 1) - 1)); }
        else if (final === "A") row = Math.max(0, row - amount);
        else if (final === "B") row = Math.min(rows - 1, row + amount);
        else if (final === "C") column = Math.min(columns - 1, column + amount);
        else if (final === "D") column = Math.max(0, column - amount);
        else if (final === "E") { row = Math.min(rows - 1, row + amount); column = 0; }
        else if (final === "F") { row = Math.max(0, row - amount); column = 0; }
        else if (final === "G") column = Math.max(0, Math.min(columns - 1, amount - 1));
        else if (final === "d") row = Math.max(0, Math.min(rows - 1, amount - 1));
        else if (final === "J") clearDisplay(values[0] || 0);
        else if (final === "K") clearLine(values[0] || 0);
        else if (final === "P") screen[row].splice(column, amount);
        else if (final === "@") screen[row].splice(column, 0, ...Array.from({ length: amount }, () => " "));
        else if (final === "X") { const line = screen[row]; fillTo(line, column + amount); for (let index = 0; index < amount; index += 1) line[column + index] = " "; }
        else if (final === "s") { savedRow = row; savedColumn = column; }
        else if (final === "u") { row = savedRow; column = savedColumn; }
      };

      for (let index = 0; index < source.length;) {
        const code = source.charCodeAt(index);
        if (code === 0x1b) {
          const next = source[index + 1];
          if (next === "]") {
            index += 2;
            while (index < source.length && source.charCodeAt(index) !== 0x07 && !(source.charCodeAt(index) === 0x1b && source[index + 1] === "\\")) index += 1;
            index += source.charCodeAt(index) === 0x1b ? 2 : 1;
            continue;
          }
          if (["(", ")", "*", "+", "-", ".", "/"].includes(next)) { index += 3; continue; }
          if (next === "[") {
            let finalIndex = index + 2;
            while (finalIndex < source.length && (source.charCodeAt(finalIndex) < 0x40 || source.charCodeAt(finalIndex) > 0x7e)) finalIndex += 1;
            if (finalIndex >= source.length) break;
            applyCsi(source.slice(index + 2, finalIndex), source[finalIndex]);
            index = finalIndex + 1;
            continue;
          }
          if (next === "7") { savedRow = row; savedColumn = column; }
          else if (next === "8") { row = savedRow; column = savedColumn; }
          else if (next === "D") lineFeed();
          else if (next === "M") { if (row === scrollTop) { screen.splice(scrollBottom, 1); screen.splice(scrollTop, 0, []); } else row = Math.max(0, row - 1); }
          else if (next === "E") { column = 0; lineFeed(); }
          else if (next === "c") { clearDisplay(2); row = 0; column = 0; }
          index += 2;
          continue;
        }
        if (code === 0x0d) { column = 0; index += 1; continue; }
        if (code === 0x0a) { lineFeed(); index += 1; continue; }
        if (code === 0x08) { column = Math.max(0, column - 1); index += 1; continue; }
        if (code === 0x09) { column = Math.min(columns - 1, column + (8 - (column % 8))); index += 1; continue; }
        if (code < 0x20 || code === 0x7f) { index += 1; continue; }
        const character = String.fromCodePoint(source.codePointAt(index));
        put(character, index);
        index += character.length;
      }

      const cells = [...scrollback, ...screen];
      const allLines = cells.map(lineText);
      const cursorLine = scrollback.length + row;
      let firstLine = 0;
      while (!normalScreen && firstLine < allLines.length - 1 && allLines[firstLine] === "") firstLine += 1;
      let lastLine = Math.max(cursorLine, 0);
      while (lastLine < allLines.length - 1 && allLines[lastLine + 1] !== undefined) lastLine += 1;
      while (!normalScreen && lastLine > firstLine && allLines[lastLine] === "" && lastLine !== cursorLine) lastLine -= 1;
      const lines = allLines.slice(firstLine, lastLine + 1);
      while (!normalScreen && lines.length && lines[lines.length - 1] === "" && lines.length - 1 !== cursorLine - firstLine) lines.pop();
      while (!normalScreen && lines.length && lines[0] === "" && cursorLine - firstLine > 0) { lines.shift(); firstLine += 1; }
      if (!lines.length) lines.push("");
      const visibleCursorRow = Math.max(0, cursorLine - firstLine);
      const text = lines.map((line) => line.replace(/\s+$/g, "")).join("\n");
      const cursorColumn = screen[row].slice(0, column).map(cellText).join("").length + Math.max(0, column - screen[row].length);
      const runs = options.decorate ? cells.slice(firstLine, firstLine + lines.length).map(line => {
        const parts = []; for (const cell of line) { if (cell === "") continue; addRun(parts, cellText(cell), cell?.style, cell?.role); } return trimRuns(parts);
      }) : undefined;
      return { text, ...(runs ? { runs } : {}), alternateScreen: Boolean(normalScreen), cursorVisible, cursor: { row: visibleCursorRow, column: cursorColumn } };
    };
    const terminalVisibleText = (value, rows = 40, columns = 160) => terminalScreenModel(value, rows, columns).text;
    const terminalLineTone = (line, grid, enabled = true) => {
      if (grid || !enabled) return undefined;
      if (/^\s*(?:\[(?:error|fatal|fail(?:ed|ure)?)\]|(?:%\s*)?(?:error|fatal|fail(?:ed|ure)?)(?=[:\s])|错误[：:]|失败[：:])/iu.test(line)) return "error";
      if (/^\s*(?:\[warn(?:ing)?\]|(?:%\s*)?warn(?:ing)?(?=[:\s])|警告[：:])/iu.test(line)) return "warning";
      if (/^\s*(?:\[(?:ok|success|passed)\]|(?:success|passed)(?=[:\s])|成功[：:])/iu.test(line)) return "success";
      return undefined;
    };
    // Interpret only text already echoed on screen, after VT cursor edits. This
    // also covers manual/raw input without copying hidden input into the display.
    const terminalSemanticRuns = (runs, line, grid, enabled = true) => {
      if (grid || !enabled) return runs;
      const prompt = /^(?:(?:PS )?[A-Za-z]:\\[^>\r\n]*>|[^\s@]+@[^\s#$>]+(?:[ \t][^\r\n#$>]*)?[#$>] |\[[^\]\r\n]+@[^\]\r\n]+\][#$] )/u.exec(line);
      const entry = !prompt && /^(\s*\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\s+(?:(?:上午|下午)\s*)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM|上午|下午))?\s+)(<DIR>|<JUNCTION>|<SYMLINKD>|<SYMLINK>|\d[\d,.\u00a0]*)(\s+)(\S.*)$/iu.exec(line);
      const start = prompt ? prompt[0].length : entry ? entry[1].length + entry[2].length + entry[3].length : -1;
      if (start < 0 || !line.slice(start).trim()) return runs;
      const role = prompt ? "command" : /^<(?:DIR|JUNCTION|SYMLINKD)>$/iu.test(entry[2]) ? "directory" : "file";
      const result = []; let offset = 0;
      for (const run of runs?.length ? runs : [{ text: line }]) {
        const end = offset + run.text.length, split = Math.max(0, Math.min(run.text.length, start - offset));
        if (split) result.push({ ...run, text: run.text.slice(0, split) });
        if (split < run.text.length) result.push({ ...run, text: run.text.slice(split), role: run.role ?? role });
        offset = end;
      }
      return result;
    };
    const terminalStyledLine = (runs, line, cursor, showCursor, grid = false) => {
      const parts = [], items = runs?.length ? runs : [{ text: line }]; let offset = 0, placed = false;
      const span = (run, text, key) => h("span", { key, style: run.style, "data-terminal-role": grid ? undefined : run.role }, text);
      for (const [index, run] of items.entries()) {
        const end = offset + run.text.length;
        if (showCursor && !placed && cursor >= offset && cursor <= end) {
          const at = cursor - offset;
          parts.push(span(run, run.text.slice(0, at), `before-${index}`), h("span", { key: "cursor", className: "dsh-remote-ops__inputCursor", "aria-hidden": true }), span(run, run.text.slice(at), `after-${index}`)); placed = true;
        } else parts.push(span(run, run.text, `run-${index}`));
        offset = end;
      }
      if (showCursor && !placed) parts.push(" ".repeat(Math.max(0, cursor - offset)), h("span", { key: "cursor", className: "dsh-remote-ops__inputCursor", "aria-hidden": true }));
      return parts;
    };
    const parseSshCommand = (value) => { const text = String(value ?? "").trim(); if (!/^ssh(?:\s|$)/i.test(text)) return undefined; const tokens = text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.slice(1).map((item) => item.replace(/^("|')|("|')$/g, "")) ?? []; let hostToken = ""; let username = ""; let port = 22; let privateKeyPath = ""; const takesValue = new Set(["-p", "-i", "-l", "-F", "-J", "-o", "-b", "-D", "-L", "-R", "-W", "-S", "-B", "-c", "-m", "-w"]); for (let index = 0; index < tokens.length; index += 1) { const token = tokens[index]; if (token === "--") { hostToken = tokens[index + 1] ?? ""; break; } if (token === "-p") { port = Number(tokens[++index]); continue; } if (token.startsWith("-p") && token.length > 2) { port = Number(token.slice(2)); continue; } if (token === "-i") { privateKeyPath = tokens[++index] ?? ""; continue; } if (token.startsWith("-i") && token.length > 2) { privateKeyPath = token.slice(2); continue; } if (token === "-l") { username = tokens[++index] ?? ""; continue; } if (token.startsWith("-l") && token.length > 2) { username = token.slice(2); continue; } if (token.startsWith("-")) { if (takesValue.has(token)) index += 1; continue; } if (!hostToken) hostToken = token; } if (!hostToken) return { error: "SSH 命令缺少主机地址，请使用 ssh [user@]host。" }; const at = hostToken.lastIndexOf("@"); if (at >= 0) { username = hostToken.slice(0, at) || username; hostToken = hostToken.slice(at + 1); } const host = hostToken.replace(/^\[|\]$/g, ""); if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return { error: "SSH 命令中的主机或端口无效。" }; return { host, username, port, privateKeyPath }; };

    const environmentProfileValues = (environment) => ({
      autoQuitMore: environment?.cliProfile?.autoQuitMore === true,
      autoSigint: environment?.cliProfile?.autoSigint !== false,
      stripAnsi: environment?.cliProfile?.stripAnsi === true,
      headTailChars: environment?.cliProfile?.headTailChars ? String(environment.cliProfile.headTailChars) : "",
      rows: environment?.terminal?.rows ? String(environment.terminal.rows) : "",
      cols: environment?.terminal?.cols ? String(environment.terminal.cols) : "",
    });
    const environmentConnectionValues = environment => ({ platform: environment?.platform ?? "auto", shell: environment?.shell ?? "server-default", encoding: environment?.encoding ?? "utf-8", readyTimeoutMs: String(environment?.readyTimeoutMs ?? 15000), hostKeySha256: environment?.hostKeySha256 ?? "" });
    const environmentConnectionFromForm = form => {
      const readyTimeoutMs = Number(form.readyTimeoutMs);
      if (!Number.isInteger(readyTimeoutMs) || readyTimeoutMs < 1000 || readyTimeoutMs > 120000) return { error: "连接超时必须是 1000-120000 毫秒的整数" };
      const hostKeySha256 = String(form.hostKeySha256 ?? "").trim();
      if (hostKeySha256 && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(hostKeySha256)) return { error: "主机指纹应为 OpenSSH SHA256: 格式" };
      return { transport: "ssh", platform: form.platform, shell: form.platform === "posix" ? "server-default" : form.shell, encoding: form.encoding, readyTimeoutMs, hostKeySha256 };
    };
    const environmentProfileFromForm = (form) => {
      const profile = {};
      if (form.autoQuitMore) profile.autoQuitMore = true;
      if (form.autoSigint === false) profile.autoSigint = false;
      if (form.stripAnsi) profile.stripAnsi = true;
      const chars = String(form.headTailChars ?? "").trim();
      if (chars) { const value = Number(chars); if (!Number.isInteger(value) || value < 200 || value > 100000) return { error: "长输出头尾字符数必须是 200-100000 的整数，留空表示关闭" }; profile.headTailChars = value; }
      const terminal = {};
      for (const [key, label, min, max] of [["rows", "终端行数", 10, 200], ["cols", "终端列数", 40, 500]]) {
        const text = String(form[key] ?? "").trim();
        if (!text) continue;
        const value = Number(text);
        if (!Number.isInteger(value) || value < min || value > max) return { error: `${label}必须是 ${min}-${max} 的整数，留空使用默认值` };
        terminal[key] = value;
      }
      return { cliProfile: profile, terminal };
    };
    const TERMINAL_SIZE_PRESETS = [[24, 80], [40, 120], [40, 160], [50, 200]];
    const terminalSizeOptions = (size) => {
      const current = size?.rows && size?.cols ? [size.rows, size.cols] : [40, 160];
      const known = TERMINAL_SIZE_PRESETS.some(([rows, cols]) => rows === current[0] && cols === current[1]);
      return [...(known ? [] : [current]), ...TERMINAL_SIZE_PRESETS].map(([rows, cols]) => ({ value: `${rows}x${cols}`, label: `${cols}×${rows}`, rows, cols }));
    };
    const terminalSizeFromValue = (value) => { const match = /^(\d+)x(\d+)$/.exec(String(value)); return match ? { rows: Number(match[1]), cols: Number(match[2]) } : undefined; };
    const environmentAdvancedFields = (form, update) =>
    h("details", { className: "dsh-remote-ops__formAdvanced", open: Boolean(form.autoQuitMore || form.stripAnsi || form.autoSigint === false || form.headTailChars || form.rows || form.cols) },
      h("summary", null, "设备命令行（CLI）辅助与终端大小"),
      h("div", { className: "dsh-remote-ops__formAdvancedBody" },
        h("label", { className: "dsh-remote-ops__quickCheck" }, h("input", { type: "checkbox", checked: form.autoQuitMore, onChange: (event) => update("autoQuitMore", event.target.checked) }), "自动退出 --More-- 分页"),
        h("label", { className: "dsh-remote-ops__quickCheck" }, h("input", { type: "checkbox", checked: form.autoSigint, onChange: (event) => update("autoSigint", event.target.checked) }), "参数错误提示后自动 Ctrl+C 清行（默认开启）"),
        h("label", { className: "dsh-remote-ops__quickCheck" }, h("input", { type: "checkbox", checked: form.stripAnsi, onChange: (event) => update("stripAnsi", event.target.checked) }), "返回给 Agent 的输出去除 ANSI 控制序列"),
        h("label", null, "长输出头尾摘要字符数（200-100000，留空关闭）", h("input", { "aria-label": "长输出头尾摘要字符数", value: form.headTailChars, onChange: (event) => update("headTailChars", event.target.value), inputMode: "numeric" })),
        h("div", { className: "dsh-remote-ops__row" },
          h("label", { style: { flex: 1 } }, "终端行数（默认 40）", h("input", { "aria-label": "终端行数", value: form.rows, onChange: (event) => update("rows", event.target.value), inputMode: "numeric" })),
          h("label", { style: { flex: 1 } }, "终端列数（默认 160）", h("input", { "aria-label": "终端列数", value: form.cols, onChange: (event) => update("cols", event.target.value), inputMode: "numeric" })),
        ),
        h("div", { className: "dsh-remote-ops__formNote" }, "终端大小对新建的 SSH 连接生效；已连接的终端请在终端工具栏调整。"),
      ),
    );
    const terminalSizeSelect = (size, disabled, onResize) => h("label", null, "大小", h("select", { "aria-label": "终端大小", title: "调整远端 PTY 大小；已输出的内容不会重排", value: `${size?.rows || 40}x${size?.cols || 160}`, disabled, onChange: (event) => { const next = terminalSizeFromValue(event.target.value); if (next) onResize(next); } }, terminalSizeOptions(size).map((option) => h("option", { key: option.value, value: option.value }, option.label))));
    // end environment form helpers

    const terminalUsesGrid = screen => screen.alternateScreen || screen.cursorVisible === false;
    const terminalInputEnabled = (snapshot) => Boolean(snapshot?.bound || snapshot?.sessions?.some((item) => item.kind === "local" && item.status?.kind === "running"));
    const terminalInputCompositionValue = (value, composing) => composing ? undefined : String(value ?? "");
    const mergeTerminalFrame = (previous, value) => {
      if (!value.reset && (!previous || previous.streamId !== value.streamId || previous.nextOffset !== value.startOffset)) throw new Error("TERMINAL_CURSOR_MISMATCH: output is not contiguous");
      const raw = (value.reset ? String(value.text ?? "") : `${previous.raw}${value.text ?? ""}`).slice(-(256 * 1024));
      return { ...value, raw };
    };
    const queueTerminalInput = (queue, input) => {
      const last = queue[queue.length - 1];
      if (last && last.session === input.session && last.sessionId === input.sessionId && last.streamId === input.streamId) last.text += input.text;
      else queue.push({ ...input });
    };
    const useTerminalViewport = (outputRef, followRef, frameKey, text, module, quickOpen, quickHeight, fullScreen = false) => {
      const positions = useRef(new Map());
      useEffect(() => {
        const node = outputRef.current;
        if (!node || module === "sftp") return undefined;
        const frame = window.requestAnimationFrame(() => { node.scrollTop = fullScreen ? 0 : followRef.current ? node.scrollHeight : positions.current.get(frameKey) ?? node.scrollTop; });
        const observer = new ResizeObserver(() => { if (fullScreen) node.scrollTop = 0; else if (followRef.current) node.scrollTop = node.scrollHeight; });
        observer.observe(node);
        return () => {
          observer.disconnect();
          window.cancelAnimationFrame(frame);
        };
      }, [frameKey, text, module, quickOpen, quickHeight, fullScreen]);
      return (node) => {
        // Capture while mounted: detached elements report scrollTop=0 during cleanup.
        positions.current.set(frameKey, node.scrollTop);
        if (positions.current.size > 20) positions.current.delete(positions.current.keys().next().value);
      };
    };
    const writeClipboard = async text => {
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE: 浏览器禁止剪贴板访问，请使用 HTTPS 或手动复制选区");
      await navigator.clipboard.writeText(text);
    };
    const terminalPreferences = (value = {}) => ({
      fontSize: Math.max(11, Math.min(22, Number(value.fontSize) || 13)),
      wrap: value.wrap !== false,
      quickHeight: Math.max(92, Math.min(4096, Number(value.quickHeight) || 190)),
      highlight: value.highlight !== false,
    });
    const pasteSubmission = (draft, owner) => {
      if (draft.owner !== owner || !draft.session) throw new Error("PASTE_TARGET_CHANGED: 当前会话已改变，请重新选择目标");
      return { session: draft.session, sessionId: owner, streamId: draft.streamId, text: draft.text.replace(/\r\n|\n/g, "\r") };
    };
    const outputMatches = (text, query) => query ? String(text).split("\n").flatMap((line, index) => line.toLowerCase().includes(query.toLowerCase()) ? [index] : []) : [];
    const fileEndpoint = pane => ({ kind: pane.kind, path: pane.path, ...(pane.kind === "ssh" ? { environment: pane.environment } : {}) });
    const mergeSessionTabs = (previous, current) => [...current.map(item => ({ ...item, disconnected: item.status?.kind === "exited" })), ...previous.filter(item => !current.some(live => live.sessionId === item.sessionId)).slice(-12).map(item => ({ ...item, disconnected: true, status: { kind: "exited" }, operation: { kind: "disconnected" } }))];
    const terminalTabStatus = (item, frame) => {
      const sameStream = frame && frame.streamId === item.outputCursor?.streamId;
      if ((item.disconnected || item.status?.kind === "exited") && ["command", "closing"].includes(item.operation?.kind)) return { state: "busy", label: item.operation.kind === "closing" ? "正在关闭连接" : `${item.operation.actor === "agent" ? "Agent 操作中" : "操作中"} · 终端已断开，独立命令仍在执行` };
      if (item.disconnected || item.status?.kind === "exited" || sameStream && frame.status?.kind === "exited") return { state: "disconnected", label: "已断开 · 保留最后输出" };
      const operation = sameStream && (frame.operation?.revision ?? 0) > (item.operation?.revision ?? 0) ? frame.operation : item.operation;
      if (operation?.kind === "closing") return { state: "busy", label: "正在关闭连接" };
      if (["waiting", "command"].includes(operation?.kind)) return { state: "busy", label: `${operation.actor === "agent" ? "Agent 操作中" : "操作中"} · ${operation.kind === "command" ? "独立命令执行中" : "等待回显"}` };
      return { state: "connected", label: item.kind === "local" ? "本地终端就绪" : "已连接 · 不代表命令已完成" };
    };
    const terminalCloseSelection = (tabs, frames = {}) => {
      const targets = tabs.filter(item => item.kind === "ssh");
      return { targets, connected: targets.filter(item => !item.disconnected && item.status?.kind !== "exited").length, operating: targets.filter(item => terminalTabStatus(item, frames[item.sessionId]).state === "busy").length };
    };
    const terminalCloseResult = (targets, results = []) => ({
      closed: targets.filter(item => results.some(result => result.sessionId === item.sessionId && result.closed === true)).map(item => item.sessionId),
      failures: targets.flatMap(item => { const result = results.find(result => result.sessionId === item.sessionId); return result?.closed === true ? [] : [`${item.name}：${result?.error || "未收到关闭结果，请刷新后重试"}`]; }),
    });
    const retryDelay = attempt => Math.min(30000, 600 * 2 ** Math.min(6, Math.max(0, attempt)));
    const fileWorkspacePreferences = (value = {}) => {
      const clean = pane => ({ kind: pane?.kind === "ssh" ? "ssh" : "host", environment: String(pane?.environment ?? ""), path: typeof pane?.path === "string" && pane.path.length < 4096 ? pane.path : ".", sort: ["name", "size", "modified"].includes(pane?.sort) ? pane.sort : "name", scrollTop: Math.max(0, Math.min(10000000, Number(pane?.scrollTop) || 0)) });
      return { panes: Array.isArray(value?.panes) ? value.panes.slice(0, 2).map(clean) : [], bookmarks: Array.isArray(value?.bookmarks) ? value.bookmarks.slice(0, 30).map(clean) : [] };
    };
    const sameFileLocation = (a, b) => a.kind === b.kind && (a.kind !== "ssh" || a.environment === b.environment) && String(a.path).replace(/\\/g, "/").replace(/\/+$/, "") === String(b.path).replace(/\\/g, "/").replace(/\/+$/, "");
    const sortedFileEntries = (entries, sort) => [...entries].sort((a, b) => Number(b.type === "d") - Number(a.type === "d") || (sort === "size" ? b.size - a.size : sort === "modified" ? (b.modifyTime ?? 0) - (a.modifyTime ?? 0) : 0) || a.name.localeCompare(b.name));

    // Browser requests belong to the plugin, not to a mounted file view. Never retain File objects after a batch ends.
    const createBrowserUploads = () => {
      const jobs = new Map(), listeners = new Set();
      const notify = () => listeners.forEach(listener => listener());
      const update = (job, patch) => { if (jobs.get(job.owner) === job) { job.view = { ...job.view, ...patch }; notify(); } };
      const active = job => job && ["uploading", "cancelling"].includes(job.view.status);
      const cancel = owner => { const job = jobs.get(owner); if (!active(job)) return; job.cancelled = true; update(job, { status: "cancelling" }); job.xhr?.abort(); };
      const run = async job => {
        let batchId, heartbeat;
        const batch = phase => request("/api/dsh-remote-ops/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upload-batch", sessionId: job.owner, phase, batchId }) });
        const keepAlive = () => { heartbeat = setTimeout(async () => { try { await batch("touch"); } catch { /* A file dispatch checks the lease before sending. */ } if (jobs.get(job.owner) === job && active(job)) keepAlive(); }, 30000); };
        try {
          batchId = (await batch("start")).batchId; keepAlive();
          for (const [index, file] of job.files.entries()) {
            if (job.cancelled) break;
            await batch("touch");
            if (job.cancelled) break;
            update(job, { name: file.name, bytes: 0, total: file.size, index: index + 1 });
            const task = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest(); job.xhr = xhr;
              xhr.open("POST", `/api/dsh-remote-ops/browser-upload?${new URLSearchParams({ sessionId: job.owner, ...job.target, name: file.name, conflict: job.conflict })}`);
              xhr.upload.onprogress = event => update(job, { bytes: event.loaded });
              xhr.onload = () => { let value; try { value = JSON.parse(xhr.responseText); } catch { value = { error: xhr.responseText }; } if (xhr.status >= 200 && xhr.status < 300) resolve(value); else reject(new Error(failureMessage(value, xhr.status))); };
              xhr.onerror = () => reject(new Error("BROWSER_UPLOAD_NETWORK: 浏览器上传网络中断"));
              xhr.onabort = () => reject(new Error("BROWSER_UPLOAD_CANCELLED: 已取消上传"));
              xhr.send(file);
            });
            job.xhr = null;
            update(job, { completedTasks: [...job.view.completedTasks, { id: task.id, status: task.status, finishedAt: task.finishedAt, target: task.target }] });
          }
          update(job, { status: job.cancelled ? "cancelled" : "completed" });
        } catch (error) { update(job, { status: job.cancelled ? "cancelled" : "failed", error: job.cancelled ? "" : error.message }); }
        finally { clearTimeout(heartbeat); job.files = []; job.xhr = null; if (batchId) await batch("end").catch(() => {}); }
      };
      return {
        get: owner => jobs.get(owner)?.view ?? null,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        hasActive: () => [...jobs.values()].some(active),
        start({ owner, target, files, conflict }) {
          if (!owner || !files.length || active(jobs.get(owner))) return false;
          for (const [id, job] of jobs) if (jobs.size >= 64 && !active(job)) jobs.delete(id);
          const job = { owner, target: fileEndpoint(target), files: [...files], conflict, cancelled: false, xhr: null, view: { status: "uploading", name: files[0].name, bytes: 0, total: files[0].size, index: 1, count: files.length, completedTasks: [], error: "" } };
          jobs.set(owner, job); notify(); void run(job); return true;
        },
        cancel,
        dispose() { for (const owner of jobs.keys()) cancel(owner); jobs.clear(); notify(); listeners.clear(); },
      };
    };
    const browserUploads = createBrowserUploads();

    // UI positions only. Never persist credentials, terminal contents or command output.
    const workspaceViews = new Map(), fileViews = new Map(), commandDrafts = new Map();
    const workspaceView = owner => {
      if (workspaceViews.has(owner)) return workspaceViews.get(owner);
      try { const saved = JSON.parse(sessionStorage.getItem("remote-ops.view." + owner) || "{}"); return { module: ["terminal", "browser", "desktop", "sftp", "api"].includes(saved.module) ? saved.module : "terminal", activeSessionId: typeof saved.activeSessionId === "string" ? saved.activeSessionId.slice(0, 200) : "", search: typeof saved.search === "string" ? saved.search.slice(0, 120) : "" }; }
      catch { return { module: "terminal", activeSessionId: "", search: "" }; }
    };
    const rememberWorkspace = (owner, value) => {
      if (!owner) return;
      workspaceViews.set(owner, value);
      if (workspaceViews.size > 64) workspaceViews.delete(workspaceViews.keys().next().value);
      try { sessionStorage.setItem("remote-ops.view." + owner, JSON.stringify(value)); } catch { /* Storage is optional. */ }
    };


    function SftpWorkspace({ sessionId, environments, initialEnvironment, onError, onClose, visible = true }) {
      const initial = (kind, environment = "") => ({ kind, environment, path: ".", draft: ".", sort: "name", scrollTop: 0, entries: [], selected: [], loading: false, loaded: false, error: "" });
      const [saved] = useState(() => { try { return fileWorkspacePreferences(JSON.parse(localStorage.getItem("remote-ops.files." + sessionId) || "{}")); } catch { return fileWorkspacePreferences(); } });
      const [panes, setPanes] = useState(() => [initial("host"), initial(environments.length ? "ssh" : "host", initialEnvironment || environments[0]?.id)].map((pane, side) => ({ ...pane, ...saved.panes[side], ...fileViews.get(sessionId)?.panes[side], entries: [], loaded: false, loading: false, error: "", draft: fileViews.get(sessionId)?.panes[side]?.draft ?? saved.panes[side]?.path ?? "." })));
      const [filters, setFilters] = useState(() => fileViews.get(sessionId)?.filters ?? ["", ""]), [fileSide, setFileSide] = useState(() => fileViews.get(sessionId)?.side ?? 0);
      const filtersRef = useRef(filters), sideRef = useRef(fileSide), taskSignature = useRef(""), selectionAnchor = useRef([null, null]); filtersRef.current = filters; sideRef.current = fileSide;
      const visibleEntries = useMemo(() => panes.map((pane, side) => sortedFileEntries(pane.entries, pane.sort).filter(item => item.name.toLowerCase().includes(filters[side].toLowerCase()))), [panes, filters]);
      const [bookmarks, setBookmarks] = useState(saved.bookmarks);
      const [preview, setPreview] = useState(null), [preparing, setPreparing] = useState(false);
      const [conflict, setConflict] = useState("error");
      const [tasks, setTasks] = useState([]);
      const upload = useSyncExternalStore(browserUploads.subscribe, () => browserUploads.get(sessionId));
      const uploading = upload && ["uploading", "cancelling"].includes(upload.status);
      const generations = useRef([0, 0]), alive = useRef(true), inFlight = useRef([null, null]), pendingRefresh = useRef([false, false]);
      const panesRef = useRef(panes), bookmarksRef = useRef(bookmarks), lists = useRef([]), scrolls = useRef(panes.map(pane => pane.scrollTop));
      const saveTimer = useRef(), confirmation = useRef(), seenTasks = useRef(new Set(upload?.completedTasks.map(task => task.id) ?? [])), taskBaseline = useRef(false);
      const wasVisible = useRef(visible), refreshOnShow = useRef(false);
      panesRef.current = panes; bookmarksRef.current = bookmarks;
      const save = () => { const retained = panesRef.current.map((pane, side) => ({ ...fileEndpoint(pane), draft: pane.draft, sort: pane.sort, selected: pane.selected, scrollTop: scrolls.current[side] })); fileViews.set(sessionId, { panes: retained, filters: filtersRef.current, side: sideRef.current }); if (fileViews.size > 64) fileViews.delete(fileViews.keys().next().value); try { localStorage.setItem("remote-ops.files." + sessionId, JSON.stringify(fileWorkspacePreferences({ panes: retained, bookmarks: bookmarksRef.current }))); } catch { /* Browser storage may be disabled. */ } };
      useEffect(() => { save(); }, [panes, bookmarks, filters, fileSide]);
      const invoke = useCallback(body => request("/api/dsh-remote-ops/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId }) }), [sessionId]);
      const change = (side, patch) => setPanes(current => current.map((pane, index) => index === side ? { ...pane, ...patch } : pane));
      const load = async (side, endpoint, selected) => {
        const generation = ++generations.current[side];
        const previous = panesRef.current[side], sameLocation = sameFileLocation(previous, endpoint), refreshing = previous.loaded && sameLocation;
        const position = sameLocation ? scrolls.current[side] : 0;
        inFlight.current[side] = endpoint; pendingRefresh.current[side] = false;
        change(side, { ...endpoint, ...(!sameLocation ? { draft: endpoint.path } : {}), loading: true, loaded: refreshing, error: "", entries: refreshing ? previous.entries : [], selected: selected ?? (refreshing ? previous.selected : []) });
        try {
          const value = await invoke({ action: "files", endpoint: fileEndpoint(endpoint) });
          if (alive.current && generation === generations.current[side]) {
            const selection = (selected ?? (refreshing ? panesRef.current[side].selected : [])).filter(name => value.entries.some(item => item.name === name));
            change(side, { path: value.path, draft: sameLocation && !sameFileLocation(previous, { ...previous, path: panesRef.current[side].draft }) ? panesRef.current[side].draft : value.path, entries: value.entries, selected: selection, loaded: true, loading: false });
            window.requestAnimationFrame(() => { const list = lists.current[side]; if (!list || !alive.current || generation !== generations.current[side]) return; list.scrollTop = sameLocation ? scrolls.current[side] : position; if (selected?.length) list.querySelector("[data-selected=true]")?.scrollIntoView({ block: "nearest" }); scrolls.current[side] = list.scrollTop; save(); });
          }
        } catch (error) { if (alive.current && generation === generations.current[side]) change(side, { error: error.message }); }
        finally { if (alive.current && generation === generations.current[side]) { inFlight.current[side] = null; change(side, { loading: false }); if (pendingRefresh.current[side]) { pendingRefresh.current[side] = false; void load(side, panesRef.current[side]); } } }
      };
      useEffect(() => {
        alive.current = true;
        void load(0, panes[0], panes[0].selected); void load(1, panes[1], panes[1].selected);
        return () => { alive.current = false; clearTimeout(saveTimer.current); save(); confirmation.current?.(false); };
      }, []);
      useEffect(() => { if (visible && !wasVisible.current) refreshOnShow.current = true; wasVisible.current = visible; }, [visible]);
      useEffect(() => {
        if (!visible) return;
        let stopped = false, timer, failures = 0, polling = false;
        const poll = async () => {
          if (stopped || polling) return; polling = true;
          if (sessionId && !document.hidden) try {
            const value = await invoke({ action: "transfers" }); failures = 0;
            if (!stopped) {
              const browserTasks = browserUploads.get(sessionId)?.completedTasks ?? [];
              const changed = browserTasks.filter(task => !seenTasks.current.has(task.id));
              for (const task of value.tasks) if (task.finishedAt && !seenTasks.current.has(task.id)) { if (taskBaseline.current) changed.push(task); seenTasks.current.add(task.id); }
              browserTasks.forEach(task => seenTasks.current.add(task.id));
              taskBaseline.current = true;
              const retainedIds = new Set([...value.tasks, ...browserTasks].map(task => task.id));
              for (const id of seenTasks.current) if (!retainedIds.has(id)) seenTasks.current.delete(id);
              panesRef.current.forEach((pane, side) => { if (refreshOnShow.current || changed.some(task => sameFileLocation(pane, task.target))) { if (inFlight.current[side]) pendingRefresh.current[side] = true; else void load(side, pane); } });
              refreshOnShow.current = false;
              const signature = JSON.stringify(value.tasks); if (signature !== taskSignature.current) { taskSignature.current = signature; setTasks(value.tasks); }
            }
          } catch (error) { failures++; if (!stopped) onError(error.message); }
          polling = false; if (!stopped) timer = setTimeout(poll, document.hidden ? 10000 : failures ? retryDelay(failures) : 1500);
        };
        const wake = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
        document.addEventListener?.("visibilitychange", wake);
        void poll(); return () => { stopped = true; clearTimeout(timer); document.removeEventListener?.("visibilitychange", wake); };
      }, [invoke, sessionId, visible]);
      const confirmOverwrite = async body => {
        if (body.conflict !== "overwrite") return true;
        const value = await invoke({ ...body, action: "transfer-preview" });
        if (!alive.current) return false;
        if (!value.conflictCount) return true;
        return new Promise(resolve => { confirmation.current = resolve; setPreview({ ...value, source: body.source, target: body.target }); });
      };
      const finishPreview = accept => { confirmation.current?.(accept); confirmation.current = null; setPreview(null); };
      const transfer = async side => {
        const source = panes[side], target = panes[1 - side], body = { source: fileEndpoint(source), target: fileEndpoint(target), names: [...source.selected], conflict };
        setPreparing(true);
        try { if (await confirmOverwrite(body)) { const task = await invoke({ ...body, action: "transfer" }); if (alive.current) setTasks(current => [...current, task]); } }
        catch (error) { if (alive.current) onError(error.message); }
        finally { if (alive.current) setPreparing(false); }
      };
      const fileUrl = (pane, name) => `/api/dsh-remote-ops/browser-file?${new URLSearchParams({ sessionId: sessionId ?? "", kind: pane.kind, environment: pane.environment, path: pane.path, name, conflict })}`;
      const browserUpload = async (side, fileList) => {
        const target = fileEndpoint(panes[side]), policy = conflict;
        setPreparing(true);
        try {
          for (const file of fileList) if (!alive.current || !await confirmOverwrite({ source: { kind: "browser" }, target, names: [file.name], browserFile: { size: file.size, lastModified: file.lastModified }, conflict: policy })) return;
          if (alive.current) browserUploads.start({ owner: sessionId, target, files: fileList, conflict: policy });
        } catch (error) { if (alive.current) onError(error.message); }
        finally { if (alive.current) setPreparing(false); }
      };
      const bookmark = side => {
        const pane = panes[side];
        setBookmarks(current => current.some(item => sameFileLocation(item, pane)) ? current.filter(item => !sameFileLocation(item, pane)) : [...current, pane].slice(-30));
      };
      const reveal = async (task, item) => {
        const side = panes.findIndex(pane => sameFileLocation(pane, task.target));
        const path = item?.name ?? task.names[0], split = path.lastIndexOf("/");
        const endpoint = { ...panes[side < 0 ? 1 : side], ...task.target, path: split < 0 ? task.target.path : join(task.target.path, path.slice(0, split)) };
        await load(side < 0 ? 1 : side, endpoint, [path.slice(split + 1)]);
      };
      const retry = async task => { try { const value = await invoke({ action: "transfer-retry", id: task.id }); if (alive.current) setTasks(current => [...current, value]); } catch (error) { onError(error.message); } };
      const describeFile = details => details ? String(details.size ?? "?") + " B · " + (details.modifiedAt ? new Date(details.modifiedAt).toLocaleString() : "时间未知") : "不存在";
      const join = (path, name) => `${path.replace(/[\\/]+$/, "")}/${name}`;
      const endpointName = pane => pane.kind === "host" ? "DSH 主机" : environments.find(env => env.id === pane.environment)?.name ?? "SSH 环境";
      const selectFile = (side, item, event) => {
        const entries = visibleEntries[side], anchor = entries.findIndex(entry => entry.name === selectionAnchor.current[side]), index = entries.indexOf(item);
        const range = (event.nativeEvent?.shiftKey || event.shiftKey) && anchor >= 0 ? entries.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).filter(entry => ["d", "-"].includes(entry.type)).map(entry => entry.name) : [item.name];
        if (!(event.nativeEvent?.shiftKey || event.shiftKey) || anchor < 0) selectionAnchor.current[side] = item.name;
        change(side, { selected: event.target.checked ? [...new Set([...panes[side].selected, ...range])] : panes[side].selected.filter(name => !range.includes(name)) });
      };
      const renderPane = (pane, side) => h("section", { className: "dsh-remote-ops__sftpPane", key: side, "data-focused": fileSide === side, "aria-label": side ? "文件目标 B" : "文件来源 A" },
        h("div", { className: "dsh-remote-ops__sftpPaneHead" }, h("strong", null, side ? "B" : "A"),
          h("select", { "aria-label": `位置 ${side ? "B" : "A"}`, value: pane.kind === "host" ? "host" : pane.environment, onChange: event => void load(side, initial(event.target.value === "host" ? "host" : "ssh", event.target.value === "host" ? "" : event.target.value)) }, h("option", { value: "host" }, "DSH 所在主机"), environments.map(env => h("option", { key: env.id, value: env.id }, env.name))),
          h("button", { title: "上级目录", "aria-label": `上级目录 ${side ? "B" : "A"}`, disabled: pane.loading, onClick: () => void load(side, { ...pane, path: join(pane.path, "..") }) }, "↑"),
          h("button", { title: "刷新目录", "aria-label": `刷新目录 ${side ? "B" : "A"}`, disabled: pane.loading, onClick: () => void load(side, pane) }, h(IconRefreshOutline16)),
          h("details",{className:"dsh-remote-ops__fileOptions"},h("summary",{"aria-label":"文件选项 "+(side?"B":"A")},"更多"),h("div",null,
          h("button", { title: "收藏当前路径", "aria-label": "收藏路径 " + (side ? "B" : "A"), "aria-pressed": bookmarks.some(item => sameFileLocation(item, pane)), disabled: !pane.loaded, onClick: () => bookmark(side) }, bookmarks.some(item => sameFileLocation(item, pane)) ? "★" : "☆"),
          h("select", { "aria-label": "路径书签 " + (side ? "B" : "A"), value: "", onChange: event => { if (event.target.value !== "") void load(side, { ...initial("host"), ...bookmarks[Number(event.target.value)] }); } }, h("option", { value: "" }, "书签"), bookmarks.map((item, index) => h("option", { key: index, value: index }, (item.kind === "host" ? "本机" : environments.find(env => env.id === item.environment)?.name ?? item.environment) + " · " + item.path))),
          h("select", { "aria-label": "排序 " + (side ? "B" : "A"), value: pane.sort, onChange: event => change(side, { sort: event.target.value }) }, h("option", { value: "name" }, "名称"), h("option", { value: "size" }, "大小"), h("option", { value: "modified" }, "修改时间")))),
        ),
        h("form", { className: "dsh-remote-ops__sftpPath", onSubmit: event => { event.preventDefault(); void load(side, { ...pane, path: pane.draft }); } }, h("input", { "aria-label": `路径 ${side ? "B" : "A"}`, disabled: pane.loading, value: pane.draft, onChange: event => change(side, { draft: event.target.value }) }), h("button", { title: "打开路径", "aria-label": "打开路径", disabled: pane.loading }, "→")),
        h("div", { className: "dsh-remote-ops__fileFilter" }, h("input", { type: "search", "aria-label": "筛选目录 " + (side ? "B" : "A"), placeholder: "筛选当前目录…", value: filters[side], onChange: event => setFilters(current => current.map((value, index) => index === side ? event.target.value : value)) }), h("label", null, h("input", { type: "checkbox", "aria-label": "全选 " + (side ? "B" : "A"), disabled: !pane.loaded, checked: visibleEntries[side].some(item => ["d", "-"].includes(item.type)) && visibleEntries[side].filter(item => ["d", "-"].includes(item.type)).every(item => pane.selected.includes(item.name)), onChange: event => { const names = visibleEntries[side].filter(item => ["d", "-"].includes(item.type)).map(item => item.name); change(side, { selected: event.target.checked ? [...new Set([...pane.selected, ...names])] : pane.selected.filter(name => !names.includes(name)) }); } }), "全选"), h("small", null, "已选 " + pane.selected.length)),
        pane.error ? h("div", { className: "dsh-remote-ops__fileError", role: "alert" }, h("span", null, pane.error.split("\n").at(-1)), h("button", { disabled: pane.loading, onClick: () => void load(side, pane) }, "重试目录")) : null,
        h("div", { className: "dsh-remote-ops__sftpEntries", ref: node => { lists.current[side] = node; }, onScroll: event => { if (!visible || pane.loading && !pane.loaded) return; scrolls.current[side] = event.currentTarget.scrollTop; clearTimeout(saveTimer.current); saveTimer.current = setTimeout(save, 300); }, "aria-busy": pane.loading }, pane.loading && !pane.loaded ? "加载中…" : visibleEntries[side].length ? visibleEntries[side].map(item => h("div", { className: "dsh-remote-ops__sftpEntry", key: item.name, "data-selected": pane.selected.includes(item.name) },
          h("input", { type: "checkbox", "aria-label": `选择 ${item.name}`, disabled: !["d", "-"].includes(item.type), checked: pane.selected.includes(item.name), onChange: event => selectFile(side, item, event) }),
          h("button", { className: "dsh-remote-ops__sftpName", onDoubleClick: () => { if (item.type === "d") void load(side, { ...pane, path: join(pane.path, item.name) }); }, onKeyDown: event => { if (event.key === "Enter" && item.type === "d") { event.preventDefault(); void load(side, { ...pane, path: join(pane.path, item.name) }); } }, title: item.name }, h("span", { className: "dsh-remote-ops__sftpIcon", "data-type": item.type === "d" ? "directory" : "file", "aria-hidden": true }, item.type === "d" ? h(IconFolderClose16) : h(FileIcon)), h("span", { className: "dsh-remote-ops__sftpLabel" }, item.name)),
          h("span", { className: "dsh-remote-ops__sftpSize" }, item.type === "d" ? "" : `${(item.size / 1024).toFixed(1)} K`),
          item.modifiedAt ? h("time", { className: "dsh-remote-ops__fileTime", title: new Date(item.modifiedAt).toLocaleString() }, new Date(item.modifiedAt).toLocaleDateString()) : null,
        )) : h("div", { className: "dsh-remote-ops__sftpEmpty" }, pane.error ? "目录暂不可用" : filters[side] ? "没有匹配的文件" : "空目录")),
        h("div", { className: "dsh-remote-ops__toolbar dsh-remote-ops__fileUpload" },
          h("label", { title: "从当前浏览器所在设备上传到此目录", "aria-label": "浏览器上传 " + (side ? "B" : "A") }, "上传本机文件", h("input", { type: "file", multiple: true, "aria-label": "上传文件 " + (side ? "B" : "A"), disabled: !sessionId || !pane.loaded || preparing || uploading, onChange: event => { const files = [...event.target.files]; event.target.value = ""; void browserUpload(side, files); } })),
          h("button", { hidden: pane.selected.length !== 1, disabled: !sessionId || pane.selected.length !== 1 || pane.entries.find(item => item.name === pane.selected[0])?.type !== "-", title: "下载到当前浏览器所在设备", onClick: () => { const link = document.createElement("a"); link.href = fileUrl(pane, pane.selected[0]); link.download = pane.selected[0]; link.click(); } }, h(IconDownloadOutline16), " 下载文件"),
        ),
      );
      const renderTransfer = task => h("div", { className: "dsh-remote-ops__transfer", key: task.id },
            h("span", null, task.names.join(", ") + " · " + { queued: "排队", running: "传输中", completed: "完成", cancelled: "已取消", failed: "失败" }[task.status] + " · " + (task.bytes / 1048576).toFixed(2) + " MiB"),
            ["queued", "running"].includes(task.status) ? h("button", { onClick: () => void invoke({ action: "transfer-cancel", id: task.id }).catch(error => onError(error.message)) }, "取消") : null,
            task.retryable ? h("button", { disabled: preparing, onClick: () => void retry(task) }, "重试未完成项") : null,
            task.counts?.completed ? h("button", { onClick: () => void reveal(task, task.items.find(item => item.status === "completed")) }, "定位") : null,
            task.error ? h("small", { className: "dsh-remote-ops__dangerAction" }, task.error.code + " · " + task.error.stage + " · " + task.error.message) : null,
            h("details", null, h("summary", null, "完成 " + (task.counts?.completed ?? 0) + " · 失败 " + (task.counts?.failed ?? 0) + " · 待处理 " + (task.counts?.pending ?? 0) + " · 跳过 " + (task.counts?.skipped ?? 0)),
              (task.items ?? []).map(item => h("div", { className: "dsh-remote-ops__transfer", key: item.name }, h("span", null, item.name + " · " + { completed: "完成", failed: "失败", pending: "待处理", running: "传输中", skipped: "跳过" }[item.status]), item.status === "completed" ? h("button", { title: "定位文件", onClick: () => void reveal(task, item) }, h(IconFolderClose16)) : null)),
              task.itemsTruncated ? h("small", null, "显示前 200 项") : null, task.error?.stack ? h("pre", null, task.error.stack) : null)
          );
      return h("section", { className: "dsh-remote-ops__sftpWorkspace" },
        h("div", { className: "dsh-remote-ops__sftpHead" }, h("strong", null, "文件传输"), h("span", { className: "dsh-remote-ops__muted" }, sessionId ? "" : "请先选择一个 DSH 会话"), null),
        h("div", { className: "dsh-remote-ops__toolbar dsh-remote-ops__fileActions", hidden: !panes.some(pane => pane.selected.length) }, [0, 1].map(side => h("button", { key: side, hidden: !panes[side].selected.length, className: "dsh-remote-ops__primary", "data-focused": fileSide === side, "aria-label": (side ? "B → A" : "A → B") + " · 复制到 " + endpointName(panes[1 - side]), disabled: !sessionId || !panes[side].selected.length || preparing || panes.some(pane => !pane.loaded), onClick: () => void transfer(side) }, "复制到 " + endpointName(panes[1 - side]) + (panes[side].selected.length ? ` (${panes[side].selected.length})` : ""))), h("label", null, "同名文件", h("select", { "aria-label": "同名文件策略", value: conflict, onChange: event => setConflict(event.target.value) }, h("option", { value: "error" }, "停止并报告"), h("option", { value: "skip" }, "跳过"), h("option", { value: "overwrite" }, "覆盖")))),
        h("div", { className: "dsh-remote-ops__fileSides", "aria-label": "文件位置" }, ["来源 A", "目标 B"].map((label, side) => h("button", { key: side, "aria-pressed": fileSide === side, onClick: () => setFileSide(side) }, label))),
        h("div", { className: "dsh-remote-ops__sftpSplit" }, panes.map(renderPane)),
        h("div", { className: "dsh-remote-ops__transfers", "aria-label": "传输任务" }, upload ? h("div", { className: "dsh-remote-ops__transfer", role: "status" }, h("span", null, `${upload.index}/${upload.count} · ${upload.name} · ${upload.bytes}/${upload.total} B · ${{ uploading: "上传中，可切换页面", cancelling: "正在取消", completed: "上传完成", cancelled: "已取消上传", failed: "上传失败" }[upload.status]}`), upload.total > 0 ? h("progress", { className: "dsh-remote-ops__uploadProgress", "aria-label": "上传字节进度", max: upload.total, value: Math.min(upload.bytes, upload.total) }) : null, uploading ? h("button", { disabled: upload.status === "cancelling", onClick: () => browserUploads.cancel(sessionId) }, "取消上传") : null, upload.error ? h("small", { className: "dsh-remote-ops__dangerAction" }, upload.error) : null) : null,
          tasks.filter(task => ["queued", "running", "failed"].includes(task.status)).slice().reverse().map(renderTransfer),
          tasks.some(task => !["queued", "running", "failed"].includes(task.status)) ? h("details", { className: "dsh-remote-ops__transferHistory" }, h("summary", null, "已结束的传输 · " + tasks.filter(task => !["queued", "running", "failed"].includes(task.status)).length), tasks.filter(task => !["queued", "running", "failed"].includes(task.status)).slice().reverse().map(renderTransfer)) : null, tasks.length || upload ? null : "暂无传输任务"),
        preview ? h(ModalDialog, { title: "确认覆盖", closeLabel: "取消覆盖", onClose: () => finishPreview(false) },
          h("strong", null, "覆盖 " + preview.conflictCount + " 个同名项目"),
          h("small", null, (preview.source.path ?? "浏览器") + " → " + preview.target.path),
          preview.conflicts.map(item => h("div", { key: item.name }, h("strong", null, item.name), h("div", null, "来源：" + describeFile(item.source)), h("div", null, "目标：" + describeFile(item.target)))),
          preview.truncated ? h("small", null, "仅显示前 200 个冲突") : null,
          h("div", { className: "dsh-remote-ops__formActions" }, h("button", { onClick: () => finishPreview(false) }, "取消"), h("button", { className: "dsh-remote-ops__dangerAction", onClick: () => finishPreview(true) }, "确认覆盖"))) : null,
      );
    }
    const MemoFileWorkspace = typeof React !== "undefined" && React.memo ? React.memo(SftpWorkspace) : SftpWorkspace;
    function CommandDialog({ sessionId, target, onClose }) {
      const key = sessionId + ":" + target.sessionId, draft = commandDrafts.get(key) ?? {};
      const [command, setCommand] = useState(draft.command ?? ""), [timeout, setTimeoutSeconds] = useState(draft.timeout ?? 30);
      const [job, setJob] = useState(null), [requestId, setRequestId] = useState(""), [pending, setPending] = useState(false), [loadingResult, setLoadingResult] = useState(true), [failure, setFailure] = useState(""), [stream, setStream] = useState("stdout");
      const alive = useRef(true), revision = useRef(0), starting = useRef(false), receipt = useRef(draft.receipt ?? null);
      const running = job?.status === "running", result = job?.result;
      const invoke = useCallback((body, signal) => request("/api/dsh-remote-ops/workspace", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId, session: target.sessionId }) }), [sessionId, target.sessionId]);
      useEffect(() => { commandDrafts.set(key, { command, timeout, receipt: receipt.current }); if (commandDrafts.size > 32) commandDrafts.delete(commandDrafts.keys().next().value); }, [key, command, timeout, pending]);
      useEffect(() => {
        let stopped = false, timer; const controller = new AbortController(), ticket = ++revision.current; alive.current = true;
        const poll = async () => {
          try {
            if (document.hidden) { timer = setTimeout(poll, 3000); return; }
            if (!requestId) {
              const latest = (await invoke({ action: "command-list" }, controller.signal)).jobs.at(-1);
              if (stopped || ticket !== revision.current) return;
              setJob(latest ?? null); if (latest) setRequestId(latest.requestId); else setLoadingResult(false);
              return;
            }
            const value = await invoke({ action: "command-status", requestId }, controller.signal);
            if (stopped || ticket !== revision.current) return;
            setJob(value ?? null); setLoadingResult(false); if (value?.failure) setFailure(value.failure);
            if (value?.status === "running") timer = setTimeout(poll, 750);
          } catch (error) { if (!stopped && error.name !== "AbortError" && ticket === revision.current) { setLoadingResult(false); setFailure(error.message); timer = setTimeout(poll, 3000); } }
        };
        void poll();
        return () => { stopped = true; alive.current = false; clearTimeout(timer); controller.abort(); };
      }, [invoke, requestId]);
      const execute = async event => {
        event.preventDefault(); if (loadingResult || starting.current || running || !command.trim()) return;
        starting.current = true; revision.current++; setPending(true); setFailure(""); setJob(null); setStream("stdout");
        const identity = JSON.stringify([command, timeout]);
        const id = receipt.current?.identity === identity ? receipt.current.id : window.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
        receipt.current = { identity, id }; commandDrafts.set(key, { command, timeout, receipt: receipt.current });
        try { const value = await invoke({ action: "command-start", command, timeoutSeconds: timeout, requestId: id }); receipt.current = null; commandDrafts.set(key, { command, timeout, receipt: null }); if (alive.current) { setJob(value); setRequestId(value.requestId); } }
        catch (error) { if (alive.current) setFailure(error.message + "\n请求结果未确认；重试会使用同一请求编号，不会重复执行。也可关闭后重开查看最近结果。"); }
        finally { starting.current = false; if (alive.current) setPending(false); }
      };
      return h(ModalDialog, { title: "独立命令 · " + target.name, closeLabel: "关闭独立命令", onClose },
        h("small", { className: "dsh-remote-ops__muted" }, "独立进程 · 不继承交互终端的目录和临时变量"),
        h("details", null, h("summary", null, "执行目录与结果保留"), h("p", null, "工作目录：" + (target.kind === "local" ? target.workingDirectory : "SSH 服务默认目录") + "。结果仅在本次 DSH 运行中保留，最多 10 分钟；重启后不会恢复或重跑。")),
        h("form", { onSubmit: execute }, h("textarea", { autoFocus: true, required: true, maxLength: 32768, "aria-label": "独立命令内容", spellCheck: false, disabled: pending || running, value: command, onChange: event => setCommand(event.target.value) }),
          h("div", { className: "dsh-remote-ops__toolbar" }, h("label", null, "超时（秒）", h("input", { type: "number", required: true, min: 1, max: 300, value: timeout, disabled: pending || running, onChange: event => setTimeoutSeconds(Number(event.target.value)) })),
            h("button", { type: "submit", className: "dsh-remote-ops__primary", disabled: loadingResult || pending || running || !command.trim() }, h(IconPlayOutline16), loadingResult ? " 同步结果…" : pending ? " 提交中…" : running ? " 执行中…" : " 执行"))),
        job ? h("small", { className: "dsh-remote-ops__muted" }, "最近任务 · " + new Date(job.startedAt).toLocaleString()) : null,
        failure ? h("pre", { className: "dsh-remote-ops__dangerAction", role: "alert" }, failure) : null,
        running ? h("div", { role: "status" }, "执行中，关闭此视图后继续运行。") : null,
        result ? h(React.Fragment, null,
          h("strong", { role: "status" }, ({ completed: "已退出", failed: "执行失败", cancelled: "已取消", timed_out: "已超时", unknown: "退出未知" }[result.status] ?? result.status) + " · 退出码 " + (result.exitCode ?? "未知") + " · " + result.durationMs + " ms"),
          result.completion === "unknown" ? h("small", { className: "dsh-remote-ops__dangerAction" }, "未确认命令完成；远程进程可能仍在运行，不会自动重试。") : null,
          h("div", { className: "dsh-remote-ops__resultTabs", role: "tablist", "aria-label": "命令输出" }, ["stdout", "stderr"].map((kind, index) => h("button", { key: kind, role: "tab", id: "command-" + kind, "aria-selected": stream === kind, "aria-controls": "command-result", tabIndex: stream === kind ? 0 : -1, onClick: () => setStream(kind), onKeyDown: event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index; setStream(["stdout", "stderr"][next]); event.currentTarget.parentElement.children[next]?.focus(); } } }, kind + (result[kind + "Truncated"] ? " · 已截断" : "")))),
          h("pre", { id: "command-result", role: "tabpanel", "aria-labelledby": "command-" + stream, className: "dsh-remote-ops__commandOutput" }, result[stream] || "（空）")) : null);
    }
    const terminalDraftPending = (pending, text) => {
      for (const char of text) { if (/[\r\n\u0003]/.test(char)) pending = false; else if (char >= " " || char === "\t" || char === "\u001b") pending = true; }
      return pending;
    };
    const sharedManualDrafts = new Map();
    const rememberTerminalDraft = (key, pending) => {
      const endpoint = key.slice(0, key.lastIndexOf(":") + 1);
      for (const previous of sharedManualDrafts.keys()) if (previous !== key && previous.startsWith(endpoint)) sharedManualDrafts.delete(previous);
      if (!pending) { sharedManualDrafts.delete(key); return true; }
      if (!sharedManualDrafts.has(key) && sharedManualDrafts.size >= 256) return false;
      sharedManualDrafts.set(key, true);
      return true;
    };
    const draftLimitMessage = "TERMINAL_DRAFT_LIMIT: 未提交输入的终端过多，请先完成或取消已有终端输入。";
    const quickPaneHeight = (value, availableHeight, terminalReserve) => Math.max(0, Math.min(Math.max(92, Number(value) || 190), Math.max(0, availableHeight - terminalReserve)));
    const quickCommandList = (commands, query = "", group = "", pinnedOnly = true) => commands.filter(item => (!pinnedOnly || item.pinned !== false) && (!group || item.group === group) && `${item.name}\n${item.command}\n${item.group}`.toLowerCase().includes(query.trim().toLowerCase())).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const quickDispatchDraft = (command, target, frame, owner, requestId) => ({ commandId: command.id, command: command.command, name: command.name, revision: command.revision, session: target?.sessionId, targetName: target?.name, streamId: frame?.streamId, owner, requestId });
    const quickDraftValid = (draft, owner, session, streamId) => Boolean(draft?.session && draft.streamId && draft.owner === owner && draft.session === session && draft.streamId === streamId);
    function ModalDialog({ title, onClose, children, closeLabel, closeDisabled = false }) {
      const dialog = useRef(null), close = useRef(onClose), previous = useRef(document.activeElement); close.current = onClose;
      useEffect(() => {
        dialog.current?.querySelector("[data-autofocus],textarea,input,button,select")?.focus({ preventScroll: true });
        return () => { if (previous.current?.isConnected) previous.current.focus({ preventScroll: true }); };
      }, []);
      const key = event => {
        if (event.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!closeDisabled) close.current(); }
        if (event.key !== "Tab") return;
        const controls = [...(dialog.current?.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']") ?? [])].filter(node => !node.closest?.("[hidden]") && (!node.getClientRects || node.getClientRects().length));
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); dialog.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      };
      return h("div", { className: "dsh-remote-ops__modalBackdrop" }, h("section", { className: "dsh-remote-ops__modal", role: "dialog", "aria-modal": false, "aria-label": title, tabIndex: -1, ref: dialog, onKeyDown: key },
        h("div", { className: "dsh-remote-ops__quickModalHead" }, h("strong", null, title), h("button", { type: "button", className: "dsh-remote-ops__drawerClose", "aria-label": closeLabel ?? `关闭${title}`, disabled: closeDisabled, onClick: onClose }, h(IconCloseOutline16, { "aria-hidden": true }))), children));
    }
    function UpdateDialog({ onClose, onStatus, embedded = false, visible = true }) {
      const [data, setData] = useState(null), [draft, setDraft] = useState({ source: "github", url: "" });
      const [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
      const alive = useRef(true), actionLock = useRef(false);
      const changeDraft = value => { setDraft(value); setNotice(""); setError(""); };
      const accept = value => { if (alive.current) { setData(value); onStatus(value); } };
      useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
      useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        request("/api/dsh-remote-ops/update").then(value => { if (!cancelled && alive.current) {
          accept(value);
          setDraft(current => data?.settings && ["source", "url"].some(key => current[key] !== data.settings[key]) ? current : value.settings);
        } }).catch(cause => { if (!cancelled && alive.current) setError(cause.message); });
        return () => { cancelled = true; };
      }, [visible]);
      useEffect(() => {
        if (!pending && !data?.busy) return;
        let stopped = false, timer;
        const poll = async () => {
          try { const value = await request("/api/dsh-remote-ops/update"); if (!stopped) accept(value); }
          catch { /* The action response reports failures; polling never retries installation. */ }
          if (!stopped) timer = setTimeout(poll, 1000);
        };
        timer = setTimeout(poll, 500);
        return () => { stopped = true; clearTimeout(timer); };
      }, [pending, data?.busy]);
      const run = async action => {
        if (actionLock.current) return;
        actionLock.current = true; setPending(true); setError(""); setNotice("");
        try {
          const value = await request("/api/dsh-remote-ops/update", { method: "POST", body: JSON.stringify({ action, ...(action === "settings" ? { settings: draft } : {}) }) });
          if (!alive.current) return;
          accept(value);
          if (action === "settings") { setDraft(value.settings); setNotice("更新来源已保存"); }
          else if (value.hotReload?.pending) setNotice(`已安装 v${value.installedVersion}，任务结束后自动应用，无需重启 DSH`);
          else if (value.restartRequired) setNotice(`已安装 v${value.installedVersion}，请在任务结束后手动重启 DSH 并刷新网页`);
          else setNotice(value.updateAvailable ? `发现新版本 v${value.latestVersion}` : `当前已是最新版本 v${value.currentVersion}`);
        } catch (cause) { if (alive.current) setError(cause.message); }
        finally {
          try { const value = await request("/api/dsh-remote-ops/update"); accept(value); } catch { /* Keep the original action result. */ }
          actionLock.current = false; if (alive.current) setPending(false);
        }
      };
      const busy = pending || data?.busy;
      const dirty = data && ["source", ...(draft.source === "custom" ? ["url"] : [])].some(key => draft[key] !== data.settings[key]);
      const phases = { checking: "正在检查版本…", downloading: "正在下载安装包…", verifying: "正在校验安装包…", installing: "正在安装，请稍候…", ready: "安装完成", waiting: "等待任务结束后自动应用…", preparing: "正在准备新版运行环境…", reloading: "正在应用新版…", applied: "新版已生效，无需重启 DSH", "reload-failed": "热加载未完成", "restart-required": "此版本需要重启 DSH", failed: "更新未完成", idle: "" };
      const updateError = error || (data?.error ? data.requestFailure ? formatRequestFailure(data.requestFailure) : `插件更新失败\n${safeDiagnosticText(data.error)}` : "");
      return h(embedded ? "section" : ModalDialog, embedded ? { className: "dsh-remote-ops__settingsBody", "aria-label": "插件更新" } : { title: "插件更新", onClose },
        h("p", { className: "dsh-remote-ops__muted" }, "手动检查并安装更新。任务结束后自动热加载，保留当前对话、连接和已保存配置。"),
        data ? h(React.Fragment, null,
          h("div", { className: "dsh-remote-ops__updateVersions" }, h("span", null, "当前运行", h("strong", null, `v${data.currentVersion}`)), h("span", null, "已安装", h("strong", null, `v${data.installedVersion}`))),
          data.hotReload?.pending ? h("p", { role: "status" }, data.hotReload.blockers.length ? `等待：${data.hotReload.blockers.join("、")}。完成后自动应用。` : "即将应用新版，请稍候…") : null,
          data.restartRequired ? h("p", { role: "status" }, "新版已安装，请手动重启 DSH 并刷新网页。") : null,
          h("form", { onSubmit: event => { event.preventDefault(); void run("settings"); } },
            h("label", null, "更新来源", h("select", { "aria-label": "更新来源", value: draft.source, disabled: busy, onChange: event => changeDraft({ ...draft, source: event.target.value }) }, h("option", { value: "github" }, "GitHub Release"), h("option", { value: "custom" }, "HTTP / HTTPS 地址"))),
            draft.source === "custom" ? h("label", null, "内网更新地址", h("input", { type: "url", required: true, "aria-label": "内网更新地址", placeholder: "https://updates.example.internal/remote-ops/", value: draft.url ?? "", disabled: busy, onChange: event => changeDraft({ ...draft, url: event.target.value }) })) : null,
            h("p", { className: "dsh-remote-ops__muted" }, draft.source === "github" ? "从官方 GitHub Release 获取 tgz 和 SHA256。" : "填写更新目录或 latest.json 地址。"),
            h("div", { className: "dsh-remote-ops__webActions" }, h("button", { type: "submit", disabled: busy || (!dirty && !data.error) }, "保存更新来源"))),
          data.checkedAt ? h("p", { className: "dsh-remote-ops__muted" }, `最近检查：${new Date(data.checkedAt).toLocaleString()}`) : null,
          h("div", { className: "dsh-remote-ops__webActions" },
            h("button", { type: "button", disabled: busy || dirty || data.restartRequired || !data.canInstall, className: "dsh-remote-ops__primaryAction", onClick: () => void run("install") }, data.needsActivation && !data.restartRequired ? "重试应用已安装版本" : "检查并更新"),
            h("button", { type: "button", disabled: busy || dirty || data.restartRequired, onClick: () => void run("check") }, "仅检查版本")),
          dirty ? h("p", { className: "dsh-remote-ops__muted" }, "请先保存更新来源。") : null,
          !data.canInstall ? h("p", null, "当前 DSH 未提供插件管理服务，可检查版本并通过 dsh plugin 手动安装。") : null,
          busy || data.phase === "applied" ? h("p", { role: "status", "aria-live": "polite" }, phases[data.phase] || "正在处理…") : null
        ) : h("p", { role: "status" }, error ? "无法读取更新配置" : "正在读取更新配置…"),
        notice ? h("p", { role: "status" }, notice) : null,
        updateError ? h("div", { role: "alert", className: "dsh-remote-ops__dangerAction", style: { overflowWrap: "anywhere" } }, requestErrorDetails(updateError)) : null,
      );
    }
    function QuestionDialog({ question, onDone }) {
      const [value, setValue] = useState(question.initial ?? "");
      return h(ModalDialog, { title: question.input ? "编辑名称" : "确认操作", closeLabel: "关闭确认", onClose: () => onDone(null) },
        h("form", { onSubmit: event => { event.preventDefault(); onDone(question.input ? value.trim() : true); } },
          question.input ? h("label", null, question.message, h("input", { "aria-label": question.message, autoFocus: true, required: true, maxLength: 120, value, onChange: event => setValue(event.target.value) })) : h("p", null, question.message),
          h("div", { className: "dsh-remote-ops__formActions" }, h("button", { type: "button", onClick: () => onDone(null) }, "取消"), h("button", { type: "submit", className: question.input ? "dsh-remote-ops__primary" : /删除|放弃|关闭连接/.test(question.message) ? "dsh-remote-ops__dangerAction" : "dsh-remote-ops__primary", disabled: question.input && !value.trim() }, "确认"))));
    }
    function usePanelQuestion(owner) {
      const [question, setQuestion] = useState(null), pending = useRef(null);
      useEffect(() => () => { pending.current?.resolve(null); pending.current = null; }, [owner]);
      const askPanel = useCallback((message, initial) => new Promise(resolve => {
        pending.current?.resolve(null);
        const next = { id: window.crypto?.randomUUID?.() ?? Math.random().toString(36), message, initial, input: initial !== undefined, resolve };
        pending.current = next; setQuestion(next);
      }), []);
      const done = value => { const current = pending.current; pending.current = null; setQuestion(null); current?.resolve(value); };
      return [askPanel, question ? h(QuestionDialog, { key: question.id, question, onDone: done }) : null];
    }
    function QuickCommands({ commands, groups, owner, target, frame, ready, open, setOpen, height, setHeight, action, workspaceAction, inputPending, onSending, hidden = false }) {
      const [query, setQuery] = useState("");
      const [group, setGroup] = useState("");
      const [manager, setManager] = useState(false);
      const [editor, setEditor] = useState(null);
      const [confirmation, setConfirmation] = useState(null);
      const [receipt, setReceipt] = useState(null);
      const [pending, setPending] = useState(false);
      const [saving, setSaving] = useState(false);
      const [pinDraft, setPinDraft] = useState(null);
      const [failure, setFailure] = useState("");
      const [bounds, setBounds] = useState({ available: 800, reserve: 240 });
      const dock = useRef(null), drag = useRef(null), sending = useRef(false), editing = useRef(false);
      const current = useRef(null);
      current.current = { owner, target, frame, ready, commands, hidden };
      const visibleHeight = quickPaneHeight(height, bounds.available, bounds.reserve);
      useEffect(() => {
        const node = dock.current, parent = node?.parentElement;
        if (!parent) return;
        const terminal = parent.querySelector(".dsh-remote-ops__terminal"), screen = parent.querySelector(".dsh-remote-ops__screen");
        const measure = () => setBounds({ available: parent.clientHeight, reserve: Math.max(160, (terminal?.clientHeight ?? 0) - (screen?.clientHeight ?? 0) + 100) });
        const observer = new ResizeObserver(measure);
        observer.observe(parent); if (terminal) observer.observe(terminal);
        measure(); return () => observer.disconnect();
      }, [open, hidden]);
      useEffect(() => { setConfirmation(null); setReceipt(null); setFailure(""); }, [owner]);
      useEffect(() => { if (group && !groups.includes(group)) setGroup(""); }, [groups, group]);
      useEffect(() => { if (pinDraft && commands.some(item => item.id === pinDraft.id && item.pinned === pinDraft.pinned)) setPinDraft(null); }, [commands, pinDraft]);
      const [askPanel, panelQuestion] = usePanelQuestion(owner);
      const modalOpen = Boolean(manager || editor || confirmation);

      const iconButton = (label, Icon, onClick, disabled = false, extra = {}) => h("button", { type: "button", className: "dsh-remote-ops__quickIcon", "aria-label": label, title: label, disabled, onClick, ...extra }, h(Icon, { "aria-hidden": true }));
      const closeEditor = async () => { if (!saving && (!editor || JSON.stringify(editor.value) === editor.original || await askPanel("放弃未保存的修改？"))) { setEditor(null); setFailure(""); } };
      const closeModal = () => { if (saving || pending) return; if (editor) closeEditor(); else { setManager(false); setConfirmation(null); setFailure(""); } };
      const modal = (title, content) => h(ModalDialog, { title, closeLabel: "关闭快捷命令弹窗", onClose: closeModal, closeDisabled: saving || pending }, content, failure ? h("pre", { role: "alert", className: "dsh-remote-ops__dangerAction" }, failure) : null);
      const startEditor = item => {
        const value = { id: item?.id ?? crypto.randomUUID(), name: item?.name ?? "", command: item?.command ?? "", group: item?.group ?? (group || groups[0] || "常用"), pinned: item?.pinned ?? true, confirm: item?.confirm ?? false, ...(item?.revision ? { expectedRevision: item.revision } : {}) };
        setEditor({ value, original: JSON.stringify(value), existing: Boolean(item) }); setFailure("");
      };
      const change = (field, value) => setEditor(previous => ({ ...previous, value: { ...previous.value, [field]: value } }));
      const mutate = async (body, workspace = false) => {
        if (editing.current) return;
        editing.current = true; setSaving(true); setFailure("");
        try {
          const result = await (workspace ? workspaceAction(body) : action(body));
          if (!result) setFailure("保存失败，详情见插件错误信息；更改尚未确认。");
          return result;
        } finally { editing.current = false; setSaving(false); }
      };
      const send = async (draft, confirmed = false) => {
        if (sending.current) return;
        const view = current.current;
        if (view.hidden || !view.ready || !quickDraftValid(draft, view.owner, view.target?.sessionId, view.frame?.streamId) || !view.commands.some(item => item.id === draft.commandId && item.revision === draft.revision)) { setFailure("QUICK_TARGET_CHANGED: 终端或命令已改变，请重新选择。"); return; }
        if (inputPending()) { setFailure("TERMINAL_INPUT_PENDING: 终端仍有未提交输入，请先完成或取消输入。"); return; }
        sending.current = true; onSending?.(true); setPending(true); setFailure(""); setReceipt(null);
        try {
          const value = await request("/api/dsh-remote-ops/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "quick.dispatch", sessionId: draft.owner, session: draft.session, streamId: draft.streamId, commandId: draft.commandId, revision: draft.revision, requestId: draft.requestId, confirmed }) });
          if (current.current.owner !== draft.owner) return;
          setReceipt({ ...value, label: `${draft.name} · ${draft.targetName}` }); setConfirmation(null);
        } catch (cause) {
          if (current.current.owner === draft.owner) { setReceipt({ status: cause.code ? "failed" : "unknown", label: `${draft.name} · ${draft.targetName}`, error: { details: cause.message } }); setConfirmation(null); }
        } finally { sending.current = false; onSending?.(false); setPending(false); }
      };
      const run = (item, event) => {
        if (sending.current || event?.detail > 1) return;
        const draft = quickDispatchDraft(item, target, frame, owner, crypto.randomUUID());
        setFailure("");
        if (item.confirm) { setConfirmation(draft); return; }
        return send(draft);
      };
      const resize = event => {
        if (event.button !== 0 || !open) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, y: event.clientY, height: visibleHeight };
      };
      const filters = h("div", { className: "dsh-remote-ops__quickFilters" }, h("input", { type: "search", "aria-label": "搜索快捷命令", placeholder: "搜索命令", value: query, onChange: event => setQuery(event.target.value) }), h("select", { "aria-label": "快捷命令分组", value: group, onChange: event => setGroup(event.target.value) }, h("option", { value: "" }, "全部分组"), groups.map(name => h("option", { key: name, value: name }, name))));
      const items = quickCommandList(commands, query, group, true);
      const all = quickCommandList(commands, "", "", false);
      const editorView = editor ? modal(editor.existing ? "编辑快捷命令" : "新增快捷命令", h("form", { className: "dsh-remote-ops__quickForm", onSubmit: async event => { event.preventDefault(); if (!editor.value.name.trim() || !editor.value.command.trim()) return; if (await mutate({ action: "quick.save", command: editor.value })) setEditor(null); } },
        h("label", null, "名称", h("input", { value: editor.value.name, maxLength: 100, required: true, onChange: event => change("name", event.target.value) })),
        h("label", null, "命令", h("textarea", { value: editor.value.command, maxLength: 65536, required: true, spellCheck: false, onChange: event => change("command", event.target.value) })),
        h("label", null, "分组", h("input", { value: editor.value.group, list: "remote-ops-quick-groups", onChange: event => change("group", event.target.value) }), h("datalist", { id: "remote-ops-quick-groups" }, groups.map(name => h("option", { key: name, value: name })))),
        h("label", { className: "dsh-remote-ops__quickCheck" }, h("input", { type: "checkbox", checked: editor.value.pinned, onChange: event => change("pinned", event.target.checked) }), "显示为快捷按钮"),
        h("label", { className: "dsh-remote-ops__quickCheck" }, h("input", { type: "checkbox", checked: editor.value.confirm, onChange: event => change("confirm", event.target.checked) }), "执行前确认"),
        h("div", { className: "dsh-remote-ops__formActions" }, !editor.existing ? h("button", { type: "button", disabled: saving, onClick: () => { closeEditor(); setManager(true); } }, "已有命令") : null, h("button", { type: "button", disabled: saving, onClick: closeEditor }, "取消"), h("button", { type: "submit", disabled: saving || !editor.value.name.trim() || !editor.value.command.trim() }, saving ? "保存中…" : "保存")))) : null;
      const managerView = manager && !editor ? modal("管理快捷命令", h(React.Fragment, null, filters,
        h("div", { className: "dsh-remote-ops__toolbar" }, iconButton("新增快捷命令", IconPlusOutline16, () => startEditor(), saving), h("span", null, `${commands.length} 条`),
          h("button", { disabled: saving, onClick: async () => { const name = await askPanel("快捷命令分组名称", ""); if (name?.trim()) await mutate({ action: "quick-group.create", name: name.trim() }); } }, "新建分组"),
          iconButton("重命名分组", IconEditOutline16, async () => { const name = await askPanel("新的快捷命令分组名称", group); if (name?.trim() && name.trim() !== group && await mutate({ action: "quick-group.rename", group, name: name.trim() })) setGroup(name.trim()); }, saving || !group),
          iconButton("删除空分组", IconCloseOutline16, async () => { if (await askPanel(`删除空分组“${group}”？`)) await mutate({ action: "quick-group.delete", group }); }, saving || !group)),
        h("div", { className: "dsh-remote-ops__quickLibrary" }, quickCommandList(commands, query, group, false).map(item => h("div", { key: item.id, className: "dsh-remote-ops__quickLibraryRow" },
          h("input", { type: "checkbox", checked: pinDraft?.id === item.id ? pinDraft.pinned : item.pinned !== false, "aria-label": `显示按钮 ${item.name}`, disabled: saving || Boolean(pinDraft), onChange: async event => { const pinned = event.target.checked; setPinDraft({ id: item.id, pinned }); if (!await mutate({ action: "quick.save", command: { ...item, expectedRevision: item.revision, pinned } })) setPinDraft(null); } }),
          h("span", { title: item.command }, item.name, h("small", null, item.group, item.confirm ? " · 执行前确认" : "")),
          iconButton(`上移 ${item.name}`, IconChevronUpOutline14, () => mutate({ action: "quick.move", commandId: item.id, direction: -1 }, true), saving || all[0]?.id === item.id),
          iconButton(`下移 ${item.name}`, IconChevronDownOutline14, () => mutate({ action: "quick.move", commandId: item.id, direction: 1 }, true), saving || all.at(-1)?.id === item.id),
          iconButton(`编辑 ${item.name}`, IconEditOutline16, () => startEditor(item), saving),
          iconButton(`删除命令 ${item.name}`, IconCloseOutline16, async () => { if (await askPanel(`永久删除快捷命令“${item.name}”？`)) return mutate({ action: "quick.delete", commandId: item.id }); }, saving, { className: "dsh-remote-ops__quickIcon dsh-remote-ops__dangerAction" }))),
          commands.length ? null : h("p", null, "暂无命令")))) : null;
      const confirmView = confirmation ? modal("确认下发快捷命令", h(React.Fragment, null, h("strong", null, `${confirmation.name} → ${confirmation.targetName}`), h("small", { className: "dsh-remote-ops__sessionIdentity" }, confirmation.session), h("pre", null, confirmation.command), h("div", { className: "dsh-remote-ops__formActions" }, h("button", { disabled: pending, onClick: () => setConfirmation(null) }, "取消"), h("button", { "aria-label": "确认下发", disabled: pending || !quickDraftValid(confirmation, owner, target?.sessionId, frame?.streamId), onClick: () => send(confirmation, true) }, pending ? "下发中…" : "确认下发")))) : null;
      if (hidden) return null;
      return h("section", { ref: dock, className: "dsh-remote-ops__quickDock", "aria-label": "常用命令窗格", style: { height: open ? `${commands.length ? visibleHeight : 92}px` : "auto", maxHeight: open ? undefined : "100px" }, "data-open": open },
        open ? h("div", { className: "dsh-remote-ops__quickResize", role: "separator", tabIndex: 0, "aria-label": "调整快捷命令区域高度", "aria-orientation": "horizontal", "aria-valuemin": Math.min(92, visibleHeight), "aria-valuemax": Math.max(0, bounds.available - bounds.reserve), "aria-valuenow": Math.round(visibleHeight), title: "拖动调整高度；双击恢复默认", onPointerDown: resize, onPointerMove: event => { if (drag.current?.id === event.pointerId) setHeight(quickPaneHeight(drag.current.height + drag.current.y - event.clientY, bounds.available, bounds.reserve)); }, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; }, onDoubleClick: () => setHeight(190), onKeyDown: event => { const values = { ArrowUp: visibleHeight + 32, ArrowDown: visibleHeight - 32, Home: 92, End: bounds.available - bounds.reserve }; if (event.key in values) { event.preventDefault(); setHeight(quickPaneHeight(values[event.key], bounds.available, bounds.reserve)); } } }) : null,
        h("div", { className: "dsh-remote-ops__quickHead" }, iconButton(open ? "收起常用命令" : "展开常用命令", open ? IconChevronDownOutline14 : IconChevronUpOutline14, () => setOpen(!open), false, { "aria-expanded": open }), h("div", { className: "dsh-remote-ops__quickIdentity" }, h("strong", null, "常用命令"), h("small", { title: target?.sessionId }, target?.name ?? "未选择终端")), iconButton("新增快捷命令", IconPlusOutline16, () => startEditor()), h("button", {"aria-label":"管理快捷命令",onClick:()=>{setManager(true);setFailure("");}},"命令库")),
        open && commands.length ? filters : null,
        h("div", { className: "dsh-remote-ops__quickButtons" }, (open ? items : quickCommandList(commands, "", "", true)).length ? (open ? items : quickCommandList(commands, "", "", true)).map(item => h("button", { key: item.id, "aria-label": `执行 ${item.name}`, title: `${item.name}\n${item.command}${item.confirm ? "\n执行前确认" : ""}`, disabled: pending || !ready || target?.disconnected, "aria-busy": pending, onClick: event => run(item, event) }, h(IconPlayOutline16, { "aria-hidden": true }), h("span", null, item.name))) : h("div", { className: "dsh-remote-ops__quickEmpty" }, commands.length ? "没有匹配的快捷按钮" : "在命令库中添加常用命令")),
        pending ? h("div", { className: "dsh-remote-ops__quickReceipt", role: "status" }, "下发中…") : null,
        receipt ? h("div", { className: "dsh-remote-ops__quickReceipt", role: "status" }, `${receipt.label} · ${receipt.status === "written" ? "已写入终端" : receipt.status === "failed" ? "未下发" : "写入结果未知，请先检查终端"}`, receipt.error ? h("details", null, h("summary", null, "错误详情"), [receipt.error.code, receipt.error.stage, receipt.error.details].filter(Boolean).join("\n")) : null) : null,
        failure && !modalOpen ? h("div", { className: "dsh-remote-ops__quickReceipt dsh-remote-ops__dangerAction", role: "alert" }, failure) : null,
        editorView, managerView, confirmView, panelQuestion);
    }
    const webDrafts = new Map();

    const browserStatus = { running: "执行中", paused: "已暂停", pausing: "等待当前步骤结束", stopping: "等待当前步骤结束后停止", manual: "人工接管中", completed: "步骤已完成", failed: "执行失败", unknown: "结果待确认，请检查网页", stopped: "已停止" };
    const webTarget = () => ({ kind: "css", value: "" });
    function BrowserLiveView({ sessionId, browser, visible = true, zoom = "fit", viewportMode = browser.viewport?.mode ?? "panel" }) {
      const [frame,setFrame]=useState(null),[message,setMessage]=useState('正在连接网页画面…'),[size,setSize]=useState({width:0,height:0});
      const image=useRef(null),capture=useRef(null),surface=useRef(null),current=useRef(null),queue=useRef(Promise.resolve()),alive=useRef(true),composing=useRef(false);
      current.current={frame,browser,viewportMode,size};
      useEffect(()=>{const node=surface.current;if(!node)return;const measure=()=>setSize({width:node.clientWidth,height:node.clientHeight});const observer=new ResizeObserver(measure);observer.observe(node);measure();return()=>observer.disconnect();},[]);
      const resizeViewport=mode=>{
        queue.current=queue.current.then(async()=>{
          if(!alive.current||current.current.viewportMode!==mode)return;
          const measured=current.current.size;
          if(mode==='panel'&&(!measured.width||!measured.height))return;
          const viewport=mode==='desktop'?{mode}:{mode,width:Math.max(240,Math.min(1600,Math.floor(measured.width))),height:Math.max(180,Math.min(1200,Math.floor(measured.height)))};
          try{await request('/api/dsh-remote-ops/browser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'viewport',sessionId,browserId:browser.id,viewport})});}
          catch(error){if(alive.current)setMessage('视口调整失败 · '+error.message.split('\n')[0]);}
        });
      };
      useEffect(()=>{
        if(!visible||!size.width||!size.height)return;
        const timer=setTimeout(()=>resizeViewport(viewportMode),250);return()=>clearTimeout(timer);
      },[size.width,size.height,viewportMode,browser.id,browser.display,visible]);

      useEffect(()=>{
        if(!visible)return;
        let stopped=false,pending=false,timer,sequence=0;const controller=new AbortController();alive.current=true;setFrame(null);
        const poll=async()=>{
          if(stopped||pending)return;
          if(document.hidden){timer=setTimeout(poll,750);return;}
          pending=true;let failed=false;
          try {
            const value=await request(`/api/dsh-remote-ops/browser/frame?${new URLSearchParams({sessionId,browserId:browser.id,after:String(sequence)})}`,{signal:controller.signal});
            if(!stopped){if(!value.data){failed=true;setFrame(null);setMessage(value.closed?'浏览器已关闭或正在切换显示。':'等待新网页画面…');}else{sequence=value.sequence;setFrame(old=>old?.sequence===value.sequence?old:value);setMessage('');}}
          }catch(error){failed=true;if(!stopped&&error.name!=='AbortError')setMessage('画面重新连接中 · '+error.message.split('\n')[0]);}
          finally{pending=false;if(!stopped)timer=setTimeout(poll,failed?1000:20);}
        };
        const onVisible=()=>{if(!document.hidden){clearTimeout(timer);void poll();}};
        document.addEventListener('visibilitychange',onVisible);void poll();
        return()=>{stopped=true;alive.current=false;clearTimeout(timer);controller.abort();document.removeEventListener('visibilitychange',onVisible);};
      },[sessionId,browser.id,browser.activePageId,browser.display,visible]);
      const send=input=>{
        const saved=current.current;
        if(!saved.frame){setMessage('等待网页画面后即可操作。');return;}
        queue.current=queue.current.then(async()=>{
          if(!alive.current)return;
          if(current.current.frame?.pageId!==saved.frame.pageId||current.current.frame?.revision!==saved.frame.revision)return;
          try{await request('/api/dsh-remote-ops/browser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'input',sessionId,browserId:browser.id,input:{...input,pageId:saved.frame.pageId,revision:saved.frame.revision}})});}
          catch(error){if(alive.current)setMessage(error.message.split('\n')[0]);}
        });
      };
      const inputHandler=useRef(send);inputHandler.current=send;
      useEffect(()=>{
        const node=surface.current;if(!node)return;
        const wheel=event=>{event.preventDefault();inputHandler.current({kind:'wheel',x:Math.max(-3000,Math.min(3000,event.deltaX)),y:Math.max(-3000,Math.min(3000,event.deltaY))});};
        node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
      },[]);
      const key=event=>{
        if(event.ctrlKey&&event.key==='Escape'){event.preventDefault();event.stopPropagation();surface.current?.closest('section')?.querySelector('input[aria-label="网页地址"]')?.focus();return;}
        if(event.isComposing||event.nativeEvent?.isComposing||composing.current)return;
        if((event.ctrlKey||event.metaKey)&&['v','c','x'].includes(event.key.toLowerCase()))return;
        if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey)return;
        const names=['Enter','Tab','Backspace','Delete','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'];
        if(!names.includes(event.key)&&!((event.ctrlKey||event.metaKey||event.altKey)&&event.key.length===1))return;
        event.preventDefault();event.stopPropagation();send({kind:'key',key:[event.ctrlKey?'Control':'',event.metaKey?'Meta':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',event.key].filter(Boolean).join('+')});
      };
      const flush=event=>{if(composing.current)return;const value=event.currentTarget.value;event.currentTarget.value='';if(value)send({kind:'text',text:value});};
      return h('div',{className:'dsh-remote-ops__live'},
        h('div',{className:'dsh-remote-ops__liveTools'},h('span',{role:'status',title:'Ctrl+Esc 返回地址栏'},message||'实时画面')),
        h('div',{ref:surface,className:'dsh-remote-ops__liveSurface'},frame?h('img',{ref:image,alt:'网页实时画面','data-revision':frame.revision,draggable:false,src:'data:image/jpeg;base64,'+frame.data,style:{width:`${frame.width*(zoom==='fit'?Math.min(size.width/frame.width,size.height/frame.height,1):1)}px`,maxWidth:'none'},onContextMenu:event=>event.preventDefault(),onClick:event=>{
          const rect=image.current.getBoundingClientRect();capture.current?.focus({preventScroll:true});send({kind:'click',x:(event.clientX-rect.left)*frame.width/rect.width,y:(event.clientY-rect.top)*frame.height/rect.height,button:event.button===2?'right':event.button===1?'middle':'left',count:Math.min(2,event.detail||1)});
        }}):h('div',{className:'dsh-remote-ops__empty'},message),
        h('textarea',{ref:capture,className:'dsh-remote-ops__webCapture','aria-label':'网页键盘输入',autoComplete:'off',spellCheck:false,onKeyDown:key,onChange:flush,onCompositionStart:()=>{composing.current=true;},onCompositionEnd:event=>{composing.current=false;flush(event);},onPaste:event=>{event.preventDefault();const text=event.clipboardData.getData('text');if(text)send({kind:'text',text});}})));
    }
    const browserRuntimeSummary = runtime => {
      const state = mode => runtime.modes?.[mode]?.ready ? '已就绪' : '需安装';
      return `插件内：${state('embedded')} · 独立窗口：${state('window')}${runtime.browserVersion ? ` · Chromium ${runtime.browserVersion}` : ''}`;
    };
    function BrowserWorkspacePanel({ sessionId, visible = true, settings = false }) {
      const draft=webDrafts.get(sessionId)??{},[data,setData]=useState({sites:[],flows:[],sessions:[],preferences:{display:'embedded',browser:'chromium'},runtime:{}});
      const [viewportIntent,setViewportIntent]=useState(null),[zoom,setZoom]=useState(()=>{try{return localStorage.getItem('remote-ops.web-zoom')==='actual'?'actual':'fit';}catch{return 'fit';}});
      useEffect(()=>{try{localStorage.setItem('remote-ops.web-zoom',zoom);}catch{}},[zoom]);
      const [address,setAddress]=useState(draft.address??''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[library,setLibrary]=useState(false),[synced,setSynced]=useState(false),[utility,setUtility]=useState(''),[displayDraft,setDisplayDraft]=useState(null);
      const alive=useRef(true),pending=useRef(false),revision=useRef(0),signature=useRef(''),addressDirty=useRef(!!draft.addressDirty),seenPage=useRef('');
      const session=data.sessions.find(v=>!v.closed&&v.id===data.activeBrowserId)??data.sessions.find(v=>!v.closed),page=session?.pages.find(v=>v.id===session.activePageId),job=session?.job;
      const unfinished=job&&['running','paused','pausing','stopping','manual'].includes(job.status);
      const navigating=busy||!synced;
      useEffect(()=>{webDrafts.set(sessionId,{...webDrafts.get(sessionId),address,addressDirty:addressDirty.current});if(webDrafts.size>10)webDrafts.delete(webDrafts.keys().next().value);},[sessionId,address]);
      const load=useCallback(async signal=>{
        const ticket=++revision.current,value=await request(`/api/dsh-remote-ops/browser?sessionId=${encodeURIComponent(sessionId??'')}`,{signal});
        if(!alive.current||ticket!==revision.current)return;
        const next=JSON.stringify(value);if(next!==signature.current){signature.current=next;setData(value);}setSynced(true);
      },[sessionId]);
      useEffect(()=>{
        if(!visible&&!settings){setSynced(false);return;}
        let stopped=false,timer,inFlight=false;const controller=new AbortController();alive.current=true;
        const poll=async()=>{if(stopped||inFlight)return;inFlight=true;try{if(!document.hidden&&!pending.current)await load(controller.signal);}catch(failure){if(!stopped&&failure.name!=='AbortError')setError(failure.message);}finally{inFlight=false;if(!stopped)timer=setTimeout(poll,1000);}};
        const onVisible=()=>{if(!document.hidden){clearTimeout(timer);void poll();}};document.addEventListener('visibilitychange',onVisible);void poll();
        return()=>{stopped=true;clearTimeout(timer);controller.abort();document.removeEventListener('visibilitychange',onVisible);};
      },[load,visible,settings]);
      useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
      useEffect(()=>{const identity=`${session?.id}:${page?.id}:${page?.url}`;if(identity!==seenPage.current){seenPage.current=identity;if(!addressDirty.current&&page?.url)setAddress(page.url==='about:blank'?'':page.url.replace(/\?\[redacted\]$/,''));}},[session?.id,page?.id,page?.url]);
      const action=async body=>{
        if(!synced||pending.current)return;pending.current=true;setBusy(true);setError('');revision.current++;
        try{const value=await request('/api/dsh-remote-ops/browser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,browserId:session?.id,...body})});if(alive.current){await load();return value.result;}}
        catch(failure){if(alive.current)setError(failure.message);}finally{pending.current=false;if(alive.current)setBusy(false);}
      };
      const go=async event=>{event.preventDefault();let url=address.trim();if(!/^[a-zA-Z][\w+.-]*:/.test(url))url='https://'+url;const result=await action(session?{action:'navigate',url}:{action:'open-url',url});if(result){addressDirty.current=false;webDrafts.set(sessionId,{...webDrafts.get(sessionId),addressDirty:false});setAddress(result.pages.find(v=>v.active)?.url.replace(/\?\[redacted\]$/,'')??url);}};
      const nav=(label,glyph,navigation)=>h('button',{type:'button',title:label,'aria-label':label,disabled:!session||navigating,onClick:()=>action({action:'navigate',navigation})},glyph);
      const closeUtility = () => setUtility('');
      const changeDisplay = display => {
        if (display === (session?.display ?? data.preferences.display)) return;
        if (session) setDisplayDraft({ browserId: session.id, display });
        else void action({action:'preferences.save',preferences:{display}});
      };
      const applyDisplay = async () => {
        if (!displayDraft || busy || !synced || unfinished) return;
        if (session?.id !== displayDraft.browserId) { setDisplayDraft(null); setError('活动浏览器已改变，请重新选择显示方式。'); return; }
        const result = await action({action:'display',browserId:displayDraft.browserId,display:displayDraft.display});
        if (result) setDisplayDraft(null);
      };
      return h('section',{className:'dsh-remote-ops__web dsh-remote-ops__webBrowser','aria-label':'网页操作','aria-busy':navigating},
        h('div',{className:'dsh-remote-ops__webMain',hidden:settings||utility==='library'},
          h('div',{className:'dsh-remote-ops__webContext'},
            h('div',{className:'dsh-remote-ops__webContextPages'},
              data.sessions.filter(v=>!v.closed).length>1 ? h('select',{'aria-label':'活动浏览器',value:session?.id,disabled:navigating,onChange:event=>action({action:'select-browser',browserId:event.target.value})},data.sessions.filter(v=>!v.closed).map(v=>h('option',{key:v.id,value:v.id},v.name))) : null,
              session?h('div',{className:'dsh-remote-ops__webPagesBar'},h('div',{className:'dsh-remote-ops__webPages',role:'tablist','aria-label':'网页标签页'},session.pages.map(item=>h('button',{key:item.id,id:'web-tab-'+item.id,role:'tab','aria-controls':'web-panel-'+session.id,'aria-selected':item.id===session.activePageId,tabIndex:item.id===session.activePageId?0:-1,disabled:navigating,title:item.url,onClick:()=>action({action:'control',control:'select-page',value:item.id}),onKeyDown:event=>{const index=session.pages.findIndex(v=>v.id===item.id),next={ArrowRight:(index+1)%session.pages.length,ArrowLeft:(index+session.pages.length-1)%session.pages.length,Home:0,End:session.pages.length-1}[event.key];if(next!==undefined){event.preventDefault();void action({action:'control',control:'select-page',value:session.pages[next].id});event.currentTarget.parentElement.children[next]?.focus();}}},item.title||(item.url==='about:blank'?'新标签页':item.url.replace(/^https?:\/\//,''))))),nav('新建网页','＋','new-page'),h('button',{type:'button','aria-label':'关闭当前网页',title:'关闭当前标签页',disabled:navigating,onClick:()=>action({action:'control',control:'close-page',value:session.activePageId})},h(IconCloseOutline16))):null),
            h('select',{'aria-label':'网页显示方式',value:session?.display??data.preferences.display,disabled:navigating||!!unfinished,onChange:event=>changeDisplay(event.target.value)},h('option',{value:'embedded'},'插件内'),h('option',{value:'window'},'独立窗口')),
            h('button',{type:'button',className:'dsh-remote-ops__webSettingsTrigger','aria-label':'收藏网站与流程',onClick:()=>{setLibrary(true);setUtility('library');}},'收藏')),
        h('form',{className:'dsh-remote-ops__webAddress',onSubmit:go},nav('网页后退','←','back'),nav('网页前进','→','forward'),nav('刷新网页','↻','reload'),h('input',{'aria-label':'网页地址',placeholder:'输入网址，按 Enter 打开',value:address,onChange:event=>{addressDirty.current=true;setAddress(event.target.value);},required:true,disabled:navigating}),h('button',{type:'submit','aria-label':'打开网页',className:'dsh-remote-ops__primary',disabled:!sessionId||navigating||!address.trim()},busy?'打开中…':'打开')),
        error?h('div',{className:'dsh-remote-ops__webError',role:'alert'},error.split('\n').slice(1).join(' · ')||error,!synced?h('button',{onClick:()=>{setError('');void load().catch(failure=>{if(alive.current)setError(failure.message);});}},'重试读取网页状态'):null):null,
        session?.dialog?h('div',{className:'dsh-remote-ops__webNotice'},`网页弹窗：${session.dialog.message}。请在主对话告诉 Agent 如何处理。`):null,
        h('div',{className:'dsh-remote-ops__webPage',role:session?'tabpanel':undefined,id:session?'web-panel-'+session.id:undefined,'aria-labelledby':session?'web-tab-'+session.activePageId:undefined},session?.display==='embedded'?h(BrowserLiveView,{key:session.id,sessionId,browser:session,visible:visible&&!settings&&utility!=='library',zoom,viewportMode:viewportIntent??session.viewport?.mode??data.preferences.viewport??'panel'}):session?h('div',{className:'dsh-remote-ops__webWindow'},h('p',null,'网页正在独立浏览器窗口中显示。'),h('button',{disabled:navigating,onClick:()=>action({action:'control',control:'focus'})},'显示浏览器')):h('div',{className:'dsh-remote-ops__webWelcome'},h(BrowserIcon,{size:26}),h('strong',null,synced?'打开网页，直接开始':'正在读取网页状态…'),h('p',null,'无需先保存网站或编排流程。'))),

          h('div',{className:'dsh-remote-ops__webState',role:'status'},
            h('span',null,session?(job?browserStatus[job.status]:'网页已打开'):'输入网址开始浏览'),job?h('span',{className:'dsh-remote-ops__muted'},`${job.index}/${job.count} 步`):null,
            session?.notice?h('details',null,h('summary',null,'提示'),h('p',null,session.notice)):null,
            job?h('button',{type:'button','aria-label':'操作记录','aria-expanded':utility==='log',onClick:()=>setUtility(current=>current==='log'?'':'log')},`操作记录 · ${job.results.length}`):null)),
          h('div',{className:'dsh-remote-ops__webSettings',hidden:!settings},h('label',null,'浏览器引擎',h('select',{'aria-label':'浏览器引擎',value:data.preferences.browser,disabled:navigating,onChange:event=>action({action:'preferences.save',preferences:{browser:event.target.value}})},h('option',{value:'chromium'},'专用 Chromium'),h('option',{value:'msedge'},'Microsoft Edge'),h('option',{value:'chrome'},'Google Chrome'))),h('label',null,'独立窗口浏览器',h('select',{'aria-label':'独立窗口浏览器',value:data.preferences.windowBrowser??'system',disabled:navigating,onChange:event=>action({action:'preferences.save',preferences:{windowBrowser:event.target.value}})},h('option',{value:'system'},'Windows 默认浏览器'),h('option',{value:'chromium'},'专用 Chromium'),h('option',{value:'msedge'},'Microsoft Edge'),h('option',{value:'chrome'},'Google Chrome'))),h('small',null,'浏览器引擎用于插件内网页；独立窗口默认跟随 Windows 默认浏览器。设置对新打开的浏览器生效；收藏网站的显式选择优先。'),h('p',{role:'status','aria-label':'Chromium 运行状态'},synced?browserRuntimeSummary(data.runtime):'正在检查 Chromium…'),data.runtime.managedStatus==='mismatch'||data.runtime.managedStatus==='invalid'?h('p',null,'托管 Chromium 版本不匹配或清单损坏，请联网安装匹配版本。'):null,h('button',{disabled:navigating||data.runtime.install?.status==='installing',onClick:()=>action({action:'runtime.install'})},data.runtime.install?.status==='installing'?'安装中…':'安装 / 检查 Chromium'),h('small',null,'联网安装与当前插件匹配的 Chromium 和 Headless Shell，并显示进度；也可以在主对话中让 Agent 按需安装。'),data.runtime.install?.output?h('pre',{role:'log','aria-label':'Chromium 安装进度','aria-live':'polite'},data.runtime.install.output):null,data.runtime.install?.error?h('p',{role:'alert'},data.runtime.install.error):null,
          h('label',null,'网页视口',h('select',{'aria-label':'网页视口',value:viewportIntent??session?.viewport?.mode??data.preferences.viewport??'panel',disabled:navigating,onChange:event=>{setViewportIntent(event.target.value);void action({action:'preferences.save',preferences:{viewport:event.target.value}});}},h('option',{value:'panel'},'跟随面板'),h('option',{value:'desktop'},'桌面视口'))),h('label',null,'网页画面缩放',h('select',{'aria-label':'网页画面缩放',value:zoom,onChange:event=>setZoom(event.target.value)},h('option',{value:'fit'},'适应画面'),h('option',{value:'actual'},'原始大小'))),h('small',null,'视口设置在返回插件内网页时应用。缩放用于桌面视口。')),
        h('section',{className:'dsh-remote-ops__webUtility',hidden:settings||utility!=='library','aria-label':'收藏网站与流程'},h('div',{className:'dsh-remote-ops__drawerHead'},h('strong',null,'收藏网站与流程'),h('button',{type:'button','aria-label':'返回网页',onClick:closeUtility},'返回')),library?h(BrowserLibraryPanel,{sessionId}):null),
        !settings&&utility==='log'&&job?h('div',{className:'dsh-remote-ops__webLog dsh-remote-ops__webLogBottom'},job.error?h('p',{role:'alert'},job.error.message,job.error.note?' · 操作结果未确认，不会自动重试。':''):null,job.results.map(item=>h('div',{key:item.index,className:'dsh-remote-ops__webResult'},`${item.index}. ${{goto:'打开网页',click:'点击',fill:'输入',press:'按键',read:'读取',scroll:'滚动',wait:'等待',assert:'检查',select:'选择',check:'勾选',uncheck:'取消勾选'}[item.action]??item.action} · ${item.completion==='checked'?'检查通过':item.completion==='observed'?'已读取':'动作完成，业务结果未检查'}`,item.value!==undefined?h('pre',null,item.value):null))):null,
        displayDraft?h(ModalDialog,{title:'切换网页显示',closeLabel:'关闭显示确认',closeDisabled:busy,onClose:()=>{if(!pending.current)setDisplayDraft(null);}},
          h('p',null,`将切换为${displayDraft.display==='window'?'独立窗口':'插件内'}。切换会重载网页，未提交内容可能丢失。`),
          error?h('p',{role:'alert'},error):null,
          h('div',{className:'dsh-remote-ops__formActions'},h('button',{type:'button',disabled:busy,onClick:()=>{if(!pending.current)setDisplayDraft(null);}},'取消'),h('button',{type:'button',className:'dsh-remote-ops__primary',disabled:busy||!synced||!!unfinished,onClick:()=>void applyDisplay()},busy?'切换中…':'切换显示'))):null);
    }

    function BrowserLibraryPanel({ sessionId }) {
      const draft = webDrafts.get(sessionId) ?? {};
      const [data, setData] = useState({ sites: [], flows: [], sessions: [], runtime: {} });
      const [siteId, setSiteId] = useState(draft.siteId ?? ""); const [browserId, setBrowserId] = useState(draft.browserId ?? "");
      const [siteForm, setSiteForm] = useState(null); const [password, setPassword] = useState("");
      const [steps, setSteps] = useState(draft.steps ?? []); const [flowId, setFlowId] = useState(draft.flowId ?? ""); const [savedFlowId, setSavedFlowId] = useState(draft.savedFlowId ?? ""); const [flowName, setFlowName] = useState(draft.flowName ?? "");
      const [variables, setVariables] = useState(draft.variables ?? {}); const [observation, setObservation] = useState(null);
      const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
      const [askPanel, panelQuestion] = usePanelQuestion(sessionId);
      const alive = useRef(true), pending = useRef(false), revision = useRef(0);
      useEffect(() => { webDrafts.set(sessionId, { ...webDrafts.get(sessionId),siteId, browserId, steps, flowId, savedFlowId, flowName, variables }); if (webDrafts.size > 10) webDrafts.delete(webDrafts.keys().next().value); }, [sessionId, siteId, browserId, steps, flowId, savedFlowId, flowName, variables]);
      const site = data.sites.find(item => item.id === siteId) ?? data.sites.find(item => item.id === data.sessions.find(session => !session.closed)?.siteId) ?? data.sites[0];
      const session = data.sessions.find(item => !item.closed && item.id === browserId && item.siteId === site?.id) ?? data.sessions.find(item => !item.closed && item.siteId === site?.id);
      const job = session?.job, live = !!session && !session.closed;
      const executing = job && ["running", "pausing", "stopping"].includes(job.status);
      const unfinished = job && ["running", "paused", "pausing", "stopping", "manual"].includes(job.status);
      const load = useCallback(async signal => {
        const ticket = ++revision.current;
        const value = await request(`/api/dsh-remote-ops/browser?sessionId=${encodeURIComponent(sessionId ?? "")}`, { signal });
        if (alive.current && ticket === revision.current) setData(value);
      }, [sessionId]);
      useEffect(() => {
        alive.current = true; let stopped = false, timer; const controller = new AbortController();
        const poll = async () => {
          try { if (!document.hidden && !pending.current) await load(controller.signal); }
          catch (failure) { if (!stopped && failure.name !== "AbortError") setError(failure.message); }
          if (!stopped) timer = setTimeout(poll, 1500);
        };
        void poll();
        return () => { stopped = true; alive.current = false; clearTimeout(timer); controller.abort(); };
      }, [load]);
      const action = async body => {
        if (pending.current) return;
        pending.current = true; setBusy(true); setError(""); setNotice(""); revision.current++;
        try {
          const value = await request("/api/dsh-remote-ops/browser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, browserId: session?.id, ...body }) });
          if (alive.current) { await load(); return value.result; }
        } catch (failure) { if (alive.current) setError(failure.message); }
        finally { pending.current = false; if (alive.current) setBusy(false); }
      };
      const control = control => action({ action: "control", control });
      const input = (label, value, change, props = {}) => h("label", null, h("span", null, label), h("input", { value: value ?? "", onChange: event => change(event.target.value), ...props }));
      const targetEditor = (label, target, change) => h("fieldset", { className: "dsh-remote-ops__webTarget" }, h("legend", null, label),
        h("select", { "aria-label": `${label}方式`, value: target.kind, onChange: event => change({ ...target, kind: event.target.value }) }, ["css", "xpath", "role", "label", "text", "placeholder"].map(kind => h("option", { key: kind, value: kind }, kind))),
        h("input", { "aria-label": label, placeholder: target.kind === "xpath" ? "//button[@type='submit']" : "选择器或精确文本", value: target.value, onChange: event => change({ ...target, value: event.target.value }) }),
        target.kind === "role" ? input(`${label}名称`, target.name, value => change({ ...target, name: value })) : null,
        h("details", null, h("summary", null, "iframe"), input(`${label}iframe`, target.frame, value => change({ ...target, frame: value || undefined }), { placeholder: "iframe 的 CSS 选择器（可选）" })));
      const selectSite = value => { setSiteId(value); setBrowserId(""); setFlowId(""); setSavedFlowId(""); setSteps([]); setFlowName(""); setVariables({}); setObservation(null); };
      const newSite = item => { setPassword(""); setSiteForm(item ? JSON.parse(JSON.stringify(item)) : { name: "", url: "", browser: "default", slowMo: 150, username: "" }); };
      const changeStep = (index, patch) => { setFlowId(""); setSteps(items => items.map((item, n) => n === index ? { ...item, ...patch } : item)); };
      const editor = siteForm ? h("form", { className: "dsh-remote-ops__webSection", "aria-label": "网站配置", onSubmit: async event => {
        event.preventDefault(); const result = await action({ action: "site.save", site: siteForm, password });
        if (result) { selectSite(result.id); setSiteForm(null); setPassword(""); }
      } }, h("strong", null, siteForm.id ? "编辑网站" : "新增网站"),
        input("网站名称", siteForm.name, name => setSiteForm({ ...siteForm, name }), { required: true, maxLength: 120 }),
        input("网站地址", siteForm.url, url => setSiteForm({ ...siteForm, url }), { required: true, type: "url", placeholder: "https://example.com/login" }),
        h("label", null, "浏览器", h("select", { "aria-label": "浏览器", value: siteForm.browser, onChange: event => setSiteForm({ ...siteForm, browser: event.target.value }) }, h("option", { value: "default" }, "跟随浏览器设置"), h("option", { value: "system" }, "Windows 默认浏览器"), h("option", { value: "chromium" }, "专用 Chromium"), h("option", { value: "msedge" }, "已安装的 Microsoft Edge"), h("option", { value: "chrome" }, "已安装的 Google Chrome"))),
        input("动作间隔（毫秒）", siteForm.slowMo, value => setSiteForm({ ...siteForm, slowMo: Number(value) }), { type: "number", min: 0, max: 1500 }),
        h("details", null, h("summary", null, "自动登录（可选，也可人工登录）"),
          input("网页登录用户名", siteForm.username, username => setSiteForm({ ...siteForm, username }), { autoComplete: "off" }),
          input("网页登录密码", password, setPassword, { type: "password", autoComplete: "new-password", placeholder: siteForm.passwordRef ? "已保存；留空保留" : "仅保存至本机 DSH 凭据服务" }),
          h("button", { type: "button", onClick: () => setSiteForm({ ...siteForm, login: siteForm.login ? undefined : { username: webTarget(), password: webTarget(), submit: webTarget(), success: webTarget() } }) }, siteForm.login ? "移除自动登录定位" : "配置自动登录定位"),
          siteForm.login ? [ ["username", "用户名定位"], ["password", "密码定位"], ["submit", "登录按钮定位"], ["success", "登录成功定位"] ].map(([key, label]) => h(React.Fragment, { key }, targetEditor(label, siteForm.login[key], value => setSiteForm({ ...siteForm, login: { ...siteForm.login, [key]: value } })))) : null,
          input("额外凭据域名", (siteForm.allowedOrigins ?? []).join(", "), value => setSiteForm({ ...siteForm, allowedOrigins: value.split(",").map(item => item.trim()).filter(Boolean) }), { placeholder: "https://sso.example.com（逗号分隔）" })),
        h("div", { className: "dsh-remote-ops__webActions" }, h("button", { disabled: busy, type: "submit" }, "保存网站"), h("button", { type: "button", disabled: busy, onClick: () => { setSiteForm(null); setPassword(""); } }, "取消"))) : null;
      return h("section", { className: "dsh-remote-ops__web", "aria-label": "网页操作" }, panelQuestion,
        h("div", { className: "dsh-remote-ops__webSection" }, h("div", { className: "dsh-remote-ops__webActions" }, h("strong", null, "网页"), h("button", { disabled: busy, onClick: () => newSite() }, "新增网站")),
          h("p", { className: "dsh-remote-ops__muted" }, "操作在独立浏览器窗口中可见。切换模块或收起侧栏，任务会继续。"),
          h("label", null, "选择网站", h("select", { "aria-label": "选择网站", value: site?.id ?? "", disabled: busy, onChange: event => selectSite(event.target.value) }, !site ? h("option", { value: "" }, "先新增一个网站") : null, data.sites.map(item => h("option", { key: item.id, value: item.id }, item.name)))),
          h("div", { className: "dsh-remote-ops__webActions" }, h("button", { disabled: busy || !site || !sessionId, onClick: async () => { const opened = await action({ action: "open", siteId: site.id }); if (opened) setBrowserId(opened.id); } }, busy ? "处理中…" : live ? "显示浏览器" : "打开浏览器"), site ? h("button", { disabled: busy || live, onClick: () => newSite(site) }, "编辑网站") : null,
            live ? h("button", { disabled: busy, onClick: () => control("close") }, "关闭浏览器") : null),
          !sessionId ? h("p", null, "请先选择或创建一个 DSH 对话。") : null,
          h("details", null, h("summary", null, "浏览器准备与网站管理"), h("p", null, browserRuntimeSummary(data.runtime)),
            h("button", { disabled: busy || data.runtime.install?.status === "installing", onClick: () => action({ action: "runtime.install" }) }, data.runtime.install?.status === "installing" ? "下载中…" : "安装 / 检查 Chromium"),
            data.runtime.install?.output || data.runtime.install?.error ? h("pre", null, data.runtime.install.error ?? data.runtime.install.output) : null,
            site ? h("button", { disabled: busy || live, onClick: async () => { if (await askPanel(`删除网站“${site.name}”及其流程？`)) { await action({ action: "site.delete", siteId: site.id }); selectSite(""); } } }, "删除网站及流程") : null)),
        editor,
        error ? h("div", { className: "dsh-remote-ops__webSection dsh-remote-ops__dangerAction", role: "alert" }, error) : null,
        notice ? h("div", { className: "dsh-remote-ops__webSection", role: "status" }, notice) : null,
        live ? h(React.Fragment, null,
          h("div", { className: "dsh-remote-ops__webSection" }, h("div", { role: "status", "aria-live": "polite" }, h("strong", null, job ? browserStatus[job.status] : "浏览器已打开"), job ? ` · ${job.index}/${job.count} 步` : ""),
            session.notice ? h("p", null, session.notice) : null,
            h("label", null, "当前网页", h("select", { "aria-label": "当前网页", value: session.activePageId, disabled: busy || executing, onChange: event => action({ action: "control", control: "select-page", value: event.target.value }) }, session.pages.map((page, index) => h("option", { key: page.id, value: page.id }, `${index + 1}. ${page.url}`)))),
            session.dialog ? h("p", null, `网页弹窗：${session.dialog.message}。请在主对话告诉 Agent 如何处理。`) : null),
          h("div", { className: "dsh-remote-ops__webSection" }, h("label", null, "已保存流程", h("select", { "aria-label": "已保存流程", value: flowId, disabled: busy, onChange: event => { const flow = data.flows.find(item => item.id === event.target.value); setFlowId(flow?.id ?? ""); setSavedFlowId(flow?.id ?? ""); setFlowName(flow?.name ?? ""); setSteps(flow?.steps ?? []); setVariables({}); } }, h("option", { value: "" }, "新建流程 / 临时操作"), data.flows.filter(item => item.siteId === site.id).map(item => h("option", { key: item.id, value: item.id }, item.name)))),
            h("details", { open: true }, h("summary", null, `编辑步骤（${steps.length}）`),
              steps.map((step, index) => h("div", { key: index, className: "dsh-remote-ops__webStep" }, h("div", { className: "dsh-remote-ops__webActions" }, h("strong", null, `步骤 ${index + 1}`), h("select", { "aria-label": `步骤 ${index + 1}动作`, value: step.action, disabled: busy, onChange: event => changeStep(index, { action: event.target.value }) }, ["goto", "click", "fill", "press", "select", "check", "uncheck", "scroll", "wait", "read", "assert"].map(value => h("option", { key: value, value }, value))), h("button", { disabled: busy, onClick: () => { setFlowId(""); setSteps(items => items.filter((_item, n) => n !== index)); } }, `删除步骤 ${index + 1}`)),
                step.action === "goto" ? input(`步骤 ${index + 1}网址`, step.url, url => changeStep(index, { url })) : targetEditor(`步骤 ${index + 1}定位`, step.target ?? webTarget(), target => changeStep(index, { target })),
                ["fill", "press", "select", "assert"].includes(step.action) && !step.secretRef ? input(`步骤 ${index + 1}内容`, step.value, value => changeStep(index, { value }), { placeholder: "支持 {{参数}}；密码使用下方凭据引用" }) : null,
                step.action === "fill" && site.passwordRef ? h("label", { className: "dsh-remote-ops__webCheck" }, h("input", { type: "checkbox", checked: !!step.secretRef, onChange: event => changeStep(index, { secretRef: event.target.checked ? site.passwordRef : undefined, value: undefined }) }), "使用本站保存的密码") : null,
                step.action === "click" ? h("label", { className: "dsh-remote-ops__webCheck" }, h("input", { type: "checkbox", checked: !!step.expectPopup, onChange: event => changeStep(index, { expectPopup: event.target.checked }) }), "点击后切换到新弹出网页") : null,
                step.action !== "goto" ? h("button", { disabled: busy || !!executing || !step.target?.value, onClick: async () => { const tested = await action({ action: "target.test", target: step.target }); if (tested) setNotice(tested.unique ? "匹配到 1 个元素，已在浏览器中高亮" : `匹配到 ${tested.count} 个元素，请调整定位`); } }, `测试步骤 ${index + 1}定位`) : null,
                h("details", null, h("summary", null, "执行后检查"), h("button", { disabled: busy, onClick: () => changeStep(index, { expect: step.expect ? undefined : { target: webTarget(), text: "" } }) }, step.expect ? "移除检查" : "添加结果检查"), step.expect ? h(React.Fragment, null, targetEditor(`步骤 ${index + 1}结果定位`, step.expect.target, target => changeStep(index, { expect: { ...step.expect, target } })), input(`步骤 ${index + 1}预期文本`, step.expect.text, text => changeStep(index, { expect: { ...step.expect, text } }))) : null))),
              h("button", { disabled: busy || steps.length >= 40, onClick: () => { setFlowId(""); setSteps(items => [...items, { action: "click", target: webTarget() }]); } }, "添加步骤"),
              input("流程名称", flowName, setFlowName, { placeholder: "保存后可由 Agent 直接调用" }),
              h("div", { className: "dsh-remote-ops__webActions" }, h("button", { disabled: busy || !flowName.trim() || !steps.length, onClick: async () => { const saved = await action({ action: "flow.save", flow: { id: savedFlowId || undefined, siteId: site.id, name: flowName, steps } }); if (saved) { setFlowId(saved.id); setSavedFlowId(saved.id); setNotice("流程已保存"); } } }, "保存流程"), flowId ? h("button", { disabled: busy, onClick: async () => { if (await askPanel(`删除流程“${flowName}”？`)) { await action({ action: "flow.delete", flowId }); setFlowId(""); setSavedFlowId(""); } } }, "删除流程") : null)),
            h("small", { className: "dsh-remote-ops__muted" }, "在 DSH 主对话中让 Agent 执行已保存流程。未配置结果检查的步骤，仅表示动作执行完毕。")),
          h("div", { className: "dsh-remote-ops__webSection" }, h("strong", null, "执行结果"), job?.error ? h("p", { role: "alert", className: "dsh-remote-ops__dangerAction" }, job.error.message, job.error.note ? " · 操作可能已经生效，不会自动重试。" : "") : null,
            job?.results.map(item => h("div", { key: item.index, className: "dsh-remote-ops__webResult" }, h("span", null, `${item.index}. ${item.action} · ${item.completion === "checked" ? "检查通过" : item.completion === "observed" ? "已读取" : "动作已完成，业务结果未检查"}`), item.value !== undefined ? h("pre", null, item.value) : null)),
            h("div", { className: "dsh-remote-ops__webActions" }, h("button", { disabled: busy || !!executing, onClick: async () => { const value = await action({ action: "observe" }); if (value) setObservation(value); } }, "读取当前网页"), h("button", { disabled: busy || !!executing, onClick: () => action({ action: "capture" }) }, "更新截图")),
            observation ? h("details", { open: true }, h("summary", null, observation.title || "网页内容"), h("pre", null, observation.text), h("details", null, h("summary", null, "元素定位参考"), h("pre", null, JSON.stringify(observation.elements, null, 2)))) : null,
            session.screenshotAt ? h("details", null, h("summary", null, `最近截图 · ${new Date(session.screenshotAt).toLocaleTimeString()}`), h("img", { alt: "当前网页截图，输入框及已知密码已遮罩", src: `/api/dsh-remote-ops/browser/screenshot?sessionId=${encodeURIComponent(sessionId)}&browserId=${encodeURIComponent(session.id)}&v=${encodeURIComponent(session.screenshotAt)}` })) : null,
            session.history.length > 1 ? h("details", null, h("summary", null, "近期运行"), session.history.slice(0, -1).reverse().map(item => h("p", { key: item.id }, `${browserStatus[item.status]} · ${item.index}/${item.count} · ${new Date(item.startedAt).toLocaleTimeString()}`))) : null)) : null);
    }
    function EnvironmentPasswordField({ id, environmentId, configured, value, onChange }) {
      const [visible, setVisible] = useState(false), [saved, setSaved] = useState("");
      const [loading, setLoading] = useState(false), [error, setError] = useState("");
      const pending = useRef();
      const cancel = () => { pending.current?.abort(); pending.current = undefined; };
      useEffect(() => () => cancel(), []);
      const toggle = async () => {
        if (visible || pending.current) { cancel(); setSaved(""); setVisible(false); setLoading(false); setError(""); return; }
        setError("");
        if (value || !configured || !environmentId) { setVisible(true); return; }
        const controller = new AbortController(); pending.current = controller; setLoading(true);
        try {
          const result = await request("/api/dsh-remote-ops/environment-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment: environmentId }), signal: controller.signal });
          if (pending.current !== controller) return;
          setSaved(result.password); setVisible(true);
        } catch (cause) {
          if (pending.current !== controller) return;
          const messages = { REMOTE_ENV_NOT_FOUND: "环境已不存在，请刷新环境列表。", REMOTE_PASSWORD_NOT_CONFIGURED: "此环境未配置密码，可输入新密码后保存。", REMOTE_PASSWORD_NOT_FOUND: "未找到此环境的密码，可重新输入后保存。" };
          setError(messages[cause.code] ?? "暂时无法读取密码，请重试；也可重新输入密码后保存。");
        } finally { if (pending.current === controller) { pending.current = undefined; setLoading(false); } }
      };
      const label = loading ? "取消读取 SSH 密码" : visible ? "隐藏 SSH 密码" : "显示 SSH 密码";
      return h("div", { className: "dsh-remote-ops__passwordField" },
        h("label", { htmlFor: id }, "SSH 密码"),
        h("div", { className: "dsh-remote-ops__passwordRow", "aria-busy": loading },
          h("input", { id, type: visible ? "text" : "password", autoComplete: "new-password", spellCheck: false, autoCapitalize: "off", value: value || saved, "aria-describedby": error ? id + "-error" : undefined,
            onChange: event => { cancel(); setLoading(false); setSaved(""); setError(""); onChange(event.target.value); }, placeholder: configured ? "留空保持原密码" : "输入 SSH 登录密码" }),
          h("button", { type: "button", className: "dsh-remote-ops__passwordToggle", "aria-label": label, title: label, "aria-pressed": visible, onClick: toggle },
            h("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
              h("path", { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" }), h("circle", { cx: 12, cy: 12, r: 3 }), visible || loading ? h("path", { d: "m3 3 18 18" }) : null)),
        ),
        loading ? h("span", { className: "dsh-remote-ops__formNote", role: "status" }, "正在读取密码…") : null,
        error ? h("span", { id: id + "-error", className: "dsh-remote-ops__dangerAction", role: "alert" }, error) : null,
      );
    }

    function ApiIcon({size=16}) { return h("svg",{width:size,height:size,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.6,"aria-hidden":true},h("path",{d:"m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18"})); }
    function DesktopIcon({size=16}) { return h("svg",{width:size,height:size,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.6,"aria-hidden":true},h("rect",{x:3,y:3,width:18,height:13,rx:2}),h("path",{d:"M8 21h8m-4-5v5"})); }
    const terminalUnreadState = (seen, unread, sessions, visibleSession, frames, owner) => {
      const nextSeen = {...seen}, nextUnread = {...unread};
      for (const session of sessions ?? []) {
        const cursor=session.outputCursor;if(!cursor)continue;
        const previous=seen[session.sessionId], frame=frames[`${owner??""}:${session.sessionId}`];
        const displayed=session.sessionId===visibleSession&&frame?.streamId===cursor.streamId&&frame.nextOffset>=cursor.offset;
        if(displayed)delete nextUnread[session.sessionId];
        else if(previous ? previous.streamId!==cursor.streamId||previous.offset<cursor.offset : Object.keys(seen).length>0&&cursor.offset>0)nextUnread[session.sessionId]=true;
        nextSeen[session.sessionId]=cursor;
      }
      const ids=new Set((sessions??[]).map(item=>item.sessionId));
      for(const id of Object.keys(nextUnread))if(!ids.has(id))delete nextUnread[id];
      for(const id of Object.keys(nextSeen))if(!ids.has(id))delete nextSeen[id];
      return {seen:nextSeen,unread:nextUnread};
    };
    const workspaceBadges = (activity, upload, unread, seen) => {
      const badges={}, count=Object.keys(unread).length;
      if(count)badges.terminal={label:count>1?String(count):"新输出",tone:"info",description:`${count} 个终端有新输出`};
      const activeTransfers=(activity.transfers??[]).filter(task=>["running","queued"].includes(task.status));
      const uploading=upload&&["uploading","cancelling"].includes(upload.status);
      const pending=activeTransfers.filter(task=>!uploading||task.source!=="browser").length+(uploading?1:0);
      const transferFailures=(activity.transfers??[]).filter(task=>task.status==="failed"&&!seen.sftp.includes(task.id));
      const uploadFailed=upload?.status==="failed"&&!seen.sftp.includes("upload:"+upload.startedAt);
      if(pending){const label=pending===1&&uploading&&upload.total>0?Math.min(99,Math.floor(upload.bytes/upload.total*100))+"%":pending>1?`${pending} 传输`:"传输中";badges.sftp={label,tone:"info",description:label+(transferFailures.length||uploadFailed?"，另有传输失败":"")};}
      else if(transferFailures.length||uploadFailed)badges.sftp={label:"失败",tone:"error",description:"有未查看的传输失败"};
      const jobs=activity.browsers??[], running=jobs.filter(job=>["running","pausing","stopping"].includes(job.status));
      const failures=jobs.filter(job=>["failed","unknown"].includes(job.status)&&!seen.browser.includes(job.id));
      if(running.length)badges.browser={label:running.length>1?`${running.length} 执行`:"执行中",tone:"info",description:running.map(job=>`${job.index}/${job.count} 步`).join("，")};
      else if(failures.length)badges.browser={label:"待检查",tone:"error",description:"网页操作失败或结果待确认"};
      return badges;
    };
    function RemoteOpsPanel({ sessionId }) {
      const browserUpload = useSyncExternalStore(browserUploads.subscribe, () => browserUploads.get(sessionId));
      const [restoredView] = useState(() => workspaceView(sessionId));
      const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
      // DSH may reload client modules after installation while the server waits for restart.
      const updateDialogKey = "remote-ops.update-dialog." + (sessionId ?? "local");
      const [updateOpen, setUpdateOpen] = useState(() => { try { return sessionStorage.getItem(updateDialogKey) === "open"; } catch { return false; } });
      const changeUpdateOpen = open => { setUpdateOpen(open); try { if (open) sessionStorage.setItem(updateDialogKey, "open"); else sessionStorage.removeItem(updateDialogKey); } catch { /* Storage is optional. */ } };
      const [density, setDensity] = useState(() => { try { return localStorage.getItem("remote-ops.density") === "compact" ? "compact" : "comfortable"; } catch { return "comfortable"; } });
      const changeDensity = value => { const next = value === "compact" ? "compact" : "comfortable"; setDensity(next); try { localStorage.setItem("remote-ops.density", next); } catch { /* Optional UI preference. */ } };
      const [filesVisited, setFilesVisited] = useState(restoredView.module === "sftp");
      const [browserVisited, setBrowserVisited] = useState(restoredView.module === "browser");
      const [apiVisited, setApiVisited] = useState(restoredView.module === "api");
      const [desktopVisited, setDesktopVisited] = useState(restoredView.module === "desktop");
      const [settingsTab, setSettingsTab] = useState(updateOpen ? "updates" : "");
      const [updatesVisited, setUpdatesVisited] = useState(updateOpen);
      const [environmentKind, setEnvironmentKind] = useState("ssh");
      const [terminalUnread, setTerminalUnread] = useState({}), outputSeen = useRef({});
      const [seenFailures, setSeenFailures] = useState({sftp:[],browser:[]});
      const [pageVisible, setPageVisible] = useState(!document.hidden);
      useEffect(() => { const changed = () => setPageVisible(!document.hidden); document.addEventListener("visibilitychange", changed); return () => document.removeEventListener("visibilitychange", changed); }, []);
      const knownTabs = useRef({ owner: sessionId, tabs: [] });
      const dismissedTabs = useRef({ owner: sessionId, ids: new Set() });
      const closeBatch = useRef(null), [closingAll, setClosingAll] = useState(false);
      useEffect(() => { setClosingAll(false); }, [sessionId]);
      const [reviewStream, setReviewStream] = useState(null);
      const composingRef = useRef(false);
      const [loadedSnapshot, setSnapshot] = useState(empty); const [terminalFrames, setTerminalFrames] = useState({}); const [drawer, setDrawer] = useState(false); const [module, setModule] = useState(restoredView.module); const [quickOpen, setQuickOpen] = useState(() => { try { return localStorage.getItem("remote-ops.quick-open") === "true"; } catch { return false; } }); const [environmentForm, setEnvironmentForm] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [actionNotice, setActionNotice] = useState(""); const [update, setUpdate] = useState(empty.update); const [refreshBusy, setRefreshBusy] = useState(false); const [selectedEnv, setSelectedEnv] = useState(""); const [activeSessionId, setActiveSessionId] = useState(restoredView.activeSessionId); const [terminalInput, setTerminalInput] = useState(""); const [pendingSshInput, setPendingSshInput] = useState(""); const [quickHeight, setQuickHeight] = useState(190); const [search, setSearch] = useState(restoredView.search); const outputRef = useRef(null); const terminalInputRef = useRef(null); const stickToBottom = useRef(true); const userScrollIntent = useRef(false); const scrollIntentTimer = useRef(); const rawInputQueue = useRef([]); const rawInputTimer = useRef(); const rawInputSending = useRef(false); const pendingSshInputRef = useRef(""); const refreshRequest = useRef(); const snapshotSignature = useRef(""); const terminalFramesRef = useRef({});
      const viewOwner = useRef(sessionId), viewRevision = useRef(0);
      if (viewOwner.current !== sessionId) { viewOwner.current = sessionId; viewRevision.current += 1; }
      const snapshot = loadedSnapshot.viewOwner === (sessionId ?? "") ? loadedSnapshot : empty;
      const [outputConnection, setOutputConnection] = useState("connecting");
      const [unreadOutput, setUnreadOutput] = useState(false);
      const [inputFocused, setInputFocused] = useState(false);
      const [preferences, setPreferences] = useState(() => { try { return terminalPreferences(JSON.parse(localStorage.getItem("remote-ops.preferences") || "{}")); } catch { return terminalPreferences(); } });
      const [outputSearch, setOutputSearch] = useState("");
      const [searchOpen, setSearchOpen] = useState(false);
      const [matchIndex, setMatchIndex] = useState(0);
      const manualDrafts = useRef(sharedManualDrafts);
      const rawInputDrafts = useRef(new Map());
      const rawInputRevision = useRef(0);
      const pasteSending = useRef(false);
      const quickSending = useRef(false);
      const [pasteDraft, setPasteDraft] = useState(null);
      const [connectionChoices, setConnectionChoices] = useState(null);
      const [diagnosticPreview, setDiagnosticPreview] = useState(null);
      const [commandTarget, setCommandTarget] = useState(null);
      const [askPanel, panelQuestion] = usePanelQuestion(sessionId);
      const [environmentError, setEnvironmentError] = useState("");
      const [environmentTest, setEnvironmentTest] = useState(null);
      useEffect(() => { setCommandTarget(null); }, [sessionId]);
      useEffect(() => { setQuickHeight(preferences.quickHeight); }, []);
      useEffect(() => { rememberWorkspace(sessionId, { module, activeSessionId, search }); }, [sessionId, module, activeSessionId, search]);
      useEffect(() => { try { localStorage.setItem("remote-ops.preferences", JSON.stringify({ ...preferences, quickHeight })); } catch { /* Storage can be disabled by browser policy. */ } }, [preferences, quickHeight]);
      useEffect(() => { setPasteDraft(null); setConnectionChoices(null); setActiveSessionId(current => current); setReviewStream(null); setBusy(false); }, [sessionId]);
      const refresh = useCallback((manual = false) => {
        if (refreshRequest.current && refreshRequest.current.ownerKey === sessionId) { if (manual) refreshRequest.current.manual = true; return refreshRequest.current; }
        const task = (async () => {
          try {
            const value = await request(`/api/dsh-remote-ops/state${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`);
            if (viewOwner.current !== sessionId) return false;
            refreshNotices.setRuntime(value.runtimeId);
            value.viewOwner = sessionId ?? "";
            if (dismissedTabs.current.owner !== sessionId) dismissedTabs.current = { owner: sessionId, ids: new Set() };
            value.sessions = value.sessions.filter(item => !dismissedTabs.current.ids.has(item.sessionId));
            value.tabs = mergeSessionTabs(knownTabs.current.owner === sessionId ? knownTabs.current.tabs : [], value.sessions).filter(item => !dismissedTabs.current.ids.has(item.sessionId));
            knownTabs.current = { owner: sessionId, tabs: value.tabs };
            const signature = JSON.stringify(value);
            if (signature !== snapshotSignature.current) {
              snapshotSignature.current = signature;
              setSnapshot(value);
              if (value.update) setUpdate(value.update);
            }
            setError(current => current.startsWith("状态刷新失败\n") ? "" : current);
            setActionNotice(current => current === "刷新失败" ? "" : current);
            return true;
          } catch (cause) {
            if (viewOwner.current === sessionId && refreshNotices.shouldNotify(cause, task.manual)) setError(cause instanceof Error ? cause.message : String(cause));
            return false;
          }
        })();
        task.ownerKey = sessionId;
        task.manual = manual;
        refreshRequest.current = task;
        void task.finally(() => { if (refreshRequest.current === task) refreshRequest.current = undefined; });
        return task;
      }, [sessionId]);
      useEffect(() => {
        let stopped = false, timer, attempt = 0;
        const poll = async () => { const ok = document.hidden ? true : await refresh(); attempt = ok ? 0 : attempt + 1; if (!stopped) timer = setTimeout(poll, document.hidden ? 10000 : Math.max(3000, retryDelay(attempt))); };
        void poll(); return () => { stopped = true; clearTimeout(timer); };
      }, [refresh]);
      const workspaceAction = useCallback(async body => {
        const owner = sessionId, revision = viewRevision.current;
        const isCurrent = () => viewOwner.current === owner && viewRevision.current === revision;
        const changesConnection = ["enter", "control"].includes(body.action);
        if (changesConnection) setBusy(true);
        try {
          const value = await request("/api/dsh-remote-ops/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId: owner }) });
          if (!isCurrent()) return undefined;
          setError(""); await refresh(); return isCurrent() ? value : undefined;
        } catch (cause) { if (isCurrent()) setError(cause.message); return undefined; }
        finally { if (isCurrent() && changesConnection) setBusy(false); }
      }, [sessionId, refresh]);
      const refreshNow = useCallback(async () => { if (refreshBusy) return; setRefreshBusy(true); setActionNotice(""); const ok = await refresh(true); setActionNotice(ok ? "已刷新" : "刷新失败"); setRefreshBusy(false); }, [refresh, refreshBusy]);
      useEffect(() => { if (!selectedEnv && snapshot.environments[0]) setSelectedEnv(snapshot.environments[0].id); if (!activeSessionId && snapshot.sessions.length) setActiveSessionId((snapshot.sessions.find(item => item.kind !== "local") ?? snapshot.sessions[0]).sessionId); }, [activeSessionId, selectedEnv, snapshot]);
      useEffect(() => { try { localStorage.setItem("remote-ops.quick-open", String(quickOpen)); } catch { /* Browser storage is optional. */ } }, [quickOpen]);
      const action = useCallback(async (body) => {
        const owner = sessionId, revision = viewRevision.current;
        const isCurrent = () => viewOwner.current === owner && viewRevision.current === revision;
        setBusy(true);
        try {
          const value = await request("/api/dsh-remote-ops/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId: owner }) });
          if (!isCurrent()) return undefined;
          setError(""); await refresh();
          return isCurrent() ? value : undefined;
        } catch (cause) {
          if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
          return undefined;
        } finally { if (isCurrent()) setBusy(false); }
      }, [refresh, sessionId]);
      const tabs = snapshot.tabs ?? snapshot.sessions;
      const activeSession = activeSessionId ? tabs.find(item => item.sessionId === activeSessionId) : tabs[0]; const activeEnvironment = snapshot.environments.find((item) => item.id === (activeSession?.environmentId ?? selectedEnv)); const localActive = activeSession?.kind === "local"; const connectedEndpoint = activeSession?.endpoint ?? activeEnvironment;
      const activeTerminalId = activeSession?.sessionId ?? "";
      const activeFrameKey = `${sessionId ?? ""}:${activeTerminalId}`;
      const activeTerminalFrame = activeTerminalId ? terminalFrames[activeFrameKey] : undefined;
      const workspaceVisible = !drawer && !diagnosticsOpen && !settingsTab && pageVisible;
      const terminalTabsRef = useRef(null);
      useEffect(() => {
        const strip = terminalTabsRef.current;
        if (!workspaceVisible || module !== "terminal" || !strip) return;
        const selected = strip.querySelector('[aria-selected="true"]')?.parentElement;
        const reveal = () => selected?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        reveal();
        const observer = new ResizeObserver(reveal);
        observer.observe(strip);
        if (selected) observer.observe(selected);
        return () => observer.disconnect();
      }, [activeTerminalId, tabs.length, workspaceVisible, module]);
      useEffect(() => {
        const next = terminalUnreadState(outputSeen.current, terminalUnread, snapshot.sessions, workspaceVisible && module === "terminal" ? activeTerminalId : "", terminalFrames, sessionId);
        outputSeen.current = next.seen;
        if (JSON.stringify(next.unread) !== JSON.stringify(terminalUnread)) setTerminalUnread(next.unread);
      }, [snapshot.sessions, activeTerminalId, terminalFrames, workspaceVisible, module, sessionId]);
      const activity = snapshot.activity ?? {transfers:[],browsers:[]};
      useEffect(() => {
        if (!workspaceVisible || !["sftp", "browser"].includes(module)) return;
        const failed = module === "sftp" ? (activity.transfers ?? []).filter(item => item.status === "failed").map(item => item.id) : (activity.browsers ?? []).filter(item => item.browserId === activity.activeBrowserId && ["failed", "unknown"].includes(item.status)).map(item => item.id);
        if (module === "sftp" && browserUpload?.status === "failed") failed.push("upload:" + browserUpload.startedAt);
        setSeenFailures(current => { const next=[...new Set([...current[module],...failed])].slice(-200); return JSON.stringify(current[module]) === JSON.stringify(next) ? current : {...current, [module]:next}; });
      }, [workspaceVisible, module, snapshot.activity, browserUpload]);
      const tabBadges = workspaceBadges(activity, browserUpload, terminalUnread, seenFailures);
      if(activity.desktops?.some(s=>s.status==="busy"))tabBadges.desktop={tone:"active",label:"操作中",description:"Windows 桌面正在执行操作"};
      const terminalReady = terminalInputEnabled(snapshot) && !activeSession?.disconnected && Boolean(activeTerminalFrame?.streamId) && outputConnection === "connected" && reviewStream !== activeFrameKey;
      const frameRows = activeTerminalFrame?.size?.rows || 40, frameCols = activeTerminalFrame?.size?.cols || 160;
      const terminalScreen = useMemo(() => terminalScreenModel(activeTerminalFrame?.raw ?? "", frameRows, frameCols, { decorate: true, highlight: preferences.highlight, commandAnnotations: activeTerminalFrame?.commandAnnotations, startOffset: (activeTerminalFrame?.nextOffset ?? 0) - (activeTerminalFrame?.raw?.length ?? 0) }), [activeTerminalFrame?.raw, activeTerminalFrame?.commandAnnotations, activeTerminalFrame?.nextOffset, frameRows, frameCols, preferences.highlight]);
      const terminalOutput = terminalScreen.text;
      const matches = useMemo(() => outputMatches(terminalOutput, outputSearch), [terminalOutput, outputSearch]);
      const matchedLines = useMemo(() => new Set(matches), [matches]);
      const moveMatch = delta => {
        if (!matches.length) return;
        const next = (matchIndex + delta + matches.length) % matches.length;
        setMatchIndex(next); stickToBottom.current = false;
        outputRef.current?.querySelector(`[data-line="${matches[next]}"]`)?.scrollIntoView({ block: "center" });
      };
      const terminalOutputView = terminalOutput ? terminalOutput.split("\n").map((line, index, lines) => {
        const props = { key: `line-${index}`, "data-line": index, "data-match": matchedLines.has(index), "data-tone": terminalLineTone(line, terminalUsesGrid(terminalScreen), preferences.highlight) };
        const runs = terminalSemanticRuns(terminalScreen.runs?.[index], line, terminalUsesGrid(terminalScreen), preferences.highlight);
        return h("span", props, terminalStyledLine(runs, line, terminalScreen.cursor.column, index === terminalScreen.cursor.row && terminalScreen.cursorVisible && terminalReady, terminalUsesGrid(terminalScreen)), index < lines.length - 1 ? "\n" : null);
      }) : "等待终端输出…";
      useEffect(() => { if (!terminalReady) return undefined; const frame = window.requestAnimationFrame(() => { if (module === "terminal" && !document.activeElement?.closest?.('[role="dialog"],input,textarea,[role="textbox"],[role="tab"],[contenteditable]:not([contenteditable="false"])')) terminalInputRef.current?.focus({ preventScroll: true }); }); return () => window.cancelAnimationFrame(frame); }, [activeTerminalId, terminalReady]);
      useEffect(() => {
        if (!activeTerminalId || activeSession?.disconnected) { setOutputConnection("disconnected"); return undefined; }
        setOutputConnection("connecting");
        setUnreadOutput(false);
        stickToBottom.current = true;
        let cancelled = false;
        let controller, attempt = 0;
        const poll = async () => {
          while (!cancelled) {
            const previous = terminalFramesRef.current[activeFrameKey];
            const params = new URLSearchParams({ session: activeTerminalId, waitMs: document.hidden ? "25000" : "20000" });
            if (sessionId) params.set("sessionId", sessionId);
            if (Number.isSafeInteger(previous?.nextOffset)) params.set("offset", String(previous.nextOffset));
            if (previous?.streamId) params.set("streamId", previous.streamId);
            controller = new AbortController();
            try {
              const value = await request(`/api/dsh-remote-ops/terminal?${params}`, { signal: controller.signal });
              if (cancelled) break;
              setOutputConnection("connected");
              attempt = 0;
              if (previous?.streamId && previous.streamId !== value.streamId) setReviewStream(activeFrameKey);
              if (value.text && !stickToBottom.current) setUnreadOutput(true);
              const changed = value.reset || Boolean(value.text) || previous?.status?.kind !== value.status?.kind || previous?.activity !== value.activity || previous?.size?.rows !== value.size?.rows || previous?.size?.cols !== value.size?.cols || JSON.stringify(previous?.operation) !== JSON.stringify(value.operation) || JSON.stringify(previous?.control) !== JSON.stringify(value.control) || JSON.stringify(previous?.toolReceipt) !== JSON.stringify(value.toolReceipt) || JSON.stringify(previous?.commandAnnotations) !== JSON.stringify(value.commandAnnotations);
              if (changed || !previous) {
                const next = mergeTerminalFrame(terminalFramesRef.current[activeFrameKey], value);
                const frames = { ...terminalFramesRef.current, [activeFrameKey]: next };
                terminalFramesRef.current = frames;
                setTerminalFrames(frames);
              }
              if (value.status?.kind === "exited") { void refresh(); break; }
            } catch (cause) {
              if (cancelled || cause?.name === "AbortError") break;
              setOutputConnection("retrying");
              if (String(cause?.message).includes("TERMINAL_CURSOR_MISMATCH")) delete terminalFramesRef.current[activeFrameKey];
              if (refreshNotices.shouldNotify(cause)) setError(cause instanceof Error ? cause.message : String(cause));
              void refresh();
              await new Promise((resolve) => window.setTimeout(resolve, retryDelay(attempt++)));
            }
            controller = undefined;
          }
        };
        void poll();
        return () => { cancelled = true; controller?.abort(); };
      }, [activeFrameKey, activeTerminalId, activeSession?.disconnected, refresh, sessionId]);
      const rememberScroll = useTerminalViewport(outputRef, stickToBottom, activeFrameKey, terminalOutput, module, quickOpen, quickHeight, terminalUsesGrid(terminalScreen));
      const grouped = snapshot.groups.map((group) => ({ group, items: snapshot.environments.filter((item) => item.group === group && (!search || `${item.name} ${item.host} ${item.group}`.toLowerCase().includes(search.toLowerCase()))) }));
      const connect = async (env, create = false) => {
        if (!sessionId) { setError("REMOTE_SESSION_REQUIRED: 请先在 DSH 选择一个会话"); return; }
        setSelectedEnv(env.id);
        const value = create ? await action({ action: "open", environment: env.id }) : await workspaceAction({ action: "enter", environment: env.id });
        if (value?.sessionId) { setActiveSessionId(value.sessionId); setModule("terminal"); setDrawer(false); }
        if (value?.choices) setConnectionChoices(value.choices);
      };
      const openFromSshCommand = useCallback(async (command) => { const parsed = parseSshCommand(command); if (!parsed) { setError("当前没有活动 SSH 会话，请输入 ssh [user@]host 并按 Enter 连接。"); return; } if (parsed.error) { setError(parsed.error); return; } const saved = snapshot.environments.find((item) => item.host === parsed.host && Number(item.port ?? 22) === parsed.port && (!parsed.username || item.username === parsed.username)); if (!saved && !parsed.username) { setError("SSH 命令未指定用户名，且目标环境未保存；请使用 ssh user@host。 "); return; } const value = saved ? await action({ action: "open", environment: saved.id }) : await action({ action: "open-command", environment: parsed }); if (value?.sessionId) { setActiveSessionId(value.sessionId); setSelectedEnv(saved?.id ?? ""); pendingSshInputRef.current = ""; setPendingSshInput(""); } }, [action, snapshot.environments]);
      const flushRawInput = useCallback(async () => {
        if (rawInputSending.current) return;
        rawInputSending.current = true;
        try {
          while (rawInputQueue.current.length) {
            const input = rawInputQueue.current.shift();
            const target = input.session;
            const text = input.text;
            if (!target) {
              const buffered = pendingSshInputRef.current + text;
              const enterIndex = buffered.search(/[\r\n]/);
              if (enterIndex < 0) { pendingSshInputRef.current = buffered; setPendingSshInput(buffered); continue; }
              const command = buffered.slice(0, enterIndex).trim();
              const remainder = buffered.slice(enterIndex + 1);
              pendingSshInputRef.current = remainder;
              setPendingSshInput(remainder);
              if (command) await openFromSshCommand(command);
              continue;
            }
            const draftKey = `${input.sessionId ?? ""}:${input.session}:${input.streamId}`;
            const revision = rawInputRevision.current;
            try {
              await request("/api/dsh-remote-ops/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "input", ...input }) });
              if (revision === rawInputRevision.current && !rawInputQueue.current.some(next => next.sessionId === input.sessionId && next.session === input.session && next.streamId === input.streamId)) {
                if (manualDrafts.current.has(draftKey)) rememberTerminalDraft(draftKey, rawInputDrafts.current.get(draftKey));
                rawInputDrafts.current.delete(draftKey);
              }
            } catch (cause) {
              if (revision !== rawInputRevision.current) continue;
              rawInputQueue.current = [];
              rawInputDrafts.current.clear();
              setError(cause instanceof Error ? cause.message : String(cause));
              break;
            }
          }
        } finally {
          rawInputSending.current = false;
        }
      }, [activeSessionId, openFromSshCommand, sessionId, snapshot.bound, snapshot.localError, snapshot.sessions]);
      const queueRawInput = useCallback((text) => { if (!text || !terminalReady) return; if (quickSending.current) { setError("QUICK_DISPATCH_PENDING: 快捷命令正在下发，请稍后输入。"); return; } if (pasteSending.current) { setError("TERMINAL_INPUT_PENDING: 粘贴正在发送，请稍后输入。"); return; } const draftKey = `${sessionId ?? ""}:${activeTerminalId}:${activeTerminalFrame?.streamId}`; const pending = terminalDraftPending(Boolean(rawInputDrafts.current.has(draftKey) ? rawInputDrafts.current.get(draftKey) : manualDrafts.current.get(draftKey)), text); if (!rememberTerminalDraft(draftKey, true)) { setError(draftLimitMessage); return; } rawInputDrafts.current.set(draftKey, pending); queueTerminalInput(rawInputQueue.current, { session: activeTerminalId, sessionId, streamId: activeTerminalFrame?.streamId, text }); if (rawInputTimer.current || rawInputSending.current) return; rawInputTimer.current = window.setTimeout(() => { rawInputTimer.current = undefined; void flushRawInput(); }, 20); }, [activeTerminalId, flushRawInput, sessionId, terminalReady, activeTerminalFrame?.streamId]);
      useEffect(() => { rawInputRevision.current += 1; rawInputQueue.current = []; rawInputDrafts.current.clear(); pendingSshInputRef.current = ""; setPendingSshInput(""); setTerminalInput(""); }, [sessionId]);
      useEffect(() => () => { rawInputRevision.current += 1; if (rawInputTimer.current) window.clearTimeout(rawInputTimer.current); if (scrollIntentTimer.current) window.clearTimeout(scrollIntentTimer.current); rawInputQueue.current = []; rawInputDrafts.current.clear(); }, []);
      const keySequence = (event) => { if (event.ctrlKey && !event.altKey && !event.metaKey) { const key = event.key.toLowerCase(); if (key === "v") return undefined; if (key.length === 1 && key >= "a" && key <= "z") return String.fromCharCode(key.charCodeAt(0) - 96); if (key === "[") return "\u001b"; if (key === "\\") return "\u001c"; if (key === "]") return "\u001d"; if (key === "^") return "\u001e"; if (key === "_") return "\u001f"; if (key === " ") return "\u0000"; } if (event.key === "Tab") return event.shiftKey ? "\u001b[Z" : "\t"; const sequences = { Enter: "\r", Escape: "\u001b", Backspace: "\u007f", Delete: "\u001b[3~", ArrowUp: "\u001b[A", ArrowDown: "\u001b[B", ArrowRight: "\u001b[C", ArrowLeft: "\u001b[D", Home: "\u001b[H", End: "\u001b[F", PageUp: "\u001b[5~", PageDown: "\u001b[6~", Insert: "\u001b[2~" }; return sequences[event.key]; };
      const addGroup = async () => { const name = await askPanel("环境分组名称", ""); if (name) await action({ action: "group.create", name }); };
      const editGroup = async (group) => { const name = await askPanel("新的环境分组名称", group); if (name && name !== group) await action({ action: "group.rename", group, name }); };
      const openEnvironmentForm = (initial) => { setEnvironmentError(""); setEnvironmentTest(null); setEnvironmentForm({ mode: initial ? "edit" : "create", id: initial?.id ?? "", name: initial?.name ?? "", host: initial?.host ?? "", username: initial?.username ?? "root", group: initial?.group ?? snapshot.groups[0] ?? "default", port: String(initial?.port ?? 22), passwordRef: initial?.passwordRef === "configured" ? "" : initial?.passwordRef ?? "", password: "", privateKeyPath: initial?.privateKeyPath ?? "", credentialConfigured: initial?.passwordRef === "configured", ...environmentProfileValues(initial), ...environmentConnectionValues(initial) }); };
      const updateEnvironmentForm = (field, value) => setEnvironmentForm((current) => current ? { ...current, [field]: value } : current);
      const saveEnvironmentForm = async (event) => { event.preventDefault(); if (!environmentForm) return; const required = [["主机地址", environmentForm.host], ["用户名", environmentForm.username]]; const missing = required.find(([, value]) => !String(value ?? "").trim()); if (missing) { setEnvironmentError(`${missing[0]}不能为空`); return; } const port = Number(environmentForm.port); if (!Number.isInteger(port) || port < 1 || port > 65535) { setEnvironmentError("SSH 端口必须是 1-65535 的整数"); return; } const advanced = environmentProfileFromForm(environmentForm), connection = environmentConnectionFromForm(environmentForm); if (advanced.error || connection.error) { setEnvironmentError(advanced.error || connection.error); return; } const environment = { ...(environmentForm.id ? { id: environmentForm.id.trim() } : {}), name: environmentForm.name.trim() || environmentForm.host.trim(), host: environmentForm.host.trim(), username: environmentForm.username.trim(), group: environmentForm.group.trim() || "default", port, ...connection }; if (environmentForm.privateKeyPath.trim()) environment.privateKeyPath = environmentForm.privateKeyPath.trim(); environment.cliProfile = advanced.cliProfile; environment.terminal = advanced.terminal; const body = { action: "environment.save", environment }; if (environmentForm.password) body.password = environmentForm.password; const value = await action(body); if (value) { setEnvironmentForm(null); setEnvironmentTest(null); } };
      const testSavedEnvironment = async environment => { const value = await action({ action: "environment.test", environment: environment.id }); if (value) setEnvironmentTest(value); };
      const previewInput = async (text, target = activeSession) => {
        if (!target) { setError("TERMINAL_TARGET_REQUIRED: 请先选择终端"); return; }
        if (target.disconnected) { setError("REMOTE_SESSION_EXITED: 此连接已断开"); return; }
        try {
          const frame = await request(`/api/dsh-remote-ops/terminal?${new URLSearchParams({ session: target.sessionId, ...(sessionId ? { sessionId } : {}) })}`);
          if (viewOwner.current === sessionId) setPasteDraft({ text, session: target.sessionId, name: target.name, owner: sessionId, streamId: frame.streamId });
        } catch (cause) { setError(cause.message); }
      };
      const submitPaste = async () => {
        try {
          if (pasteSending.current || rawInputSending.current || rawInputQueue.current.length) { setError("TERMINAL_INPUT_PENDING: 终端输入正在发送，请稍后再次确认粘贴。"); return; }
          const revision = rawInputRevision.current;
          const input = pasteSubmission(pasteDraft, sessionId);
          const key = `${sessionId ?? ""}:${input.session}:${input.streamId}`;
          const pending = terminalDraftPending(manualDrafts.current.get(key), input.text);
          if (pending && !rememberTerminalDraft(key, true)) { setError(draftLimitMessage); return; }
          let value;
          pasteSending.current = true;
          try { value = await action({ action: "input", ...input }); } finally { pasteSending.current = false; }
          if (value && revision === rawInputRevision.current) { if (manualDrafts.current.has(key)) rememberTerminalDraft(key, pending); setPasteDraft(null); }
        } catch (cause) { setError(cause.message); }
      };
      const dismissTabs = targets => {
        const ids = new Set(targets);
        if (dismissedTabs.current.owner !== sessionId) dismissedTabs.current = { owner: sessionId, ids: new Set() };
        for (const id of ids) dismissedTabs.current.ids.add(id);
        while (dismissedTabs.current.ids.size > 512) dismissedTabs.current.ids.delete(dismissedTabs.current.ids.values().next().value);
        knownTabs.current.tabs = knownTabs.current.tabs.filter(item => !ids.has(item.sessionId));
        setSnapshot(current => ({ ...current, sessions: current.sessions.filter(item => !ids.has(item.sessionId)), tabs: (current.tabs ?? []).filter(item => !ids.has(item.sessionId)) }));
        setActiveSessionId(current => ids.has(current) ? "local-cmd" : current);
      };
      const dismissTab = target => dismissTabs([target]);
      const releaseSession = async session => {
        if (session.disconnected && terminalTabStatus(session).state !== "busy") { dismissTab(session.sessionId); return; }
        const owner = sessionId, revision = viewRevision.current;
        if (!await askPanel(`关闭连接“${session.name}”？这会结束该终端会话，取消关联命令的等待；远端进程不一定随之停止。`)) return;
        if (viewOwner.current !== owner || viewRevision.current !== revision) return;
        const value = await action({ action: "close", session: session.sessionId });
        if (value?.closed) dismissTab(session.sessionId);
      };
      const releaseAll = async () => {
        const owner = sessionId, revision = viewRevision.current;
        if (!owner || closeBatch.current?.owner === owner) return;
        const selection = terminalCloseSelection(tabs, { [activeTerminalId]: activeTerminalFrame });
        if (!selection.targets.length) return;
        const batch = { owner, revision };
        closeBatch.current = batch; setClosingAll(true);
        const current = () => viewOwner.current === owner && viewRevision.current === revision;
        try {
          if ((selection.connected || selection.operating) && !await askPanel(`关闭当前对话的 ${selection.targets.length} 个 SSH 标签？${selection.connected} 个连接未断开，${selection.operating} 个正在操作，${selection.targets.length - selection.connected} 个终端已断开。保留本地 CMD、环境配置和可导出的日志。操作可能中断，远端进程不一定随之停止。`)) return;
          if (!current()) return;
          const result = await action({ action: "close-many", sessions: selection.targets.map(item => item.sessionId) });
          if (!result || !current()) return;
          const outcome = terminalCloseResult(selection.targets, result.results);
          dismissTabs(outcome.closed);
          setActionNotice(`已关闭 ${outcome.closed.length} 个 SSH 标签${outcome.failures.length ? `，${outcome.failures.length} 个未完成` : "，本地 CMD 已保留"}`);
          if (outcome.failures.length) setError("部分 SSH 标签未关闭\n" + outcome.failures.join("\n"));
        } finally {
          if (closeBatch.current === batch) closeBatch.current = null;
          if (current()) setClosingAll(false);
        }
      };
      const [logExporting, setLogExporting] = useState(false);
      const exportLogs = async all => {
        if (logExporting) return;
        const owner = sessionId, revision = viewRevision.current;
        const current = () => viewOwner.current === owner && viewRevision.current === revision;
        setLogExporting(true);
        try {
          const call = body => request("/api/dsh-remote-ops/logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId: owner }) });
          let selection = { all: true, format: "zip" };
          if (!all) {
            const catalog = await call({ action: "list" });
            const log = catalog.logs.find(item => item.sessionId === activeTerminalId && (!activeTerminalFrame?.streamId || item.streamId === activeTerminalFrame.streamId));
            if (!log) throw new Error("TERMINAL_LOG_NOT_FOUND: 此终端的记录已不可用，请刷新后重试。");
            selection = { logIds: [log.logId], format: "txt" };
          }
          if (!current()) return;
          const result = await call({ action: "export", ...selection });
          if (!current()) return;
          const link = document.createElement("a"); link.href = result.downloadPath; link.download = result.filename; link.click();
          setError(""); setActionNotice(`已生成 ${result.manifest.logs.length} 份终端日志${result.manifest.logs.some(item => item.truncated) || result.manifest.evictedLogs ? " · 部分历史已截断，详见文件说明" : ""}`);
        } catch (cause) { if (current()) setError(cause.message); }
        finally { setLogExporting(false); }
      };
      const reconnect = async () => {
        if (!activeEnvironment || !await askPanel(`重新连接“${activeSession.name}”？不会重发任何命令。`)) return;
        const previous = activeSession.sessionId;
        const value = await action({ action: "open", environment: activeEnvironment.id });
        if (value?.sessionId) { dismissTab(previous); setActiveSessionId(value.sessionId); }
      };
      const renderEnvironment = (env) => {
        const connections = snapshot.sessions.filter((item) => item.kind === "ssh" && item.environmentId === env.id);
        return h("div", { className: "dsh-remote-ops__env", key: env.id },
          h("span", { className: "dsh-remote-ops__dot", "data-connected": Boolean(env.connectionCount) }),
          h("div", { className: "dsh-remote-ops__envInfo", onClick: () => setSelectedEnv(env.id), onDoubleClick: () => void connect(env) },
            h("div", { className: "dsh-remote-ops__envName" }, env.name),
            h("div", { className: "dsh-remote-ops__envMeta" }, `${env.username}@${env.host}:${env.port ?? 22} · ${env.connectionCount ? "已连接" : "未连接"} · ${env.connectionCount ?? 0}/${env.maxConnections ?? 3}`),
          ),
          h("button", { className: "dsh-remote-ops__tiny", disabled: busy || !sessionId, onClick: () => void connect(env), title: "进入已有连接；没有连接时新建" }, "进入"),
          h("button", { className: "dsh-remote-ops__tiny", disabled: busy || !sessionId || (env.connectionCount ?? 0) >= (env.maxConnections ?? 3), onClick: () => void connect(env, true), title: "新建独立连接", "aria-label": `新建 ${env.name} 连接` }, "+"),
          h("button", { className: "dsh-remote-ops__tiny", onClick: () => openEnvironmentForm(env) }, "编辑"),
          h("button", { className: "dsh-remote-ops__tiny", disabled: busy, "aria-label": `测试 ${env.name} 连接`, onClick: () => void testSavedEnvironment(env) }, "测试"),
          h("button", { className: "dsh-remote-ops__tiny dsh-remote-ops__dangerAction", onClick: async () => { if (await askPanel(`删除环境“${env.name}”？`)) void action({ action: "environment.delete", environment: env.id }); } }, "×"),
          connections.length ? h("div", { className: "dsh-remote-ops__envConnections" }, connections.map((session, index) => h("div", { className: "dsh-remote-ops__envConnection", key: session.sessionId }, h("button", { className: "dsh-remote-ops__connectionLink", title: `会话：${session.ownerId} · 最近活动：${session.lastActivity ? new Date(session.lastActivity).toLocaleString() : "暂无"}`, onClick: () => { setActiveSessionId(session.sessionId); setSelectedEnv(env.id); setModule("terminal"); setDrawer(false); } }, `连接 ${index + 1} · ${session.status?.kind === "running" ? "已连接" : "已退出"}`), h("button", { className: "dsh-remote-ops__tiny dsh-remote-ops__dangerAction", disabled: busy, title: "释放这个具体连接", onClick: () => void releaseSession(session) }, "释放")))) : null,
        );
      };
      const renderEnvironmentGroup = ({ group, items }) => h("section", { className: "dsh-remote-ops__group", key: group },
        h("div", { className: "dsh-remote-ops__groupTitle" },
          h("span", null, "▾ ", group),
          h("button", { className: "dsh-remote-ops__tiny", onClick: () => void editGroup(group) }, "编辑"),
          h("button", { className: "dsh-remote-ops__tiny", onClick: async () => { if (await askPanel(`删除空分组“${group}”？`)) void action({ action: "group.delete", group }); } }, "×"),
        ),
        items.length ? items.map(renderEnvironment) : h("div", { className: "dsh-remote-ops__muted", style: { padding: "4px" } }, "空分组"),
      );
      const environmentFormView = environmentForm ? h("form", { className: "dsh-remote-ops__form", onSubmit: saveEnvironmentForm },
        h("strong", null, environmentForm.mode === "edit" ? "编辑环境" : "新增环境"),
        environmentError ? h("div", { role: "alert", className: "dsh-remote-ops__dangerAction" }, environmentError) : null,
        h("label", null, "显示名称", h("input", { value: environmentForm.name, onChange: (event) => updateEnvironmentForm("name", event.target.value), placeholder: "生产环境" })),
        h("label", null, "主机地址", h("input", { value: environmentForm.host, onChange: (event) => updateEnvironmentForm("host", event.target.value), placeholder: "192.168.1.10" })),
        h("div", { className: "dsh-remote-ops__row" },
          h("label", { style: { flex: 1 } }, "用户名", h("input", { autoComplete: "username", value: environmentForm.username, onChange: (event) => updateEnvironmentForm("username", event.target.value), placeholder: "root" })),
          h("label", { style: { width: "72px" } }, "端口", h("input", { value: environmentForm.port, onChange: (event) => updateEnvironmentForm("port", event.target.value), inputMode: "numeric" })),
        ),
        h("label", null, "环境分组", h("input", { value: environmentForm.group, onChange: (event) => updateEnvironmentForm("group", event.target.value), placeholder: "default" })),
        h("label", null, "目标系统", h("select", { "aria-label": "目标系统", value: environmentForm.platform, onChange: event => { updateEnvironmentForm("platform", event.target.value); if (event.target.value === "posix") updateEnvironmentForm("shell", "server-default"); } }, [["auto", "自动 / 设备 CLI"], ["windows", "Windows 桌面 / Server"], ["posix", "Linux / Unix"]].map(([value, label]) => h("option", { key: value, value }, label)))),
        h("label", null, "SSH Shell", h("select", { "aria-label": "SSH Shell", value: environmentForm.shell, disabled: environmentForm.platform === "posix", onChange: event => updateEnvironmentForm("shell", event.target.value) }, [["server-default", "服务器默认"], ["cmd", "CMD"], ["windows-powershell", "Windows PowerShell 5.1"], ["pwsh", "PowerShell 7（需目标已安装）"]].map(([value, label]) => h("option", { key: value, value }, label)))),
        h("details", { className: "dsh-remote-ops__formAdvanced" }, h("summary", null, "连接、编码与主机指纹"), h("div", { className: "dsh-remote-ops__formAdvancedBody" },
          h("label", null, "连接超时（毫秒）", h("input", { value: environmentForm.readyTimeoutMs, inputMode: "numeric", onChange: event => updateEnvironmentForm("readyTimeoutMs", event.target.value) })),
          h("label", null, "默认 Shell 输入 / 输出编码", h("select", { "aria-label": "默认 Shell 输入 / 输出编码", value: environmentForm.encoding, onChange: event => updateEnvironmentForm("encoding", event.target.value) }, ["utf-8", "gb18030", "big5", "windows-1252", "iso-8859-1"].map(value => h("option", { key: value, value }, value)))),
          h("label", null, "已核对的主机指纹（可选）", h("input", { value: environmentForm.hostKeySha256, placeholder: "SHA256:…", onChange: event => updateEnvironmentForm("hostKeySha256", event.target.value) })),
          h("p", { className: "dsh-remote-ops__formNote" }, "指定 Windows Shell 时使用 UTF-8，仅影响新连接。未固定指纹时首次连接记录主机密钥，后续变化会拒绝连接；可向管理员核对后填写指纹。"))),
        h(EnvironmentPasswordField, { key: environmentForm.id || "new", id: "remote-ops-password-" + encodeURIComponent(sessionId ?? "local"), environmentId: environmentForm.id, configured: environmentForm.credentialConfigured, value: environmentForm.password, onChange: value => updateEnvironmentForm("password", value) }),
        h("label", null, "私钥路径", h("input", { value: environmentForm.privateKeyPath, onChange: (event) => updateEnvironmentForm("privateKeyPath", event.target.value), placeholder: "可选，本机路径" })),
        environmentAdvancedFields(environmentForm, updateEnvironmentForm),
        h("div", { className: "dsh-remote-ops__formNote" }, `${environmentForm.credentialConfigured ? "凭据已配置；密码留空保持原密码，输入新密码会更新凭据。" : "输入 SSH 密码后由系统自动保存到 Harness credentials；凭据引用由系统管理。"} 名称留空时使用主机地址。`),
        h("div", { className: "dsh-remote-ops__formActions" },
          h("button", { type: "button", className: "dsh-remote-ops__tiny", onClick: () => setEnvironmentForm(null) }, "取消"),
          h("button", { type: "submit", className: "dsh-remote-ops__tiny", disabled: busy }, busy ? "保存中…" : "保存"),
        ),
      ) : null;
      const envDrawer = drawer && environmentKind === "ssh" ? h("aside", { className: "dsh-remote-ops__drawer" },
        h("div", { className: "dsh-remote-ops__drawerBody" },
          environmentFormView ?? h(React.Fragment, null,
            environmentTest ? h("section", { className: "dsh-remote-ops__form", "aria-label": "SSH 连接诊断", role: "status" }, h("strong", null, `${environmentTest.endpoint} · ${environmentTest.ok ? "检测通过" : "部分能力未通过"}`), environmentTest.detected ? h("p", null, `${environmentTest.detected.osName} ${environmentTest.detected.osVersion ?? ""} · ${environmentTest.detected.cwd ?? ""}`) : null, environmentTest.identity ? h("p", { style: { overflowWrap: "anywhere" } }, `主机指纹 ${environmentTest.identity.fingerprint} · ${environmentTest.identity.trust === "first-use" ? "首次记录，请核对" : environmentTest.identity.trust === "pinned" ? "已固定" : "与记录一致"}`) : null, environmentTest.stages.map((item, index) => h("div", { key: index }, `${item.ok ? "✓" : "×"} ${({ connection: "SSH 连接", authentication: "身份验证", platform: "系统识别", shell: "交互 Shell", sftp: "SFTP", "sftp-path": "SFTP 路径", "host-key": "主机身份" })[item.stage] ?? item.stage}${item.message ? " · " + item.message : ""}`)), h("button", { type: "button", onClick: () => setEnvironmentTest(null) }, "收起诊断")) : null,
            h("div", { className: "dsh-remote-ops__tools" }, h("input", { type: "search", "aria-label": "搜索 SSH 环境", value: search, onChange: event => setSearch(event.target.value), placeholder: "搜索环境" }),
              h("button", { onClick: addGroup }, "+ 分组"), h("button", { onClick: () => openEnvironmentForm() }, "+ 环境")),
            grouped.map(renderEnvironmentGroup), snapshot.groups.length ? null : h("div", { className: "dsh-remote-ops__emptyList" }, "还没有环境。点击“+ 环境”保存连接。")))) : null;
      const quickPanel = h(QuickCommands, { commands: snapshot.quickCommands, groups: snapshot.quickGroups, owner: sessionId, target: activeSession, frame: activeTerminalFrame, ready: terminalReady, open: quickOpen, setOpen: setQuickOpen, height: quickHeight, setHeight: setQuickHeight, action, workspaceAction, onSending: value => { quickSending.current = value; }, hidden: module !== "terminal" || drawer || diagnosticsOpen || !!settingsTab, inputPending: () => Boolean(pasteSending.current || rawInputSending.current || rawInputQueue.current.length || composingRef.current || terminalInputRef.current?.value || manualDrafts.current.get(`${sessionId ?? ""}:${activeTerminalId}:${activeTerminalFrame?.streamId}`)) });
      const markUserScrollIntent = (event) => {
        if (event?.type === "pointerdown" && event.clientX < event.currentTarget.getBoundingClientRect().right - 18) return;
        userScrollIntent.current = true;
        if (scrollIntentTimer.current) window.clearTimeout(scrollIntentTimer.current);
        scrollIntentTimer.current = window.setTimeout(() => { userScrollIntent.current = false; scrollIntentTimer.current = undefined; }, 250);
      };
      const terminalInputCapture = h("textarea", { ref: terminalInputRef, className: "dsh-remote-ops__inputCapture", value: terminalInput, readOnly: !terminalReady, spellCheck: false, autoCapitalize: "off", autoCorrect: "off", "aria-label": "终端输入", onFocus: () => setInputFocused(true), onBlur: () => setInputFocused(false), onCompositionStart: () => { composingRef.current = true; }, onCompositionEnd: () => { composingRef.current = false; }, onChange: (event) => { const value = event.target.value; const completed = terminalInputCompositionValue(value, composingRef.current || event.isComposing || event.nativeEvent?.isComposing); setTerminalInput(value); if (completed !== undefined) { if (completed) queueRawInput(completed); setTerminalInput(""); } }, onKeyDown: (event) => { if (event.isComposing || event.nativeEvent?.isComposing || composingRef.current) return; const sequence = keySequence(event); if (sequence !== undefined) { event.preventDefault(); queueRawInput(sequence); setTerminalInput(""); } }, onPaste: (event) => { event.preventDefault(); const text = event.clipboardData.getData("text"); if (/[\r\n]/.test(text)) previewInput(text); else queueRawInput(text); } });
      const jumpToLatest = () => { stickToBottom.current = true; setUnreadOutput(false); const node = outputRef.current; if (node) node.scrollTop = node.scrollHeight; terminalInputRef.current?.focus(); };
      const activityLabel = { waiting: "等待回传", inferred_idle: "静默 · 完成未知", timeout: "等待超时", cancelled: "已中断等待", session_exit: "已退出" }[activeTerminalFrame?.activity];
      const inputControl = activeTerminalFrame?.control ?? activeSession?.control ?? {};
      const terminalPanelId = "remote-ops-terminal-panel-" + encodeURIComponent(sessionId ?? "local");
      const terminalTabId = id => "remote-ops-terminal-tab-" + encodeURIComponent(sessionId ?? "local") + "-" + encodeURIComponent(id);
      const selectTerminal = item => { setActiveSessionId(item.sessionId); setSelectedEnv(item.environmentId); stickToBottom.current = true; };
      const terminalTabs = h("div", { className: "dsh-remote-ops__tabs", role: "tablist", "aria-label": "终端会话", ref: terminalTabsRef }, tabs.map((item, index) => {
        const status = terminalTabStatus(item, item.sessionId === activeTerminalId ? activeTerminalFrame : undefined);
        return h("div", { className: "dsh-remote-ops__tab", key: item.sessionId, "data-active": activeTerminalId === item.sessionId, role: "presentation" },
          h("button", { type: "button", role: "tab", id: terminalTabId(item.sessionId), "aria-label": item.name, "aria-selected": activeTerminalId === item.sessionId, "aria-controls": terminalPanelId, tabIndex: activeTerminalId === item.sessionId ? 0 : -1,
            title: `${item.name} · ${status.label}${terminalUnread[item.sessionId] ? " · 有新输出" : ""} · ${item.sessionId}`, "aria-description": status.label,
            onClick: event => { selectTerminal(item); if (event.detail > 0) terminalInputRef.current?.focus({ preventScroll: true }); },
            onKeyDown: event => { const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key]; if (next !== undefined) { event.preventDefault(); selectTerminal(tabs[next]); const target = terminalTabsRef.current?.querySelectorAll('[role="tab"]')[next]; target?.focus({ preventScroll: true }); target?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); } }
          }, h("span", { className: "dsh-remote-ops__connectionState", "data-state": status.state, "aria-hidden": true }), h("span", { className: "dsh-remote-ops__tabName" }, item.name), item.disconnected || terminalUnread[item.sessionId] ? h("span", { className: "dsh-remote-ops__tabState", "aria-hidden": true }, item.disconnected ? "已断开" : "●") : null),
          item.kind === "ssh" ? h("button", { type: "button", className: "dsh-remote-ops__tabClose", title: status.state === "busy" ? "关闭标签并取消关联等待" : item.disconnected ? "关闭记录" : "释放此连接", "aria-label": `释放${item.name}`, disabled: busy, onClick: event => { event.stopPropagation(); void releaseSession(item); } }, h(IconCloseOutline16, { "aria-hidden": true })) : null); }));
      const terminalLocation = localActive ? activeSession.workingDirectory : connectedEndpoint ? `${connectedEndpoint.username}@${connectedEndpoint.host}:${connectedEndpoint.port ?? 22}` : activeSession?.sessionId;
      const terminal = h("section", { className: "dsh-remote-ops__terminal", hidden: module !== "terminal" || drawer || diagnosticsOpen || !!settingsTab },
        h("div", { className: "dsh-remote-ops__terminalHead" },
          terminalTabs,
        h("div", { className: "dsh-remote-ops__toolbar dsh-remote-ops__terminalActions" },
          tabs.some(item => item.kind === "ssh") ? h("button", { type: "button", className: "dsh-remote-ops__closeAll", title: "关闭当前对话全部 SSH 标签，保留本地 CMD", "aria-label": "全部关闭 SSH 标签", "aria-busy": closingAll, disabled: busy || closingAll || !sessionId, onClick: () => void releaseAll() }, closingAll ? "关闭中…" : "全部关闭") : null,
          h("button", { title: "搜索输出", "aria-label": "搜索输出", "aria-expanded": searchOpen, onClick: () => setSearchOpen(value => !value) }, h(IconSearchOutline16)),
          h("button", { title: "导出当前终端 TXT", "aria-label": "导出当前终端 TXT", disabled: logExporting || !activeSession, onClick: () => void exportLogs(false) }, h(IconDownloadOutline16)),
          h("details", { className: "dsh-remote-ops__terminalLook dsh-remote-ops__operationMenu", onKeyDown: event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } } },
            h("summary", { "aria-label": "终端操作", title: "更多终端操作" }, "更多", h(IconChevronDownOutline14)), h("div", null,
            h("button", { disabled: !sessionId || !activeSession || activeSession.disconnected, onClick: event => { const menu = event.currentTarget.closest("details"); menu.open = false; menu.querySelector("summary")?.focus(); setCommandTarget({ ...activeSession }); } }, "独立命令"),
            h("button", { disabled: logExporting, onClick: event => { event.currentTarget.closest("details").open = false; void exportLogs(true); } }, "一键打包本会话全部日志"),
            h("small", null, "包含仍保留的已关闭终端。"),
            h("button", { onClick: event => { event.currentTarget.closest("details").open = false; const details = outputRef.current?.closest("section")?.querySelector(".dsh-remote-ops__statusDetails"); if (details) { details.open = true; details.querySelector("summary")?.focus(); } } }, "连接与输出详情")))
        )
        ),
        activeSession?.disconnected ? h("div", { className: "dsh-remote-ops__toolbar", role: "status" }, h("span", { title: "不会自动重放任何命令" }, `连接已断开 · 保留最后输出${snapshot.disconnects?.find((item) => item.sessionId === activeSession.sessionId)?.reason ? ` · ${snapshot.disconnects.find((item) => item.sessionId === activeSession.sessionId).reason}` : ""}`), activeEnvironment ? h("button", { disabled: busy, onClick: () => void reconnect() }, "重新连接") : null, h("button", { disabled: busy, onClick: () => void releaseSession(activeSession) }, terminalTabStatus(activeSession).state === "busy" ? "关闭标签并取消等待" : "关闭记录")) : null,
        reviewStream === activeFrameKey ? h("div", { className: "dsh-remote-ops__toolbar", role: "status" }, "终端已重建", h("button", { onClick: () => { setReviewStream(null); terminalInputRef.current?.focus(); } }, "启用新终端输入")) : null,
        searchOpen ? h("div", { className: "dsh-remote-ops__toolbar" }, h("input", { className: "dsh-remote-ops__search", "aria-label": "搜索终端输出", value: outputSearch, onChange: event => { setOutputSearch(event.target.value); setMatchIndex(0); }, onKeyDown: event => { if (event.key === "Enter") moveMatch(event.shiftKey ? -1 : 1); } }), h("span", null, `${matches.length ? matchIndex % matches.length + 1 : 0}/${matches.length}`), h("button", { disabled: !matches.length, title: "上一处", "aria-label": "上一处匹配", onClick: () => moveMatch(-1) }, "↑"), h("button", { disabled: !matches.length, title: "下一处", "aria-label": "下一处匹配", onClick: () => moveMatch(1) }, "↓")) : null,
        activeSession ? h("div", { className: "dsh-remote-ops__screen", role: "tabpanel", id: terminalPanelId, "aria-labelledby": terminalTabId(activeTerminalId), "data-focused": inputFocused, onClick: () => { if (!window.getSelection()?.toString()) terminalInputRef.current?.focus(); } },
          h("pre", { className: "dsh-remote-ops__output", ref: outputRef, style: { fontSize: preferences.fontSize, whiteSpace: preferences.wrap && !terminalUsesGrid(terminalScreen) ? "pre-wrap" : "pre", overflowWrap: preferences.wrap && !terminalUsesGrid(terminalScreen) ? "anywhere" : "normal" }, tabIndex: 0, "aria-label": "终端输出", onWheel: markUserScrollIntent, onPointerDown: markUserScrollIntent, onScroll: (event) => { const node = event.currentTarget; rememberScroll(node); const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48; if (userScrollIntent.current) stickToBottom.current = nearBottom; else if (nearBottom) stickToBottom.current = true; if (nearBottom) setUnreadOutput(false); } }, terminalOutputView),
          terminalInputCapture,
          unreadOutput ? h("button", { className: "dsh-remote-ops__newOutput", onClick: jumpToLatest, title: "回到最新输出" }, "↓ 新输出") : null,
        ) : h("div", { className: "dsh-remote-ops__screen dsh-remote-ops__screenEmpty", onClick: () => terminalInputRef.current?.focus() }, h("div", { className: "dsh-remote-ops__empty" }, h("div", null, h("div", { style: { fontSize: "22px", marginBottom: "8px" } }, "›_"), h("div", null, terminalReady ? "输入 ssh [user@]host 并按 Enter 连接，或从环境抽屉选择环境。" : "等待本地 CMD 启动…"), pendingSshInput ? h("pre", { className: "dsh-remote-ops__pendingCommand" }, pendingSshInput) : null)), terminalInputCapture, h("div", { className: "dsh-remote-ops__screenHint" }, terminalReady ? "输入 SSH 命令 · Enter 连接" : "等待本地 CMD 启动…")),
        h("div", { className: "dsh-remote-ops__terminalStatus", role: "status" },
          logExporting ? h("span", null, "正在打包日志…") : null,
          h("span", { "data-state": outputConnection }, activeSession ? activeSession.disconnected ? "已断开" : outputConnection === "connected" ? "实时输出" : outputConnection === "retrying" ? "输出重连中" : "同步中" : "未连接"),
          h("span", { className: "dsh-remote-ops__terminalLocation", title: terminalLocation }, terminalLocation),
          h("details", { className: "dsh-remote-ops__statusDetails" }, h("summary", null, "状态详情"), h("div", null,
          h("span", null, "你与 Agent 共享此终端"),
          h("span", { title: "Agent 绑定状态，不代表 Agent 已读取当前输出" }, snapshot.bound ? "Agent 已绑定" : "Agent 未绑定"),
          h("span", { title: activeTerminalFrame?.toolReceipt ? JSON.stringify(activeTerminalFrame.toolReceipt) : "尚未产生此输出流的工具读取回执" }, activeTerminalFrame?.toolReceipt ? "工具已返回 · " + new Date(activeTerminalFrame.toolReceipt.at).toLocaleTimeString() + (activeTerminalFrame.toolReceipt.newOutput ? " · 有新输出" : "") : "工具未读取"),
          h("span", { className: "dsh-remote-ops__sessionIdentity", title: activeTerminalId }, activeTerminalId ? `${localActive ? "本地" : "SSH"} · ${activeTerminalId.slice(-12)}` : ""),
          activityLabel ? h("span", { title: "PTY 存活与命令完成是不同状态" }, activityLabel) : null,
          activeTerminalFrame?.truncated ? h("span", { title: "历史已截断或输出流已重建" }, "历史已重置") : null)),
        ),
      );
      const closeFiles = useCallback(() => setModule("terminal"), []);
      const sftpWorkspace = filesVisited ? h(MemoFileWorkspace, { key: sessionId, sessionId, environments: snapshot.environments, initialEnvironment: activeEnvironment?.id, onError: setError, onClose: closeFiles, visible: module === "sftp" && !drawer && !diagnosticsOpen && !settingsTab }) : null;
      const aux = diagnosticsOpen ? h("section", { className: "dsh-remote-ops__diagnostics", "aria-label": "诊断" },
        h("div", { className: "dsh-remote-ops__drawerHead" }, h("strong", null, "诊断"), h("button", { onClick: async () => { const report = await workspaceAction({ action: "diagnostics" }); if (report) setDiagnosticPreview(JSON.stringify(report, null, 2)); } }, "预览导出"), h("button", { className: "dsh-remote-ops__drawerClose", "aria-label": "关闭诊断", onClick: () => setDiagnosticsOpen(false) }, h(IconCloseOutline16))),
        h("div", { className: "dsh-remote-ops__diagnosticEvents" }, (snapshot.events ?? []).slice().reverse().map((item, index) => h("details", { key: index }, h("summary", null, h("span", null, item.kind ?? item.type ?? item.event ?? "事件"), h("time", null, item.at ? new Date(item.at).toLocaleTimeString() : ""), item.status ? h("span", null, item.status) : null), h("pre", null, JSON.stringify(item, null, 2)))), !(snapshot.events ?? []).length ? h("div", { className: "dsh-remote-ops__empty" }, "暂无事件") : null)) : null;
      const modal = (title, close, content) => h(ModalDialog, { title, onClose: close }, content);
      const pasteView = pasteDraft ? modal("确认终端输入", () => setPasteDraft(null), h(React.Fragment, null, h("strong", null, `目标：${pasteDraft.name}`), h("small", null, pasteDraft.session), h("textarea", { autoFocus: true, "aria-label": "待发送内容", spellCheck: false, value: pasteDraft.text, onChange: event => setPasteDraft(current => ({ ...current, text: event.target.value })) }), /[\r\n]/.test(pasteDraft.text) ? h("strong", { className: "dsh-remote-ops__dangerAction" }, "包含换行，将提交命令") : null, h("div", { className: "dsh-remote-ops__formActions" }, h("button", { onClick: () => setPasteDraft(null) }, "取消"), h("button", { disabled: busy || !pasteDraft.text, onClick: () => void submitPaste() }, "发送到此终端")))) : null;
      const choicesView = connectionChoices ? modal("选择连接", () => setConnectionChoices(null), connectionChoices.map(item => h("button", { key: item.sessionId, onClick: () => { setActiveSessionId(item.sessionId); setModule("terminal"); setConnectionChoices(null); setDrawer(false); } }, `${item.name} · ${item.ownerId} · ${item.lastActivity ? new Date(item.lastActivity).toLocaleTimeString() : "暂无活动"}`))) : null;
      const diagnosticsView = diagnosticPreview !== null ? modal("诊断导出预览", () => setDiagnosticPreview(null), h(React.Fragment, null, h("pre", null, diagnosticPreview), h("button", { onClick: () => { const url = URL.createObjectURL(new Blob([diagnosticPreview], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "remote-ops-diagnostics.json"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } }, h(IconDownloadOutline16), " 导出 JSON"))) : null;
      const workspaces = [["terminal", "终端", RemoteOpsIcon], ["browser", "网页", BrowserIcon], ["desktop", "桌面", DesktopIcon], ["sftp", "文件", IconFolderClose16], ["api", "API", ApiIcon]];
      const uiKey = encodeURIComponent(sessionId ?? "local");
      const closeSettings = () => { setSettingsTab(""); changeUpdateOpen(false); };
      const openSettings = (tab = module === "browser" ? "browser" : module === "terminal" ? "terminal" : "general") => {
        setSettingsTab(tab); setDrawer(false); setDiagnosticsOpen(false);
        if (tab === "browser") setBrowserVisited(true);
        if (tab === "updates") { setUpdatesVisited(true); changeUpdateOpen(true); } else changeUpdateOpen(false);
      };
      const openEnvironments = (kind = module === "api" ? "api" : "ssh") => { setEnvironmentKind(kind); setDrawer(true); closeSettings(); setDiagnosticsOpen(false); if (kind === "api") setApiVisited(true); };
      const returnToWorkspace = event => {
        const trigger = event.currentTarget.closest(".dsh-remote-ops")?.querySelector('[aria-label="' + (drawer ? "环境管理" : "设置") + '"]');
        setDrawer(false); closeSettings(); trigger?.focus({ preventScroll: true });
      };
      const selectWorkspace = id => { if (id === "sftp") setFilesVisited(true); if (id === "browser") setBrowserVisited(true); if (id === "api") setApiVisited(true); if(id==="desktop")setDesktopVisited(true); setModule(id); setDrawer(false); setDiagnosticsOpen(false); closeSettings(); };
      const settingsCategories = [["general","通用"],["terminal","终端"],["browser","网页"],["updates","更新"]];
      const settingsHead = settingsTab ? h("section", {className:"dsh-remote-ops__utilityHead", "aria-label":"设置中心"},
        h("div", {className:"dsh-remote-ops__drawerHead"}, h("strong",null,"设置"), h("button", {onClick:returnToWorkspace,"aria-label":"返回工作区"}, "返回工作区")),
        h("div", {className:"dsh-remote-ops__subTabs",role:"tablist","aria-label":"设置分类"}, settingsCategories.map(([id,label],index)=>h("button", {key:id,id:"settings-tab-"+uiKey+"-"+id,role:"tab","aria-selected":settingsTab===id,"aria-controls":"settings-panel-"+uiKey+"-"+id,tabIndex:settingsTab===id?0:-1,onClick:()=>openSettings(id),onKeyDown:event=>{const next={ArrowRight:(index+1)%4,ArrowLeft:(index+3)%4,Home:0,End:3}[event.key];if(next!==undefined){event.preventDefault();openSettings(settingsCategories[next][0]);event.currentTarget.parentElement.children[next]?.focus();}}},label)))) : null;
      const settingsPanelProps = id => ({className:"dsh-remote-ops__moduleHost",hidden:settingsTab!==id,role:"tabpanel",id:"settings-panel-"+uiKey+"-"+id,"aria-labelledby":"settings-tab-"+uiKey+"-"+id});
      const settingsGeneral = h("div", settingsPanelProps("general"), h("div", {className:"dsh-remote-ops__settingsBody"},
        h("h3",null,"外观与状态"),h("label",null,"界面密度",h("select",{"aria-label":"界面密度",value:density,onChange:event=>changeDensity(event.target.value)},h("option",{value:"comfortable"},"舒适"),h("option",{value:"compact"},"紧凑"))),
        h("div",{className:"dsh-remote-ops__settingsActions"},h("button",{disabled:refreshBusy,"aria-label":"刷新状态",onClick:()=>void refreshNow()},"刷新状态"),h("button",{"aria-label":"诊断",onClick:()=>{setDiagnosticsOpen(true);setSettingsTab("");}},"诊断记录")),h("p",{className:"dsh-remote-ops__muted"},`Remote Ops v${snapshot.pluginVersion ?? update.currentVersion ?? "?"}`)));
      const settingsTerminal = h("div", settingsPanelProps("terminal"), h("div", {className:"dsh-remote-ops__settingsBody"},h("h3",null,"终端显示"),
          h("label", null, "字号", h("input", { type: "number", min: 11, max: 22, "aria-label": "终端字号", value: preferences.fontSize, onChange: event => setPreferences(current => terminalPreferences({ ...current, fontSize: event.target.value })) })),
          h("label", null, h("input", { type: "checkbox", checked: preferences.wrap, onChange: event => setPreferences(current => ({ ...current, wrap: event.target.checked })) }), "换行"),
          h("label", null, h("input", { type: "checkbox", checked: preferences.highlight, onChange: event => setPreferences(current => ({ ...current, highlight: event.target.checked })) }), "命令与关键状态高亮"),
          !localActive && activeSession && !activeSession.disconnected ? h(React.Fragment, null,
            h("h3", null, "当前 SSH 连接"), h("p", { className: "dsh-remote-ops__muted" }, activeSession.name + " · " + terminalLocation),
            terminalSizeSelect(activeTerminalFrame?.size, busy, (size) => void action({ action: "resize", session: activeTerminalId, ...size })),
            h("p", { className: "dsh-remote-ops__muted" }, "仅调整当前连接；已输出内容不会重排。")) : h("p", { className: "dsh-remote-ops__muted" }, "选中已连接的 SSH 终端后，可在此调整连接尺寸。")));
      const environmentsHead = drawer ? h("section", {className:"dsh-remote-ops__utilityHead",id:"remote-ops-environments-"+uiKey},
        h("div",{className:"dsh-remote-ops__drawerHead dsh-remote-ops__environmentHead"},h("button",{className:"dsh-remote-ops__environmentBack","aria-label":"返回工作区",onClick:returnToWorkspace},h(IconChevronLeftOutline14,{"aria-hidden":true}),"返回工作区"),h("strong",null,"环境管理")),
        h("div",{className:"dsh-remote-ops__subTabs",role:"tablist","aria-label":"环境类型"},["ssh","api"].map((kind,index)=>h("button",{key:kind,role:"tab",id:"environment-tab-"+uiKey+"-"+kind,"aria-selected":environmentKind===kind,"aria-controls":"environment-panel-"+uiKey+"-"+kind,tabIndex:environmentKind===kind?0:-1,onClick:()=>openEnvironments(kind),onKeyDown:event=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?1:1-index;openEnvironments(next?"api":"ssh");event.currentTarget.parentElement.children[next]?.focus();}}},kind.toUpperCase())))) : null;
      return h("div", { className: "dsh-remote-ops", "data-density": density },
        h("div", { className: "dsh-remote-ops__head" },
          h("strong", null, "Remote Ops"),
          h("button", {className:"dsh-remote-ops__headAction","aria-label":"环境管理","aria-expanded":drawer,"aria-controls":"remote-ops-environments-"+uiKey,onClick:()=>drawer?setDrawer(false):openEnvironments()},h(IconPanelLeftOutline16,{"aria-hidden":true}),"环境"),
          h("button", {className:"dsh-remote-ops__headAction","aria-label":"设置","aria-expanded":!!settingsTab,onClick:()=>settingsTab?closeSettings():openSettings()},h(IconSettingsOutline16,{"aria-hidden":true}),"设置")),
        actionNotice ? h("div", { className: "dsh-remote-ops__notice", role: "status", "data-error": actionNotice.includes("失败") }, actionNotice) : null,
        error ? h("div", { className: "dsh-remote-ops__error", role: "alert" }, h("div", { className: "dsh-remote-ops__errorBody" }, requestErrorDetails(error), /AUTH|credential|password|认证/i.test(error) ? h("button", { onClick: () => { openEnvironments("ssh"); if (activeEnvironment) openEnvironmentForm(activeEnvironment); } }, "检查环境凭据") : /OWNER|SESSION_REQUIRED/.test(error) ? h("button", { disabled: !sessionId, onClick: () => void workspaceAction({ action: "activate" }) }, "绑定当前会话") : h("button", { onClick: () => void refreshNow() }, "刷新状态")), h("button", { className: "dsh-remote-ops__errorClose", "aria-label": "关闭错误", onClick: () => setError("") }, h(IconCloseOutline16))) : null,
        panelQuestion, pasteView, choicesView, diagnosticsView,
        commandTarget ? h(CommandDialog, { key: sessionId + ":" + commandTarget.sessionId, sessionId, target: commandTarget, onClose: () => setCommandTarget(null) }) : null,
        h("nav", { className: "dsh-remote-ops__workspaceTabs", role: "tablist", "aria-label": "Remote Ops 工作区" }, workspaces.map(([id, label, Icon], index) => h("button", { key: id, type: "button", role: "tab", id: "remote-ops-tab-" + uiKey + "-" + id, "aria-label": label, "aria-selected": module === id, "aria-controls": "remote-ops-panel-" + uiKey, tabIndex: module === id ? 0 : -1, onClick: () => selectWorkspace(id), onKeyDown: event => { const next = { ArrowRight: (index + 1) % workspaces.length, ArrowLeft: (index + workspaces.length - 1) % workspaces.length, Home: 0, End: workspaces.length - 1 }[event.key]; if (next !== undefined) { event.preventDefault(); selectWorkspace(workspaces[next][0]); event.currentTarget.parentElement.children[next]?.focus(); } } }, h(Icon, { size: 16, "aria-hidden": true }), label, tabBadges[id] ? h("span", {className:"dsh-remote-ops__tabBadge","data-tone":tabBadges[id].tone,title:tabBadges[id].description,"aria-label":tabBadges[id].description},tabBadges[id].label) : null))),
        h("div", { className: "dsh-remote-ops__workspace" }, h("main", { className: "dsh-remote-ops__main", id: "remote-ops-panel-" + uiKey, role: drawer || diagnosticsOpen || settingsTab ? undefined : "tabpanel", "aria-labelledby": drawer || diagnosticsOpen || settingsTab ? undefined : "remote-ops-tab-" + uiKey + "-" + module, "data-module": drawer ? "environments" : diagnosticsOpen ? "diagnostics" : settingsTab ? "settings" : module },
          environmentsHead, settingsHead,
          h("div",{className:"dsh-remote-ops__moduleHost",hidden:!drawer||environmentKind!=="ssh",role:"tabpanel",id:"environment-panel-"+uiKey+"-ssh","aria-labelledby":"environment-tab-"+uiKey+"-ssh"},envDrawer),
          diagnosticsOpen ? aux : null, settingsGeneral, settingsTerminal,
          h("div",settingsPanelProps("updates"),updatesVisited?h(UpdateDialog,{embedded:true,visible:settingsTab==="updates",onClose:closeSettings,onStatus:setUpdate}):null),
          terminal,
          h("div",{className:"dsh-remote-ops__moduleHost",hidden:module!=="desktop"||drawer||diagnosticsOpen||!!settingsTab},desktopVisited?h(DesktopWorkspacePanel,{key:sessionId,sessionId,environments:snapshot.environments,visible:module==="desktop"&&!drawer&&!diagnosticsOpen&&!settingsTab}):null),
          h("div",{className:"dsh-remote-ops__moduleHost",hidden:!(settingsTab==="browser"||module==="browser"&&!drawer&&!diagnosticsOpen&&!settingsTab),role:settingsTab==="browser"?"tabpanel":undefined,id:"settings-panel-"+uiKey+"-browser","aria-labelledby":settingsTab==="browser"?"settings-tab-"+uiKey+"-browser":undefined},browserVisited?h(BrowserWorkspacePanel,{key:sessionId,sessionId,visible:module==="browser"&&!drawer&&!diagnosticsOpen&&!settingsTab,settings:settingsTab==="browser"}):null),
          h("div",{className:"dsh-remote-ops__moduleHost",hidden:!(drawer&&environmentKind==="api"||module==="api"&&!drawer&&!diagnosticsOpen&&!settingsTab),role:drawer&&environmentKind==="api"?"tabpanel":undefined,id:"environment-panel-"+uiKey+"-api","aria-labelledby":drawer&&environmentKind==="api"?"environment-tab-"+uiKey+"-api":undefined},apiVisited?h(ApiWorkspacePanel,{key:sessionId,sessionId,sshEnvironments:snapshot.environments,mode:drawer&&environmentKind==="api"?"environments":"workspace",onManage:()=>openEnvironments("api")}):null),
          h("div", { className: "dsh-remote-ops__fileHost", hidden: module !== "sftp" || drawer || diagnosticsOpen || !!settingsTab }, sftpWorkspace),
          quickPanel)));

    }
    // BEGIN generated API client
    // Inlined into the native plugin bundle by test/sync-api-client.mjs; no CDN or extra runtime.
    const drafts = new Map();
    const statusLabel = value => ({running:'执行中',completed:'已完成',http_error:'HTTP 错误',failed:'失败',unknown:'结果未知'}[value]??value);
    const jsonPointerChild = (parent, key) => parent+'/'+String(key).replace(/~/g,'~0').replace(/\//g,'~1');
    // Bound work as well as DOM size: a large array or deeply nested response stays inspectable.
    function jsonTreeRows(value, expanded, limit=500) {
      const rows=[], stack=[{value,pointer:'',label:'根节点',depth:0}];
      while(stack.length&&rows.length<limit) {
        const row=stack.pop(), container=row.value!==null&&typeof row.value==='object';
        const keys=container?Object.keys(row.value):[];
        rows.push({...row,container,count:keys.length,depthLimited:row.depth>=32});
        if(container&&expanded.has(row.pointer)&&row.depth<32) {
          // Queue at most the remaining budget plus one sentinel, even for very wide JSON.
          for(let i=Math.min(keys.length,limit-rows.length+1)-1;i>=0;i--) {
            const key=keys[i];stack.push({value:row.value[key],pointer:jsonPointerChild(row.pointer,key),label:key,depth:row.depth+1});
          }
        }
      }
      return {rows,more:stack.length>0};
    }
    function createApiPanel(React, request) {
      const {createElement:h,useState,useEffect,useCallback,useRef}=React;
      const style=`
        .ro-api{display:flex;flex-direction:column;gap:14px;padding:16px;min-width:0;height:100%;overflow:auto;box-sizing:border-box}
        .ro-api__bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ro-api__bar>select{flex:1;min-width:120px}.ro-api select{border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);color:inherit;padding:7px;font:inherit;max-width:100%}
        .ro-api h2{font-size:21px;font-weight:600;letter-spacing:-.5px;margin:12px 0 8px}.ro-api p{color:var(--dsw-alias-label-secondary,#667085);margin:6px 0;line-height:1.7;font-size:12px}.ro-api__eyebrow{font-size:11px;letter-spacing:1.2px;color:var(--dsw-alias-label-secondary,#667085)}
        .ro-api__card{border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:10px;padding:12px;min-width:0}.ro-api header{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.ro-api__endpoint{font:12px/1.6 ui-monospace,Consolas,monospace;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary,#667085)}
        .ro-api__badge{font-size:11px;padding:3px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-1,#f2f4f7);white-space:nowrap}.ro-api__badge[data-state=completed]{color:light-dark(#176b49,#80d7ad)}.ro-api__badge[data-state=unknown],.ro-api__badge[data-state=http_error],.ro-api__badge[data-state=failed]{color:var(--dsw-alias-state-error-primary,#b42318)}
        .ro-api .ro-api__primary{background:var(--ro-accent,#315cb5);color:white;border-color:transparent;padding:7px 13px}.ro-api__form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.ro-api label{display:flex;flex-direction:column;gap:5px;color:var(--dsw-alias-label-secondary,#667085);font-size:12px}.ro-api__wide{grid-column:1/-1}.ro-api textarea{resize:vertical;min-height:80px;font:12px/1.6 ui-monospace,Consolas,monospace}.ro-api__requestLine{display:flex;gap:7px}.ro-api__requestLine input{min-width:0;flex:1}.ro-api__requestLine select{flex:none;width:90px}
        .ro-api__history{display:flex;flex-direction:column;gap:3px;max-height:260px;overflow:auto}.ro-api .ro-api__row{display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:7px;text-align:left;border:0;background:transparent;padding:9px 6px;border-radius:5px}.ro-api__row[aria-pressed=true]{outline:1px solid var(--ro-accent,#315cb5);outline-offset:-1px}.ro-api__row b{font-size:11px;color:var(--ro-accent,#315cb5)}.ro-api__row span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ro-api__row small{display:block;color:var(--dsw-alias-label-secondary,#667085);font-size:10px}
        .ro-api pre{margin:6px 0 0;padding:12px;border-radius:7px;background:var(--dsw-alias-bg-layer-1,#f6f8fa);white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,Consolas,monospace;max-height:360px;overflow:auto}.ro-api details>summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#667085);padding:6px 0}.ro-api__error{padding:9px;border-left:3px solid var(--dsw-alias-state-error-primary,#b42318);color:var(--dsw-alias-state-error-primary,#b42318);overflow-wrap:anywhere}.ro-api__empty{padding:18px 0;color:var(--dsw-alias-label-secondary,#667085)}.ro-api__meta{display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary,#667085)}

        .ro-api{padding:14px;gap:12px}.ro-api__work{display:flex;flex-direction:column;gap:12px}.ro-api__request{display:grid;gap:7px}.ro-api__requestLine{align-items:center}.ro-api__requestLine button{flex:none}.ro-api__bar>input{flex:1;min-width:120px;width:auto}.ro-api__results{border-top:1px solid var(--ro-border,#e7e9ee);padding-top:8px}.ro-api__resultTabs{display:flex;gap:18px;margin-bottom:12px}.ro-api__resultTabs>button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;padding-inline:0}.ro-api__resultTabs>button[aria-selected=true]{border-bottom-color:var(--ro-accent);color:var(--ro-accent)}.ro-api__history{max-height:none}.ro-api__http{padding:4px 8px;border-radius:5px;font:600 12px ui-monospace,Consolas,monospace}.ro-api__http[data-kind=ok]{color:light-dark(#166343,#8de2b7);background:light-dark(#e1f4e9,#153c2e)}.ro-api__http[data-kind=error]{color:light-dark(#9b231b,#ffb0a8);background:light-dark(#fce9e7,#4a2525)}.ro-api__http[data-kind=other]{background:var(--ro-soft)}.ro-api__businessNote{margin:0 0 8px!important}.ro-api__environment{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px 0;border-bottom:1px solid var(--ro-border)}.ro-api__environment>div{flex:1;min-width:160px}.ro-api__environment small{display:block;overflow-wrap:anywhere;color:var(--ro-muted)}.ro-api__environment details[open]{flex-basis:100%}.ro-api__json{font:12px/1.6 ui-monospace,Consolas,monospace}.ro-api__jsonRow{display:flex;align-items:baseline;gap:5px;min-height:30px;border-bottom:1px solid color-mix(in srgb,var(--ro-border) 45%,transparent);overflow-wrap:anywhere}.ro-api .ro-api__jsonKey,.ro-api .ro-api__jsonToggle{border:0;background:transparent;padding:3px;min-height:28px;font:inherit}.ro-api__jsonKey{flex-shrink:1;min-width:0;text-align:left!important;overflow-wrap:anywhere;word-break:break-word;color:var(--ro-accent)!important}.ro-api .ro-api__jsonToggle,.ro-api__jsonSpacer{flex:none;display:inline-block;width:20px}.ro-api__jsonValue{flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word;color:var(--ro-muted)}.ro-api__jsonValue[data-type=string]{color:light-dark(#256b4d,#8dcfa9)}.ro-api__jsonValue[data-type=number],.ro-api__jsonValue[data-type=boolean]{color:light-dark(#79531b,#e6c27c)}.ro-api__pointer{display:grid;gap:5px;padding:8px;background:var(--ro-soft);border-radius:6px;margin-block:8px}.ro-api__pointer input{font:inherit}.ro-api__json p{font-family:inherit}
      `;
      function JsonResponse({value}) {
        const [expanded,setExpanded]=useState(()=>new Set([''])),[limit,setLimit]=useState(500),[copied,setCopied]=useState(null);
        const tree=jsonTreeRows(value,expanded,limit);
        const copy=async pointer=>{try{await navigator.clipboard.writeText(pointer);setCopied({pointer,ok:true});}catch{setCopied({pointer,ok:false});}};
        return h('div',{className:'ro-api__json'},h('p',null,'箭头展开 · 点击字段名复制 JSON Pointer'),
          copied?h('div',{className:'ro-api__pointer',role:'status'},copied.ok?'已复制路径':'无法自动复制，请选择下方路径复制',h('input',{'aria-label':'JSON Pointer',value:copied.pointer,readOnly:true,onFocus:e=>e.currentTarget.select()}),copied.pointer===''?h('small',null,'根节点的 JSON Pointer 是空字符串。'):null):null,
          tree.rows.map(row=>h('div',{key:row.pointer,className:'ro-api__jsonRow',style:{paddingInlineStart:Math.min(row.depth,12)*14+'px'}},
            row.container&&row.count&&!row.depthLimited?h('button',{type:'button',className:'ro-api__jsonToggle','aria-label':(expanded.has(row.pointer)?'折叠 ':'展开 ')+(row.pointer||'根节点'),'aria-expanded':expanded.has(row.pointer),onClick:()=>setExpanded(old=>{const next=new Set(old);next.has(row.pointer)?next.delete(row.pointer):next.add(row.pointer);return next;})},expanded.has(row.pointer)?'▾':'▸'):h('span',{className:'ro-api__jsonSpacer'}),
            h('button',{type:'button',className:'ro-api__jsonKey',title:row.pointer||'根节点（空路径）','aria-label':'复制 JSON Pointer '+(row.pointer||'根节点'),onClick:()=>void copy(row.pointer)},row.label===''?'""':row.label),
            h('span',{className:'ro-api__jsonValue','data-type':row.value===null?'null':typeof row.value},row.container?(Array.isArray(row.value)?'['+row.count+']':'{'+row.count+'}')+(row.depthLimited?' · 更深内容见原文':''):JSON.stringify(row.value)))),
          tree.more?h('div',null,h('p',null,'已显示 '+limit+' 个节点，可收起分支或查看原文。'),limit<2000?h('button',{type:'button',onClick:()=>setLimit(n=>Math.min(n+500,2000))},'显示更多节点'):null):null);
      }
      return function ApiPanel({sessionId,sshEnvironments=[],mode='workspace',onManage}) {
        const [draft,setDraft]=useState(()=>drafts.get(sessionId)??{environment:'',method:'GET',path:'',body:'',headers:'{}'});
        const [data,setData]=useState({environments:[],sessions:[],records:[]});
        const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
        const manage=mode==='environments';
        const [form,setForm]=useState(null),[password,setPassword]=useState(''),[envSearch,setEnvSearch]=useState(''),[envGroup,setEnvGroup]=useState('');
        const [resultTab,setResultTab]=useState('response'),[responseFormat,setResponseFormat]=useState('tree');
        useEffect(()=>{if(!manage)setPassword('');},[manage]);
        const [detailId,setDetailId]=useState(''),[detail,setDetail]=useState(null),alive=useRef(true);
        const endpoint='/api/dsh-remote-ops/api',query='?sessionId='+encodeURIComponent(sessionId??'');
        const patch=values=>setDraft(current=>({...current,...values}));
        useEffect(()=>{drafts.set(sessionId,draft);if(drafts.size>50)drafts.delete(drafts.keys().next().value);},[sessionId,draft]);
        const refresh=useCallback(async()=>{try{const next=await request(endpoint+query);if(alive.current){setData(next);setLoading(false);}}catch(err){if(alive.current){setError(err.message);setLoading(false);}}},[query]);
        useEffect(()=>{alive.current=true;let timer;const tick=async()=>{await refresh();if(alive.current)timer=setTimeout(tick,1500);};void tick();return()=>{alive.current=false;clearTimeout(timer);};},[refresh]);
        useEffect(()=>{if(!draft.environment&&data.environments.length)patch({environment:data.environments[0].id});},[data.environments,draft.environment]);
        const detailRevision=JSON.stringify(data.records.find(r=>r.id===detailId));
        useEffect(()=>{let cancelled=false;if(!detailId){setDetail(null);return;}request(endpoint+query+'&requestId='+encodeURIComponent(detailId)).then(value=>{if(!cancelled)setDetail(value);}).catch(err=>{if(!cancelled)setError(err.message);});return()=>{cancelled=true;};},[detailId,detailRevision,query]);
        useEffect(()=>{if(!detailId&&data.records[0])setDetailId(data.records[0].id);},[detailId,data.records]);
        const selected=data.environments.find(env=>env.id===draft.environment),loggedIn=data.sessions.some(s=>s.environment===draft.environment);
        const post=async body=>{setBusy(true);setError('');try{const value=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,...body})});if(alive.current)await refresh();return value.result;}catch(err){if(alive.current)setError(err.message);return undefined;}finally{if(alive.current)setBusy(false);}};
        const edit=env=>{
          setError('');setPassword('');onManage?.();
          setForm(env?{...env,headersText:JSON.stringify(env.headers,null,2),advancedText:JSON.stringify({headerRefs:env.headerRefs,caPem:env.caPem,auth:Object.fromEntries(Object.entries(env.auth).filter(([k])=>!['mode','username','passwordRef','loginPath','bodyFormat','tokenPointer','cookieName'].includes(k)))},null,2)}:{name:'',group:'default',baseUrl:'',sshEnvironmentId:'',timeoutMs:30000,auth:{mode:'token',username:'',passwordRef:'',loginPath:'login',bodyFormat:'json',tokenPointer:'/token',cookieName:''},headersText:'{}',advancedText:'{}'});
        };
        const field=(label,key,options={})=>h('label',{className:options.wide?'ro-api__wide':undefined},label,h('input',{...options,wide:undefined,'aria-label':label,value:form[key]??'',onChange:e=>setForm({...form,[key]:options.type==='number'?Number(e.target.value):e.target.value})}));
        const authField=(label,key,placeholder)=>h('label',null,label,h('input',{'aria-label':label,value:form.auth[key]??'',placeholder,onChange:e=>setForm({...form,auth:{...form.auth,[key]:e.target.value}})}));
        const button=(label,onClick,options={})=>h('button',{type:'button',onClick,...options},label);
        const textArea=(label,value,onChange,rows)=>h('label',null,label,h('textarea',{'aria-label':label,value,onChange:e=>onChange(e.target.value),rows}));
        const save=async event=>{event.preventDefault();try{
          const {headersText,advancedText,...base}=form,advanced=JSON.parse(advancedText);
          if(!advanced||typeof advanced!=='object'||Array.isArray(advanced)||Object.keys(advanced).some(k=>!['auth','headerRefs','caPem'].includes(k)))throw Error('高级配置仅支持 auth、headerRefs、caPem 对象字段');
          const environment={...base,...advanced,headers:JSON.parse(headersText),auth:{...base.auth,...advanced.auth}};
          const result=await post({action:'environment.save',environment,password});if(result&&alive.current){patch({environment:result.id});setForm(null);setPassword('');}
        }catch(err){setError(err.message);}};
        const execute=async kind=>{if(!selected)return;try{
          const args={environment:selected.id,requestId:(kind==='login'?'login-':'request-')+crypto.randomUUID()};
          if(kind!=='login'){args.method=draft.method;args.path=draft.path;args.headers=JSON.parse(draft.headers||'{}');if(draft.body.trim())args.body=JSON.parse(draft.body);}
          setResultTab('response');
          const result=await post({action:kind,args});if(result&&alive.current){setDetailId(result.id);setDetail(result);}
        }catch(err){setError('JSON 格式错误：'+err.message);}};
        const exportRecords=async()=>{setBusy(true);try{
          const records=await Promise.all(data.records.map(r=>request(endpoint+query+'&requestId='+encodeURIComponent(r.id))));
          const url=URL.createObjectURL(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),records},null,2)],{type:'application/json'}));
          const link=document.createElement('a');link.href=url;link.download='remote-ops-api-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(err){setError(err.message);}finally{if(alive.current)setBusy(false);}};
        const badge=(state,label)=>h('span',{className:'ro-api__badge','data-state':state},label??statusLabel(state));
        const formView=form?h('form',{className:'ro-api__card',onSubmit:save},
          h('header',null,h('strong',null,form.id?'编辑 API 环境':'新建 API 环境'),button('取消',()=>{setForm(null);setPassword('');})),
          h('div',{className:'ro-api__form'},field('API 环境名称','name',{required:true}),field('API 分组','group'),field('Base URL','baseUrl',{required:true,placeholder:'https://device.example/api/v1',wide:true}),
            h('label',null,'关联 SSH 环境（可选）',h('select',{'aria-label':'关联 SSH 环境',value:form.sshEnvironmentId,onChange:e=>setForm({...form,sshEnvironmentId:e.target.value})},h('option',{value:''},'独立 API 环境'),sshEnvironments.map(env=>h('option',{key:env.id,value:env.id},env.name)))),field('超时（毫秒）','timeoutMs',{type:'number',min:100,max:120000}),
            h('label',null,'认证方式',h('select',{'aria-label':'API 认证方式',value:form.auth.mode,onChange:e=>setForm({...form,auth:{...form.auth,mode:e.target.value}})},h('option',{value:'token'},'登录获取 Token'),h('option',{value:'cookie'},'登录获取 Cookie'),h('option',{value:'none'},'无需登录'))),
            form.auth.mode!=='none'?h(React.Fragment,null,authField('登录路径','loginPath','login'),authField('API 用户名','username'),h('label',null,'API 密码',h('input',{type:'password',autoComplete:'new-password','aria-label':'API 密码',value:password,onChange:e=>setPassword(e.target.value),placeholder:form.auth.passwordRef?'已配置；留空保持':'保存到 DSH 凭据'})),authField('密码凭据引用（可选）','passwordRef','已有 DSH 凭据名'),h('label',null,'登录格式',h('select',{'aria-label':'登录格式',value:form.auth.bodyFormat,onChange:e=>setForm({...form,auth:{...form.auth,bodyFormat:e.target.value}})},h('option',{value:'json'},'JSON'),h('option',{value:'form'},'Form'))),form.auth.mode==='token'?authField('Token JSON Pointer','tokenPointer','/data/token'):authField('Session Cookie 名称','cookieName','sid')):null,
            h('details',{className:'ro-api__wide'},h('summary',null,'请求头与高级登录配置'),textArea('API 公共请求头',form.headersText,value=>setForm({...form,headersText:value})),textArea('API 高级配置',form.advancedText,value=>setForm({...form,advancedText:value}),8),h('p',null,'支持 auth.usernameField / passwordField、tokenSource / tokenResponseHeader、headerName / prefix、successPointer / successValue、csrfCookie / csrfHeader，以及 headerRefs 和 caPem。'))),
          h('p',null,'配置修改后需重新登录。密码留空保留；Token 与 Cookie 仅在当前对话、本次 DSH 进程中保存。'),h('button',{className:'ro-api__primary',type:'submit',disabled:busy},busy?'保存中…':'保存 API 环境')):null;
        const responseBody=detail?.response&&Object.hasOwn(detail.response,'body')?detail.response.body:detail?.response;
        const httpBadge=code=>code?h('span',{className:'ro-api__http','data-kind':code>=200&&code<300?'ok':code>=400?'error':'other'},'HTTP '+code):null;
        const environmentList=data.environments.filter(env=>(!envGroup||env.group===envGroup)&&(!envSearch||[env.name,env.group,env.baseUrl].join(' ').toLowerCase().includes(envSearch.toLowerCase())));
        return h('section',{className:'ro-api','aria-label':manage?'API 环境管理':'API 工作区'},h('style',null,style),
          error?h('div',{className:'ro-api__error',role:'alert'},error,button('刷新',()=>{setError('');void refresh();})):null,
          loading?h('div',{role:'status'},'正在读取 API 环境…'):null,
          h('div',{hidden:!manage},formView??h(React.Fragment,null,
            h('div',{className:'ro-api__bar'},h('input',{type:'search','aria-label':'搜索 API 环境',placeholder:'搜索名称、分组或地址',value:envSearch,onChange:e=>setEnvSearch(e.target.value)}),h('select',{'aria-label':'API 环境分组',value:envGroup,onChange:e=>setEnvGroup(e.target.value)},h('option',{value:''},'全部分组'),[...new Set(data.environments.map(env=>env.group))].map(group=>h('option',{key:group},group))),button('新建 API 环境',()=>edit())),
            environmentList.map(env=>h('article',{key:env.id,className:'ro-api__environment'},h('div',null,h('strong',null,env.name),h('small',null,env.group+' · '+env.baseUrl)),button('编辑',()=>edit(env),{'aria-label':'编辑 API 环境 '+env.name}),h('details',null,h('summary',null,'删除'),h('p',null,'删除配置与登录会话，保留执行记录和 DSH 凭据。'),button('确认删除 API 环境',async()=>{const result=await post({action:'environment.delete',environment:env.id});if(result&&draft.environment===env.id)patch({environment:''});},{disabled:busy})))),
            !environmentList.length?h('p',null,data.environments.length?'没有匹配的环境':'还没有 API 环境。保存地址和认证配置后即可使用。'):null)),
          h('div',{hidden:manage,className:'ro-api__work'},
            h('div',{className:'ro-api__bar'},h('select',{'aria-label':'API 环境',value:draft.environment,onChange:e=>patch({environment:e.target.value})},h('option',{value:''},'选择 API 环境'),data.environments.map(env=>h('option',{value:env.id,key:env.id},env.group+' / '+env.name))),selected?badge(loggedIn?'completed':'idle',selected.auth.mode==='none'?'无需登录':loggedIn?'已登录':'未登录'):null,selected&&selected.auth.mode!=='none'?button(loggedIn?'重新登录':'登录',()=>void execute('login'),{disabled:busy||!sessionId}):null),
            !loading&&!data.environments.length?h('div',{className:'ro-api__empty'},h('h2',null,'从一个 API 环境开始'),h('p',null,'保存地址与登录配置，Agent 和你共享请求过程与响应。'),button('新建 API 环境',()=>edit(),{className:'ro-api__primary'})):null,
            selected?h('div',{className:'ro-api__request'},h('div',{className:'ro-api__endpoint',title:'请求由 DSH 主机发送'},selected.baseUrl),
              h('div',{className:'ro-api__requestLine'},h('select',{'aria-label':'HTTP 方法',value:draft.method,onChange:e=>patch({method:e.target.value})},['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(method=>h('option',{key:method},method))),h('input',{'aria-label':'API 请求路径',value:draft.path,onChange:e=>patch({path:e.target.value}),placeholder:'volumes?limit=20',spellCheck:false}),button(busy?'执行中…':'发送',()=>void execute('request'),{'aria-label':'发送请求',className:'ro-api__primary',disabled:busy||!draft.path||!sessionId||(selected.auth.mode!=='none'&&!loggedIn)})),
              h('details',null,h('summary',null,'请求参数'),h('p',null,'路径基于上方 Base URL · 由 DSH 主机发送 · '+selected.timeoutMs/1000+'s 超时'),textArea('API 请求头',draft.headers,value=>patch({headers:value})),textArea('API 请求体',draft.body,value=>patch({body:value}))),!sessionId?h('p',null,'选择或新建对话后即可登录和执行。'):null):null,
            h('div',{className:'ro-api__results'},h('div',{className:'ro-api__resultTabs',role:'tablist','aria-label':'API 结果'},[['response','响应'],['history','记录']].map(([id,label],index)=>button(label,()=>setResultTab(id),{key:id,id:'api-result-tab-'+sessionId+'-'+id,role:'tab','aria-selected':resultTab===id,'aria-controls':'api-result-'+sessionId+'-'+id,tabIndex:resultTab===id?0:-1,onKeyDown:event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-index;setResultTab(next?'history':'response');event.currentTarget.parentElement.children[next]?.focus();}}}))),
              h('div',{hidden:resultTab!=='history',role:'tabpanel',id:'api-result-'+sessionId+'-history','aria-labelledby':'api-result-tab-'+sessionId+'-history'},h('header',null,h('small',null,'当前对话 · 最近 100 条'),button('导出记录',()=>void exportRecords(),{disabled:busy||!data.records.length})),h('div',{className:'ro-api__history'},data.records.map(record=>button(h(React.Fragment,null,h('b',null,record.kind==='login'?'LOGIN':record.method),h('span',null,record.path,h('small',null,record.environmentName+' · '+new Date(record.startedAt).toLocaleTimeString())),badge(record.state,(record.httpStatus?record.httpStatus+' · ':'')+statusLabel(record.state))),()=>{if(detailId!==record.id)setDetail(null);setDetailId(record.id);setResultTab('response');},{key:record.id,className:'ro-api__row','aria-pressed':detailId===record.id}))),!data.records.length?h('div',{className:'ro-api__empty'},'请求执行后会出现在这里。'):null,h('p',null,'DSH 重启后清空，可导出保存。')),
              h('div',{hidden:resultTab!=='response',role:'tabpanel',id:'api-result-'+sessionId+'-response','aria-labelledby':'api-result-tab-'+sessionId+'-response'},detail?h('div',{'aria-label':'API 响应详情'},
                h('header',null,h('div',{className:'ro-api__bar'},httpBadge(detail.httpStatus),badge(detail.state),h('small',null,(detail.durationMs??0)+' ms')),responseBody!==undefined?h('select',{'aria-label':'响应格式',value:responseFormat,onChange:e=>setResponseFormat(e.target.value)},h('option',{value:'tree'},'JSON 树'),h('option',{value:'raw'},'原文')):null),
                detail.httpStatus>=200&&detail.httpStatus<300?h('p',{className:'ro-api__businessNote'},'请检查业务结果'):null,
                h('div',{className:'ro-api__meta'},detail.id),detail.note?h('div',{className:'ro-api__error'},detail.state==='unknown'?'结果未知：设备可能已执行。请先查询设备状态，不要直接重复下发。':detail.note):null,detail.error?h('p',null,detail.error):null,
                detail.truncated?h('p',null,'响应已截断（128 KiB），请使用接口分页获取更多内容。'):null,
                responseBody===undefined?h('p',null,'尚无响应内容'):responseFormat==='tree'&&typeof responseBody!=='string'?h(JsonResponse,{key:detail.id,value:responseBody}):h('pre',null,typeof responseBody==='string'?responseBody:JSON.stringify(responseBody,null,2)),
                detail.response?.headers?h('details',null,h('summary',null,'响应头'),h('pre',null,JSON.stringify(detail.response.headers,null,2))):null,h('details',null,h('summary',null,'请求详情（已脱敏）'),h('pre',null,JSON.stringify({url:detail.url,method:detail.method,...detail.request},null,2)))):h('div',{className:'ro-api__empty'},'发送请求，或在记录中选择一次执行。')))));
      };
    }

    const ApiWorkspacePanel = createApiPanel(React, request);
    // END generated API client
    // BEGIN generated desktop client
    function desktopPoint(frame,rect,clientX,clientY) {
      if(!frame||!rect.width||!rect.height)return null;
      const scale=Math.min(rect.width/frame.width,rect.height/frame.height),width=frame.width*scale,height=frame.height*scale;
      const x=clientX-rect.left-(rect.width-width)/2,y=clientY-rect.top-(rect.height-height)/2;
      if(x<0||y<0||x>=width||y>=height)return null;
      return {x:Math.floor(x/width*frame.sourceWidth),y:Math.floor(y/height*frame.sourceHeight)};
    }

    function createDesktopPanel(React,request) {
      const {createElement:h,useState,useRef,useEffect}=React;
      const id=()=>globalThis.crypto?.randomUUID?.()??'desktop-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      const styles=`
        .dsh-remote-ops__desktop{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;padding:10px;gap:8px}
        .dsh-remote-ops__desktopBar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;flex:none}
        .dsh-remote-ops__desktopBar select{min-width:0;max-width:100%;flex:1;padding:6px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:inherit}
        .dsh-remote-ops__desktopCanvas{display:flex;align-items:center;justify-content:center;position:relative;flex:1;min-height:160px;min-width:0;overflow:hidden;background:#161c25;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:9px}
        .dsh-remote-ops__desktopCanvas:fullscreen{padding:16px;background:#161c25}
        .dsh-remote-ops__desktopCanvas img{width:100%;height:100%;object-fit:contain;outline:none;cursor:default}
        .dsh-remote-ops__desktopCanvas img:focus-visible{outline:2px solid #79a7ff;outline-offset:-2px}
        .dsh-remote-ops__desktopEmpty{max-width:320px;padding:28px;color:#aab8ca;text-align:center;line-height:1.7}
        .dsh-remote-ops__desktopEmpty strong{display:block;font-size:16px;color:#edf4ff;margin-bottom:9px}
        .dsh-remote-ops__desktopStatus{display:flex;gap:8px;align-items:center;font-size:11px;color:var(--dsw-alias-label-secondary,#667085);min-height:20px}
        .dsh-remote-ops__desktopStatus span:last-child{margin-left:auto}
        .dsh-remote-ops__desktopDot{width:7px;height:7px;border-radius:50%;background:#8b95a4;flex:none}
        .dsh-remote-ops__desktopDot[data-state=connected]{background:#29a36a}.dsh-remote-ops__desktopDot[data-state=busy]{background:#db9d24}
        .dsh-remote-ops__desktopMessage{padding:8px 10px;border-left:3px solid #d79b36;background:var(--dsw-alias-bg-layer-1,#f7f9fb);white-space:pre-wrap;overflow-wrap:anywhere;max-height:100px;overflow:auto;font-size:12px}
        .dsh-remote-ops__desktopForm{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:8px}
        .dsh-remote-ops__desktopEntry{display:flex;gap:6px;align-items:center}.dsh-remote-ops__desktopEntry textarea{resize:none;height:34px;min-height:34px;flex:1}
        .dsh-remote-ops__desktopRecords{flex:none;max-height:160px;overflow:auto;font-size:12px}.dsh-remote-ops__desktopRecords summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#667085)}
        .dsh-remote-ops__desktopRecords ol{padding-left:20px}.dsh-remote-ops__desktopRecords li{padding:3px;overflow-wrap:anywhere}
      `;
      return function DesktopPanel({sessionId,environments=[],visible=true}) {
        const [state,setState]=useState({sessions:[],selected:null,localAvailable:true}),[environment,setEnvironment]=useState('local'),[windowsSession,setWindowsSession]=useState(''),[sessions,setSessions]=useState([]);
        const [observation,setObservation]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[showLaunch,setShowLaunch]=useState(false),[showConnect,setShowConnect]=useState(false),[path,setPath]=useState(''),[args,setArgs]=useState(''),[text,setText]=useState(''),[events,setEvents]=useState([]);
        const alive=useRef(true),busyRef=useRef(false),canvas=useRef(null),image=useRef(null),currentRef=useRef(),observationRef=useRef(),visibleRef=useRef(visible),refreshing=useRef(false),inputQueue=useRef(Promise.resolve()),queued=useRef(0);
        visibleRef.current=visible;observationRef.current=observation;
        const current=state.sessions.find(s=>s.desktopId===state.selected);currentRef.current=current;
        const post=(action,values={})=>request('/api/dsh-remote-ops/desktop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,action,args:values})});
        const refresh=async()=>{
          if(refreshing.current)return;refreshing.current=true;
          try {
            const next=await request('/api/dsh-remote-ops/desktop?'+new URLSearchParams({sessionId}));if(!alive.current)return;setState(next);if(!next.localAvailable)setEnvironment(previous=>previous==='local'?'':previous);
            const selected=next.sessions.find(s=>s.desktopId===next.selected);
            if(visibleRef.current&&selected?.status==='connected'&&!busyRef.current){let frame;try{frame=await post('observe',{desktopId:selected.desktopId,listOnly:!selected.target});}catch(cause){if(!/DESKTOP_WINDOW_NOT_FOUND/.test(cause.message))throw cause;frame=await post('observe',{desktopId:selected.desktopId,listOnly:true});frame.captureError='原窗口暂未就绪或已关闭，请从窗口列表选择。';}if(alive.current){setObservation(frame);setError(frame.captureError??'');}}
          }catch(cause){if(alive.current){setError(cause.message);setObservation(null);}}finally{refreshing.current=false;}
        };
        useEffect(()=>{alive.current=true;void refresh();const timer=setInterval(()=>void refresh(),1600);return()=>{alive.current=false;clearInterval(timer);};},[sessionId]);
        const run=async(work)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{return await work();}catch(cause){if(alive.current)setError(cause.message);return null;}finally{busyRef.current=false;if(alive.current){setBusy(false);void refresh();}}};
        const act=step=>{
          const intended=currentRef.current,seen=observationRef.current;if(!intended||!seen?.snapshotId)return Promise.resolve(null);
          if(queued.current>=8){setError('输入队列已满，请等待当前操作完成');return Promise.resolve(null);}queued.current++;
          const pending=inputQueue.current.then(async()=>{
            while(alive.current&&busyRef.current)await new Promise(resolve=>setTimeout(resolve,30));
            if(!alive.current||!visibleRef.current||currentRef.current?.desktopId!==intended.desktopId)return null;
            return run(async()=>{
              const snapshot=['keys','text'].includes(step.action)?await post('observe',{desktopId:intended.desktopId,windowId:seen.windowId}):seen;
              const result=await post('act',{desktopId:intended.desktopId,requestId:id(),snapshotId:snapshot.snapshotId,steps:[step]});
              if(result.status!=='completed')throw new Error(result.results?.at(-1)?.message??'操作未完成，请检查当前窗口');
              const next=await post('observe',{desktopId:intended.desktopId});if(alive.current){observationRef.current=next;setObservation(next);}return result;
            });
          }).finally(()=>{queued.current--;});inputQueue.current=pending.catch(()=>{});return pending;
        };
        const connect=()=>run(async()=>{const result=await post('connect',{environment,...(windowsSession?{windowsSessionId:Number(windowsSession)}:{})});setObservation(null);setSessions([]);setShowConnect(false);return result;});
        const inspect=()=>run(async()=>{const result=await post('inspect',{environment});setSessions(result.sessions??[]);if(result.sessions?.length===1)setWindowsSession(String(result.sessions[0].sessionId));});
        const keyboard=event=>{
          if(event.isComposing||event.key==='Process')return;
          const named={Enter:'ENTER',Tab:'TAB',Escape:'ESC',Backspace:'BACKSPACE',Delete:'DELETE',ArrowLeft:'LEFT',ArrowRight:'RIGHT',ArrowUp:'UP',ArrowDown:'DOWN',Home:'HOME',End:'END',' ':'SPACE'};
          const key=named[event.key]??(/^[a-z0-9]$/i.test(event.key)?event.key.toUpperCase():null);
          if(!key||['Control','Shift','Alt','Meta'].includes(event.key))return;
          if(!event.ctrlKey&&!event.altKey&&event.key.length===1)return;
          event.preventDefault();void act({action:'keys',keys:[event.ctrlKey?'CTRL':null,event.altKey?'ALT':null,event.shiftKey?'SHIFT':null,key].filter(Boolean).join('+')});
        };
        const imageData=current&&current.status!=='disconnected'?observation?.screenshot:null;
        const available=environments.filter(e=>e.platform==='windows');
        const openForm=showLaunch?h('form',{className:'dsh-remote-ops__desktopForm',onSubmit:event=>{event.preventDefault();void run(async()=>{const result=await post('launch',{desktopId:current.desktopId,requestId:id(),path,args:args===''?[]:args.split(/\r?\n/)});setShowLaunch(false);return result;});}},
          h('label',null,'程序路径',h('input',{'aria-label':'Windows 程序路径',value:path,onChange:e=>setPath(e.target.value),placeholder:'C:\\Program Files\\App\\App.exe',required:true})),
          h('label',null,'启动参数',h('textarea',{'aria-label':'Windows 启动参数',value:args,onChange:e=>setArgs(e.target.value),placeholder:'每行一个参数，保留其中的空格'})),
          h('div',{className:'dsh-remote-ops__desktopBar'},h('button',{type:'submit',disabled:busy},'打开'),h('button',{type:'button',onClick:()=>setShowLaunch(false)},'返回画面'))):null;
        return h('section',{className:'dsh-remote-ops__desktop','aria-label':'Windows 桌面'},h('style',null,styles),
          !current||showConnect?h(React.Fragment,null,
            h('div',{className:'dsh-remote-ops__desktopBar'},h('select',{'aria-label':'桌面环境',value:environment,onChange:e=>{setEnvironment(e.target.value);setSessions([]);setWindowsSession('');}},state.localAvailable?h('option',{value:'local'},'本机 Windows'):h('option',{value:''},'选择 Windows 环境'),available.map(e=>h('option',{key:e.id,value:e.id},e.name))),h('button',{disabled:busy||!environment,onClick:connect},busy?'连接中…':'连接桌面'),h('button',{disabled:busy||!environment,onClick:inspect},'检查会话')),
            sessions.length?h('select',{'aria-label':'Windows 登录会话',value:windowsSession,onChange:e=>setWindowsSession(e.target.value)},h('option',{value:''},'选择登录会话'),sessions.map(s=>h('option',{key:s.sessionId,value:s.sessionId,disabled:s.state!=='active'},`${s.user} · 会话 ${s.sessionId} · ${s.state}`))):null):
          h('div',{className:'dsh-remote-ops__desktopBar'},
            state.sessions.length>1?h('select',{'aria-label':'桌面连接',value:state.selected,onChange:e=>void run(async()=>{await post('select',{desktopId:e.target.value});setObservation(null);})},state.sessions.map(s=>h('option',{key:s.desktopId,value:s.desktopId},s.environment+' · '+s.info.sessionId))):null,
            h('select',{'aria-label':'桌面窗口',value:observation?.windowId??'',onChange:e=>void run(async()=>{const frame=await post('observe',{desktopId:current.desktopId,windowId:e.target.value});setObservation(frame);})},h('option',{value:''},'选择软件窗口'),(observation?.windows??[]).map(w=>h('option',{key:w.windowId,value:w.windowId},w.title))),
            h('button',{disabled:busy||current.status==='disconnected',onClick:()=>setShowLaunch(v=>!v)},'打开应用'),h('button',{disabled:!imageData,onClick:()=>canvas.current?.requestFullscreen?.()},'全屏'),
            h('details',null,h('summary',null,'更多'),h('div',{className:'dsh-remote-ops__desktopBar'},h('button',{onClick:()=>setShowConnect(true)},'连接其他环境'),h('button',{onClick:()=>void run(async()=>{const result=await post('export',{all:true});const link=document.createElement('a');link.href=result.url;link.download=result.filename;link.click();})},'导出本会话桌面日志'),h('button',{disabled:busy||current.status==='busy',onClick:()=>void run(async()=>{await post('disconnect',{desktopId:current.desktopId});setObservation(null);})},'断开连接')))),
          error?h('div',{className:'dsh-remote-ops__desktopMessage',role:'status'},error):null,openForm,
          h('div',{className:'dsh-remote-ops__desktopCanvas',ref:canvas},imageData?h('img',{ref:image,src:'data:'+imageData.mimeType+';base64,'+imageData.data,alt:'目标 Windows 软件窗口',tabIndex:0,onKeyDown:keyboard,onClick:event=>{const point=desktopPoint(imageData,event.currentTarget.getBoundingClientRect(),event.clientX,event.clientY);if(point){event.currentTarget.focus({preventScroll:true});void act({action:'click',...point});}}}):h('div',{className:'dsh-remote-ops__desktopEmpty'},h('strong',null,current?'选择窗口，开始操作':'操作真实的 Windows 软件'),current?'从上方选择已打开的软件，或打开应用。':'连接已登录、解锁的桌面。首次连接会部署随包执行器；你与 Agent 共享同一个窗口。')),
          current&&imageData?h('form',{className:'dsh-remote-ops__desktopEntry',onSubmit:event=>{event.preventDefault();if(text)void act({action:'text',text}).then(result=>{if(result)setText('');});}},h('textarea',{'aria-label':'桌面输入内容',value:text,onChange:e=>setText(e.target.value),placeholder:'输入文字，点击发送到窗口',onCompositionStart:()=>{},onKeyDown:e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form.requestSubmit();}}}),h('button',{type:'submit',disabled:busy||!text},'发送'),h('button',{type:'button',disabled:busy,onClick:()=>void act({action:'keys',keys:'ENTER'})},'Enter')):null,
          h('div',{className:'dsh-remote-ops__desktopStatus',role:'status'},h('i',{className:'dsh-remote-ops__desktopDot','data-state':busy?'busy':current?.status??'disconnected'}),h('span',null,current?`${current.info.user??''} · 会话 ${current.info.sessionId}`:'未连接'),h('span',null,busy||current?.status==='busy'?'正在操作':observation?.observedAt?'画面 '+new Date(observation.observedAt).toLocaleTimeString():'')),
          current?h('details',{className:'dsh-remote-ops__desktopRecords',onToggle:event=>{if(event.currentTarget.open)void post('read',{desktopId:current.desktopId}).then(result=>{if(alive.current)setEvents(result.events);}).catch(e=>setError(e.message));}},h('summary',null,'操作记录'),h('ol',null,events.map((event,index)=>h('li',{key:index},new Date(event.at).toLocaleTimeString()+' · '+(event.action??event.event)+(event.status?' · '+event.status:'')+(event.message?' · '+event.message:''))))):null);
      };
    }

    const DesktopWorkspacePanel = createDesktopPanel(React, request);
    // END generated desktop client
    function BrowserIcon({ size = 16 }) { return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, "aria-hidden": true }, h("circle", { cx: 12, cy: 12, r: 9 }), h("path", { d: "M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18" })); }
    function FileIcon() { return h("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, "aria-hidden": true }, h("path", { d: "M14 3H6v18h12V7zM14 3v5h4M8 12h8M8 16h8" })); }

    function RemoteOpsTitle() { return h("span", null, "Remote Ops"); }
    function RemoteOpsIcon({ size = 18, active = false }) {
      return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: active ? 1.8 : 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, h("rect", { x: 3, y: 4, width: 18, height: 16, rx: 3 }), h("path", { d: "m7 9 3 3-3 3m6 0h4" }));
    }
    function RemoteOpsRightPanel({ sessionId }) {
      return h(RemoteOpsPanel, { key: sessionId ?? "local", sessionId });
    }
    function RemoteOpsLaunch({ wide, onClick, label }) {
      const button = h("button", { type: "button", className: "dsh-remote-ops__launchControl", "data-wide": wide, title: icons.Tooltip ? undefined : label, "aria-label": label, onClick }, h(RemoteOpsIcon, { size: 16 }), wide ? h("span", null, label) : null);
      return icons.Tooltip ? h(icons.Tooltip, { label, side: "right", delayMs: 500, disabled: wide }, button) : button;
    }
    const inject = ["slots", "locale"];
    const launcherErrorState = { message: "", listeners: new Set() };
    const subscribeLauncherError = (listener) => { launcherErrorState.listeners.add(listener); return () => launcherErrorState.listeners.delete(listener); };
    const setLauncherError = (message) => { launcherErrorState.message = String(message ?? ""); launcherErrorState.listeners.forEach(listener => listener()); };
    function LauncherErrorOverlay() {
      const message = useSyncExternalStore(subscribeLauncherError, () => launcherErrorState.message);
      if (!message) return null;
      return h("div", { className: "dsh-remote-ops__launcherError", role: "alert" }, h("div", { className: "dsh-remote-ops__launcherErrorBody" }, h("strong", null, "无法打开 Remote Ops"), h("div", null, message)), h("button", { type: "button", className: "dsh-remote-ops__launcherErrorClose", title: "关闭错误", "aria-label": "关闭错误", onClick: () => setLauncherError("") }, "×"));
    }
    function apply(ctx) {
      ctx.effect(() => {
        const beforeUnload = event => { if (browserUploads.hasActive()) { event.preventDefault(); event.returnValue = ""; } };
        window.addEventListener?.("beforeunload", beforeUnload);
        return () => { window.removeEventListener?.("beforeunload", beforeUnload); browserUploads.dispose(); webDrafts.clear(); workspaceViews.clear(); fileViews.clear(); commandDrafts.clear(); };
      }, "dsh-remote-ops: browser uploads");
      ctx.effect(() => ctx.locale.register(NS, { zh: { title: "Remote Ops", guideTitle: "远程运维", guideDescription: "管理 SSH 环境、终端、SFTP 和可见网页" }, en: { title: "Remote Ops", guideTitle: "Remote operations", guideDescription: "Manage SSH environments, terminals, SFTP and visible web operations" } }), "dsh-remote-ops: dictionaries");
      const t = ctx.locale.bind(NS);
      ctx.effect(() => { setLauncherError(""); return () => setLauncherError(""); }, "dsh-remote-ops: launcher error state");
      ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-remote-ops.launch-error", locale: NS }, LauncherErrorOverlay)), "dsh-remote-ops: launcher error overlay");
      const getService = (context, service) => typeof context.get === "function" ? context.get(service) : context[service];
      const showLauncherError = (message) => { console.warn(`[dsh-remote-ops] ${message}`); setLauncherError(message); };
      let launcherTimer;
      ctx.effect(() => () => { if (launcherTimer) window.clearInterval(launcherTimer); launcherTimer = undefined; }, "dsh-remote-ops: launcher timer");
      const openRemoteOps = () => {
        if (launcherTimer) window.clearInterval(launcherTimer);
        launcherTimer = undefined;
        setLauncherError("");
        let attempts = 0;
        let lastError = "sidebarRight 服务尚未提供";
        const tryOpen = () => {
          const sidebarRight = getService(ctx, "sidebarRight");
          if (typeof sidebarRight?.openTab !== "function") { lastError = "sidebarRight.openTab 不可用"; return false; }
          try { sidebarRight.openTab(TAB_KIND); return true; } catch (cause) { lastError = cause instanceof Error ? cause.message : String(cause); return false; }
        };
        if (tryOpen()) return;
        launcherTimer = window.setInterval(() => {
          attempts += 1;
          const opened = tryOpen();
          if (opened || attempts >= 40) {
            window.clearInterval(launcherTimer);
            launcherTimer = undefined;
            if (!opened) showLauncherError("无法打开 Remote Ops：" + lastError + "。请确认当前运行的是 DSH Web profile，并重启 DSH 让插件重新加载。");
          }
        }, 250);
      };
      // panellist always selects a main workspace in DSH 0.2. The official
      // footer action can open a right-Sidebar tab while preserving the chat.
      ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-remote-ops-launch", order: 40, locale: NS, label: () => t("title") }, (props) => h(RemoteOpsLaunch, { ...props, onClick: openRemoteOps, label: t("title") }))), "dsh-remote-ops: launch button");
      ctx.inject(["sidebarRight", "sidebarRightTabs"], (ready) => {
        const sidebarRight = getService(ready, "sidebarRight");
        const sidebarRightTabs = getService(ready, "sidebarRightTabs");
        if (!sidebarRight || !sidebarRightTabs) return;
        ready.effect(() => sidebarRightTabs.register({ id: TAB_ID, kind: TAB_KIND, priority: "extension", title: () => t("title"), guide: [] }), "dsh-remote-ops: tab type");
        ready.effect(() => ready.slots.inject("sidebar.right.pane.tab", () => ready.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID }, RemoteOpsRightPanel)), "dsh-remote-ops: tab body");
        ready.effect(() => ready.slots.inject("sidebar.right.pane.tab.title", () => ready.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB_ID }, RemoteOpsTitle)), "dsh-remote-ops: tab title");
      });
    }
    return { inject, apply };
  },
});
