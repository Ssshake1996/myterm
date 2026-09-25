window.__ModuleLoader__.load({
  id: "@dsh/remote-ops",
  factory: (require) => {
    const React = require("react");
    const { IconStopFill16, IconRefreshOutline16, IconDownloadOutline16, IconPanelLeftOutline16, IconCopyOutline16, IconEditOutline16, IconFolderClose16, IconPlayOutline16, IconSearchOutline16, IconPlusOutline16, IconSettingsOutline16, IconCloseOutline16, IconChevronDownOutline14, IconChevronUpOutline14 } = require("@deepseek-ai/dsh-client-ui-primitives");
    const { createElement: h, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
    const NS = "dshRemoteOps";
    const TAB_ID = "@dsh/remote-ops";
    const TAB_KIND = "dsh-remote-ops";
    const styleId = "dsh-remote-ops-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style"); style.id = styleId;
      style.textContent = `
        .dsh-remote-ops{height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#182230);font:13px/1.45 system-ui,sans-serif}
        .dsh-remote-ops button{border:1px solid var(--dsw-alias-border-l3,#d8dce5);background:var(--dsw-alias-bg-layer-1,#f6f8fa);color:inherit;border-radius:7px;padding:5px 8px;cursor:pointer;font:inherit}.dsh-remote-ops button:hover{background:var(--dsw-alias-interactive-bg-hover,#edf1f5)}.dsh-remote-ops button:disabled{opacity:.5;cursor:default}.dsh-remote-ops input,.dsh-remote-ops textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:6px;padding:6px 7px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit}
        .dsh-remote-ops__head{display:flex;align-items:center;gap:7px;padding:9px 11px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}.dsh-remote-ops__head strong{flex:1;min-width:0}.dsh-remote-ops__headEnv{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#667085)}.dsh-remote-ops__muted{color:var(--dsw-alias-label-tertiary,#98a2b3)}.dsh-remote-ops__error{margin:7px 9px;padding:7px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 36%,transparent);border-radius:7px;color:var(--dsw-alias-state-error-primary,#d92d20);white-space:pre-wrap;overflow:auto;max-height:80px;flex:none}
        .dsh-remote-ops__workspace{display:flex;position:relative;min-height:0;flex:1;overflow:hidden}.dsh-remote-ops__rail{width:40px;flex:none;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 4px;border-right:1px solid var(--dsw-alias-border-l2,#d8dce5);background:var(--dsw-alias-bg-layer-1,#f7f9fb)}.dsh-remote-ops__rail button{width:32px;height:32px;padding:0;border-color:transparent;background:transparent;color:var(--dsw-alias-label-tertiary,#98a2b3);display:grid;place-items:center;font-size:15px}.dsh-remote-ops__rail button[data-active=true]{border-color:color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 12%,transparent);color:var(--dsw-alias-interactive-brand,#4d6bfe)}.dsh-remote-ops__railSpacer{flex:1}
        .dsh-remote-ops__main{display:grid;grid-template-rows:minmax(0,1fr) auto;flex:1;min-width:0;min-height:0;gap:8px;padding:8px;overflow:hidden}.dsh-remote-ops__terminal{display:flex;min-height:0;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 1px 2px rgba(16,24,40,.08)}.dsh-remote-ops__terminalHead{display:flex;align-items:center;gap:6px;padding:7px 8px;background:var(--dsw-alias-bg-layer-1,#f7f9fb);color:var(--dsw-alias-label-primary,#182230);flex:none}.dsh-remote-ops__terminalHead strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__terminalHead small{color:var(--dsw-alias-label-tertiary,#98a2b3)}.dsh-remote-ops__tabs{display:flex;gap:4px;overflow:auto;padding:5px 6px;border-top:1px solid var(--dsw-alias-border-l3,#e5e7eb);border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#f7f9fb);flex:none}.dsh-remote-ops__tabs button{padding:3px 7px;border-color:var(--dsw-alias-border-l3,#d8dce5);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#667085);white-space:nowrap;font-size:11px}.dsh-remote-ops__tabs button[data-active=true]{border-color:var(--dsw-alias-interactive-brand,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 11%,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary,#182230)}.dsh-remote-ops__screen{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#fff)}.dsh-remote-ops__output{box-sizing:border-box;position:absolute;inset:0;width:100%;height:100%;min-height:0;overflow-y:scroll;overflow-x:auto;margin:0;padding:10px 12px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-primary,#182230);scrollbar-gutter:stable;scrollbar-width:auto;scrollbar-color:var(--dsw-alias-border-l1,#aeb7c4) var(--dsw-alias-bg-layer-1,#f4f6f8)}.dsh-remote-ops__output::-webkit-scrollbar{width:12px;height:12px}.dsh-remote-ops__output::-webkit-scrollbar-track{background:var(--dsw-alias-bg-layer-1,#f4f6f8)}.dsh-remote-ops__output::-webkit-scrollbar-thumb{min-height:32px;border:3px solid var(--dsw-alias-bg-layer-1,#f4f6f8);border-radius:999px;background:var(--dsw-alias-border-l1,#aeb7c4)}.dsh-remote-ops__inputCapture{position:absolute;inset:0;z-index:2;width:100%;height:100%;margin:0;padding:0;border:0!important;outline:none!important;border-radius:0!important;resize:none;overflow:hidden;background:transparent!important;color:transparent!important;caret-color:transparent!important;opacity:.02;cursor:text;pointer-events:none;user-select:none}.dsh-remote-ops__screenHint{position:absolute;right:20px;bottom:10px;z-index:1;padding:3px 7px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#f7f9fb) 88%,transparent);color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:11px;pointer-events:none}.dsh-remote-ops__empty{display:grid;place-items:center;min-height:150px;padding:20px;text-align:center;color:var(--dsw-alias-label-tertiary,#98a2b3)}
        .dsh-remote-ops__quick{display:flex;flex:1;min-height:0;max-height:none;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#f8fafb)}.dsh-remote-ops__quickHead{display:flex;align-items:center;gap:6px;padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}.dsh-remote-ops__quickHead strong{flex:1}.dsh-remote-ops__quickBody{display:flex;gap:7px;min-height:0;max-height:none;flex:1;padding:7px;overflow:auto}.dsh-remote-ops__quickGroups{display:flex;flex:none;width:88px;flex-direction:column;gap:4px;overflow:auto;padding-right:5px;border-right:1px solid var(--dsw-alias-border-l2,#d8dce5)}.dsh-remote-ops__quickGroups button{text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-color:transparent;background:transparent;padding:5px;font-size:12px}.dsh-remote-ops__quickGroups button[data-active=true]{border-color:color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 28%,transparent);background:color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 11%,transparent);color:var(--dsw-alias-interactive-brand,#4d6bfe);font-weight:600}.dsh-remote-ops__quickItems{display:grid;grid-template-columns:repeat(auto-fill,minmax(115px,1fr));align-content:start;gap:6px;min-width:0;flex:1;overflow:auto}.dsh-remote-ops__quickItem{display:flex;align-items:center;gap:4px;min-width:0;padding:6px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:7px;background:var(--dsw-alias-bg-base,#fff)}.dsh-remote-ops__quickItem span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__tiny{padding:3px 5px!important;font-size:11px!important}
        .dsh-remote-ops__drawer,.dsh-remote-ops__aux{position:absolute;z-index:4;top:0;bottom:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);box-shadow:8px 0 22px rgba(16,24,40,.14)}.dsh-remote-ops__drawer{left:0;width:min(270px,74%);border-right:1px solid var(--dsw-alias-border-l2,#d8dce5)}.dsh-remote-ops__aux{right:0;width:min(300px,78%);border-left:1px solid var(--dsw-alias-border-l2,#d8dce5);box-shadow:-8px 0 22px rgba(16,24,40,.14)}.dsh-remote-ops__drawerHead{display:flex;align-items:center;gap:5px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}.dsh-remote-ops__drawerHead strong{flex:1}.dsh-remote-ops__drawerBody,.dsh-remote-ops__auxBody{min-height:0;flex:1;overflow:auto;padding:8px}.dsh-remote-ops__tools{display:flex;gap:5px;margin-bottom:7px}.dsh-remote-ops__tools input{flex:1}.dsh-remote-ops__group{margin-bottom:10px}.dsh-remote-ops__groupTitle{display:flex;align-items:center;gap:4px;padding:3px;color:var(--dsw-alias-label-secondary,#667085);font-weight:650}.dsh-remote-ops__groupTitle span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__env{display:flex;align-items:center;gap:5px;padding:6px 4px;border-radius:7px}.dsh-remote-ops__env:hover{background:var(--dsw-alias-interactive-bg-hover,#edf1f5)}.dsh-remote-ops__dot{width:7px;height:7px;flex:none;border-radius:50%;background:#a5adba}.dsh-remote-ops__dot[data-connected=true]{background:#35a16c;box-shadow:0 0 0 3px rgba(53,161,108,.13)}.dsh-remote-ops__envInfo{flex:1;min-width:0;cursor:pointer}.dsh-remote-ops__envName,.dsh-remote-ops__envMeta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__envName{font-weight:600}.dsh-remote-ops__envMeta{font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3)}.dsh-remote-ops__emptyList{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-tertiary,#98a2b3)}.dsh-remote-ops__card{border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:8px;padding:8px;margin-bottom:7px}.dsh-remote-ops__row{display:flex;align-items:center;gap:6px;min-width:0}.dsh-remote-ops__row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__version{font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3);white-space:nowrap}.dsh-remote-ops__update{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#35a16c) 46%,var(--dsw-alias-border-l3,#d8dce5));color:var(--dsw-alias-state-success-primary,#267c50);white-space:nowrap}.dsh-remote-ops__form{display:flex;flex-direction:column;gap:7px;margin-bottom:9px;padding:9px;border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#f7f9fb)}.dsh-remote-ops__form label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#667085)}.dsh-remote-ops__formActions{display:flex;gap:6px;justify-content:flex-end}.dsh-remote-ops__formNote{font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3)}.dsh-remote-ops__quickDock{display:flex;min-height:72px;max-height:50vh;min-width:0;flex-direction:column}.dsh-remote-ops__quickResize{height:9px;flex:none;display:grid;place-items:center;cursor:ns-resize;color:var(--dsw-alias-label-tertiary,#98a2b3);touch-action:none}.dsh-remote-ops__quickResize::before{content:"";width:38px;height:3px;border-radius:999px;background:var(--dsw-alias-border-l2,#c9d0db);transition:width .16s ease,background .16s ease}.dsh-remote-ops__quickResize:hover::before{width:54px;background:var(--dsw-alias-interactive-brand,#4d6bfe)}.dsh-remote-ops__headNotice{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-state-success-primary,#267c50)}.dsh-remote-ops__headNotice[data-error=true]{color:var(--dsw-alias-state-error-primary,#d92d20)}.dsh-remote-ops__launchControl{display:flex!important;align-items:center;justify-content:center;gap:7px;min-height:32px;padding:5px 9px!important;border:1px solid color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 32%,var(--dsw-alias-border-l2,#d8dce5))!important;border-radius:9px!important;background:linear-gradient(145deg,color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 12%,var(--dsw-alias-bg-base,#fff)),var(--dsw-alias-bg-layer-1,#f7f9fb))!important;color:var(--dsw-alias-label-primary,#182230)!important;font-weight:650!important;box-shadow:0 2px 6px rgba(16,24,40,.1);transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease}.dsh-remote-ops__launchControl:hover{border-color:var(--dsw-alias-interactive-brand,#4d6bfe)!important;box-shadow:0 4px 12px rgba(16,24,40,.15);transform:translateY(-1px)}.dsh-remote-ops__launchControl:active{transform:translateY(0);box-shadow:0 1px 3px rgba(16,24,40,.12)}.dsh-remote-ops__launchControlIcon{display:grid;place-items:center;width:21px;height:21px;border-radius:6px;background:var(--dsw-alias-interactive-brand,#4d6bfe);color:#fff;font-size:14px;line-height:1;font-weight:800}.dsh-remote-ops__error{display:flex;align-items:flex-start;gap:8px}.dsh-remote-ops__errorBody{flex:1;min-width:0;max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-remote-ops__errorClose{flex:none;padding:2px 6px!important;border-color:transparent!important;background:transparent!important;color:inherit!important;font-size:16px!important;line-height:1}.dsh-remote-ops__errorClose:hover{background:color-mix(in srgb,currentColor 10%,transparent)!important}.dsh-remote-ops__screenEmpty{cursor:text}.dsh-remote-ops__pendingCommand{margin:12px 0 0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#f7f9fb);color:var(--dsw-alias-label-primary,#182230);font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left}
      `; document.head.appendChild(style); style.textContent += `.dsh-remote-ops__head{flex-wrap:wrap}.dsh-remote-ops__headAction{min-height:36px!important;padding:7px 10px!important;font-size:12px!important;font-weight:650!important;white-space:nowrap}.dsh-remote-ops__drawerClose{min-width:36px;min-height:36px;padding:5px 9px!important;border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 52%,transparent)!important;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 10%,var(--dsw-alias-bg-base,#fff))!important;color:var(--dsw-alias-state-error-primary,#d92d20)!important;font-size:20px!important;font-weight:700!important;line-height:1!important}.dsh-remote-ops__drawerClose:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 18%,var(--dsw-alias-bg-base,#fff))!important}`;
    }
    const remoteOpsStyle = document.getElementById(styleId); if (remoteOpsStyle) remoteOpsStyle.textContent += `.dsh-remote-ops__inputCursor{display:inline-block;width:2px;height:1.15em;vertical-align:-.18em;background:var(--dsw-alias-interactive-brand,#4d6bfe);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 18%,transparent);animation:dsh-remote-ops-caret 1s steps(1,end) infinite;pointer-events:none}@keyframes dsh-remote-ops-caret{0%,45%{opacity:1}46%,100%{opacity:0}}`;
    if (remoteOpsStyle) remoteOpsStyle.textContent += `.dsh-remote-ops__main[data-module=sftp]{display:flex;padding:0;gap:0}.dsh-remote-ops__tab{display:flex;align-items:stretch;flex:none}.dsh-remote-ops__tab>button:first-child{border-radius:7px 0 0 7px}.dsh-remote-ops__tabClose{border-left:0!important;border-radius:0 7px 7px 0!important;padding:3px 6px!important}.dsh-remote-ops__dangerAction{color:var(--dsw-alias-state-error-primary,#d92d20)!important}.dsh-remote-ops__env{flex-wrap:wrap}.dsh-remote-ops__envConnections{width:100%;display:flex;flex-direction:column;gap:3px;margin:2px 0 0 13px;padding-left:7px;border-left:2px solid color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 22%,transparent)}.dsh-remote-ops__envConnection{display:flex;align-items:center;gap:5px;min-width:0}.dsh-remote-ops__connectionLink{flex:1;min-width:0;padding:2px 4px!important;border:0!important;background:transparent!important;text-align:left;font-size:11px!important;color:var(--dsw-alias-label-secondary,#667085)!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__sftpWorkspace{display:flex;min-width:0;min-height:0;flex:1;flex-direction:column;background:var(--dsw-alias-bg-base,#fff)}.dsh-remote-ops__sftpHead{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}.dsh-remote-ops__sftpHead strong{flex:none}.dsh-remote-ops__sftpHead select{min-width:170px;max-width:260px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit}.dsh-remote-ops__sftpHead .dsh-remote-ops__muted{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__sftpSplit{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:0;flex:1}.dsh-remote-ops__sftpPane{display:flex;min-width:0;min-height:0;flex-direction:column}.dsh-remote-ops__sftpPane+ .dsh-remote-ops__sftpPane{border-left:1px solid var(--dsw-alias-border-l2,#d8dce5)}.dsh-remote-ops__sftpPaneHead{display:flex;align-items:center;gap:5px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}.dsh-remote-ops__sftpPaneHead strong{flex:1}.dsh-remote-ops__sftpPath{padding:8px;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7eb);flex:none}.dsh-remote-ops__sftpEntries{min-height:0;flex:1;overflow:auto;padding:7px}.dsh-remote-ops__sftpEntry{display:flex;align-items:center;gap:6px;padding:6px 5px;border-bottom:1px solid var(--dsw-alias-border-l3,#eef0f3)}.dsh-remote-ops__sftpEntry:hover{background:var(--dsw-alias-interactive-bg-hover,#edf1f5)}.dsh-remote-ops__sftpName{display:flex;align-items:center;gap:6px;flex:1;min-width:0;border:0!important;background:transparent!important;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__sftpLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__sftpIcon{display:inline-grid;place-items:center;width:18px;flex:none;font-size:15px;font-weight:700;line-height:1}.dsh-remote-ops__sftpIcon[data-type=directory]{color:#c78100}.dsh-remote-ops__sftpIcon[data-type=file]{color:#3e72c4}.dsh-remote-ops__sftpSize{width:70px;text-align:right;color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:11px}.dsh-remote-ops__sftpEmpty{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-tertiary,#98a2b3)}@media (max-width:720px){.dsh-remote-ops__sftpSplit{grid-template-columns:1fr;grid-template-rows:minmax(220px,1fr) minmax(220px,1fr)}.dsh-remote-ops__sftpPane+ .dsh-remote-ops__sftpPane{border-left:0;border-top:1px solid var(--dsw-alias-border-l2,#d8dce5)}.dsh-remote-ops__sftpHead{flex-wrap:wrap}.dsh-remote-ops__sftpHead .dsh-remote-ops__muted{flex-basis:100%;order:3}}`;
    if (remoteOpsStyle) remoteOpsStyle.textContent += `
      .dsh-remote-ops__main{padding:0;gap:0}
      .dsh-remote-ops__terminal{border:0;border-radius:0;box-shadow:none}
      .dsh-remote-ops__head{padding:6px 10px;gap:8px}
      .dsh-remote-ops__headAction{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;min-width:36px;flex:none;padding:8px!important;border-radius:6px!important}
      .dsh-remote-ops__headAction svg{width:18px;height:18px}
      .dsh-remote-ops__headAction[aria-expanded=true]{background:color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 12%,transparent);border-color:var(--dsw-alias-interactive-brand,#4d6bfe)}
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
      .dsh-remote-ops__newOutput{position:absolute;right:24px;bottom:12px;z-index:3;min-height:32px!important;border-color:var(--dsw-alias-interactive-brand,#4d6bfe)!important;background:var(--dsw-alias-bg-base,#fff)!important;box-shadow:0 2px 6px #0002}
      .dsh-remote-ops__quick{border:0;border-top:1px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:0}
      .dsh-remote-ops__quickDock{min-width:0}
      .dsh-remote-ops__quickHead{flex-wrap:wrap}
      .dsh-remote-ops button:focus-visible{outline:2px solid var(--dsw-alias-interactive-brand,#4d6bfe);outline-offset:-2px}
      @media(prefers-reduced-motion:reduce){.dsh-remote-ops__inputCursor{animation:none}}
    `;
    if (remoteOpsStyle) remoteOpsStyle.textContent += `
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
      .dsh-remote-ops__sftpEntry[data-selected=true]{background:color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 10%,transparent)}
      .dsh-remote-ops__transfers{flex:none;max-height:28%;min-height:30px;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2,#d8dce5);padding:6px 8px}
      .dsh-remote-ops__transfer{display:flex;align-items:center;gap:6px;padding:5px 0;flex-wrap:wrap}.dsh-remote-ops__transfer span{flex:1;min-width:0;overflow-wrap:anywhere}.dsh-remote-ops__transfer small{width:100%;overflow-wrap:anywhere}
      .dsh-remote-ops__error{max-height:210px}.dsh-remote-ops__errorBody details{font:11px/1.4 Consolas,monospace}.dsh-remote-ops__errorBody summary{cursor:pointer}
      .dsh-remote-ops__transfer>details{width:100%}.dsh-remote-ops__transfer pre,.dsh-remote-ops__fileError{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 Consolas,monospace}
      .dsh-remote-ops__tab>button:first-child{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-remote-ops__sftpPaneHead select{flex-basis:90px}.dsh-remote-ops__sftpPaneHead button[aria-pressed=true]{color:#c78100}
      @container(max-width:600px){.dsh-remote-ops__sftpSplit{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) minmax(0,1fr)}.dsh-remote-ops__sftpPane+.dsh-remote-ops__sftpPane{border-left:0;border-top:1px solid var(--dsw-alias-border-l2,#d8dce5)}.dsh-remote-ops__quickItems{grid-template-columns:1fr}.dsh-remote-ops__sftpSize{width:50px}}
    `;
    if (remoteOpsStyle) remoteOpsStyle.textContent += `
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
    `;
    const failureMessage = (value, status) => [value.title, `HTTP ${status}`, value.code, value.stage, value.error, value.details ?? value.stack, value.cleanupError].filter(Boolean).join("\n");
    async function request(path, init) { const response = await fetch(path, init); const text = await response.text(); let value = {}; try { value = text ? JSON.parse(text) : {}; } catch { throw new Error(`HTTP ${response.status}: ${text}`); } if (!response.ok) { const error = Object.assign(new Error(value.error ?? `HTTP ${response.status}`), value); error.message = failureMessage(value, response.status); throw error; } return value; }
    const empty = { groups: [], environments: [], quickGroups: [], quickCommands: [], sessions: [], events: [], bound: false, pluginName: "dsh-remote-ops", pluginVersion: "0.2.22", update: { currentVersion: "0.2.22", latestVersion: "0.2.22", updateAvailable: false } };
    const glyph = { environments: "▦", quick: "⌘", sftp: "⇄", diagnostics: "⌁" };
    const terminalScreenModel = (value, rows = 40, columns = 160) => {
      const source = String(value ?? "");
      let screen = Array.from({ length: rows }, () => []);
      let scrollback = [];
      let normalScreen;
      let cursorVisible = true;
      let scrollTop = 0, scrollBottom = rows - 1;
      let row = 0;
      let column = 0;
      let savedRow = 0;
      let savedColumn = 0;
      const lineText = (line) => line.join("").replace(/\s+$/g, "");
      const fillTo = (line, target) => { while (line.length < target) line.push(" "); };
      const lineFeed = () => {
        if (row !== scrollBottom) { row = Math.min(rows - 1, row + 1); return; }
        const removed = screen.splice(scrollTop, 1)[0];
        if (!normalScreen && scrollTop === 0 && scrollBottom === rows - 1) scrollback.push(lineText(removed));
        screen.splice(scrollBottom, 0, []);
      };
      const put = (character) => {
        if (/\p{Mark}/u.test(character)) {
          const line = screen[row];
          let previous = column - 1;
          if (line[previous] === "") previous -= 1;
          if (previous >= 0) line[previous] = (line[previous] || " ") + character;
          return;
        }
        const point = character.codePointAt(0);
        const width = point >= 0x1100 && (point <= 0x115f || point >= 0x2e80 && point <= 0xa4cf || point >= 0xac00 && point <= 0xd7a3 || point >= 0xf900 && point <= 0xfaff || point >= 0xfe10 && point <= 0xfe6f || point >= 0xff01 && point <= 0xff60 || point >= 0x1f300) ? 2 : 1;
        if (column + width > columns) { column = 0; lineFeed(); }
        const line = screen[row];
        fillTo(line, column);
        if (line[column] === "" && column > 0) line[column - 1] = " ";
        if (line[column + width] === "") line[column + width] = " ";
        line[column] = character;
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
        if (final === "r") { scrollTop = Math.max(0, Math.min(rows - 1, (values[0] || 1) - 1)); scrollBottom = Math.max(scrollTop, Math.min(rows - 1, (values[1] || rows) - 1)); row = 0; column = 0; }
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
        put(character);
        index += character.length;
      }

      const allLines = [...scrollback, ...screen.map(lineText)];
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
      const cursorColumn = screen[row].slice(0, column).join("").length + Math.max(0, column - screen[row].length);
      return { text, alternateScreen: Boolean(normalScreen), cursorVisible, cursor: { row: visibleCursorRow, column: cursorColumn } };
    };
    const terminalVisibleText = (value, rows = 40, columns = 160) => terminalScreenModel(value, rows, columns).text;
    const ask = (label, value = "") => { const result = window.prompt(label, value); return result === null ? undefined : result.trim(); };
    const parseSshCommand = (value) => { const text = String(value ?? "").trim(); if (!/^ssh(?:\s|$)/i.test(text)) return undefined; const tokens = text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.slice(1).map((item) => item.replace(/^("|')|("|')$/g, "")) ?? []; let hostToken = ""; let username = ""; let port = 22; let privateKeyPath = ""; const takesValue = new Set(["-p", "-i", "-l", "-F", "-J", "-o", "-b", "-D", "-L", "-R", "-W", "-S", "-B", "-c", "-m", "-w"]); for (let index = 0; index < tokens.length; index += 1) { const token = tokens[index]; if (token === "--") { hostToken = tokens[index + 1] ?? ""; break; } if (token === "-p") { port = Number(tokens[++index]); continue; } if (token.startsWith("-p") && token.length > 2) { port = Number(token.slice(2)); continue; } if (token === "-i") { privateKeyPath = tokens[++index] ?? ""; continue; } if (token.startsWith("-i") && token.length > 2) { privateKeyPath = token.slice(2); continue; } if (token === "-l") { username = tokens[++index] ?? ""; continue; } if (token.startsWith("-l") && token.length > 2) { username = token.slice(2); continue; } if (token.startsWith("-")) { if (takesValue.has(token)) index += 1; continue; } if (!hostToken) hostToken = token; } if (!hostToken) return { error: "SSH 命令缺少主机地址，请使用 ssh [user@]host。" }; const at = hostToken.lastIndexOf("@"); if (at >= 0) { username = hostToken.slice(0, at) || username; hostToken = hostToken.slice(at + 1); } const host = hostToken.replace(/^\[|\]$/g, ""); if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return { error: "SSH 命令中的主机或端口无效。" }; return { host, username, port, privateKeyPath }; };

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
    });
    const pasteSubmission = (draft, owner) => {
      if (draft.owner !== owner || !draft.session) throw new Error("PASTE_TARGET_CHANGED: 当前会话已改变，请重新选择目标");
      return { session: draft.session, sessionId: owner, streamId: draft.streamId, text: draft.text.replace(/\r\n|\n/g, "\r") };
    };
    const outputMatches = (text, query) => query ? String(text).split("\n").flatMap((line, index) => line.toLowerCase().includes(query.toLowerCase()) ? [index] : []) : [];
    const fileEndpoint = pane => ({ kind: pane.kind, path: pane.path, ...(pane.kind === "ssh" ? { environment: pane.environment } : {}) });
    const mergeSessionTabs = (previous, current) => [...current.map(item => ({ ...item, disconnected: false })), ...previous.filter(item => !current.some(live => live.sessionId === item.sessionId)).slice(-12).map(item => ({ ...item, disconnected: true, status: { kind: "exited" } }))];
    const retryDelay = attempt => Math.min(30000, 600 * 2 ** Math.min(6, Math.max(0, attempt)));
    const fileWorkspacePreferences = (value = {}) => {
      const clean = pane => ({ kind: pane?.kind === "ssh" ? "ssh" : "host", environment: String(pane?.environment ?? ""), path: typeof pane?.path === "string" && pane.path.length < 4096 ? pane.path : ".", sort: ["name", "size", "modified"].includes(pane?.sort) ? pane.sort : "name", scrollTop: Math.max(0, Math.min(10000000, Number(pane?.scrollTop) || 0)) });
      return { panes: Array.isArray(value?.panes) ? value.panes.slice(0, 2).map(clean) : [], bookmarks: Array.isArray(value?.bookmarks) ? value.bookmarks.slice(0, 30).map(clean) : [] };
    };
    const sameFileLocation = (a, b) => a.kind === b.kind && (a.kind !== "ssh" || a.environment === b.environment) && String(a.path).replace(/\\/g, "/").replace(/\/+$/, "") === String(b.path).replace(/\\/g, "/").replace(/\/+$/, "");
    const sortedFileEntries = (entries, sort) => [...entries].sort((a, b) => Number(b.type === "d") - Number(a.type === "d") || (sort === "size" ? b.size - a.size : sort === "modified" ? (b.modifyTime ?? 0) - (a.modifyTime ?? 0) : 0) || a.name.localeCompare(b.name));

    function SftpWorkspace({ sessionId, environments, initialEnvironment, onError, onClose }) {
      const initial = (kind, environment = "") => ({ kind, environment, path: ".", draft: ".", sort: "name", scrollTop: 0, entries: [], selected: [], loading: false, loaded: false, error: "" });
      const [saved] = useState(() => { try { return fileWorkspacePreferences(JSON.parse(localStorage.getItem("remote-ops.files." + sessionId) || "{}")); } catch { return fileWorkspacePreferences(); } });
      const [panes, setPanes] = useState(() => [initial("host"), initial(environments.length ? "ssh" : "host", initialEnvironment || environments[0]?.id)].map((pane, side) => ({ ...pane, ...saved.panes[side], draft: saved.panes[side]?.path ?? "." })));
      const [bookmarks, setBookmarks] = useState(saved.bookmarks);
      const [preview, setPreview] = useState(null), [preparing, setPreparing] = useState(false);
      const [conflict, setConflict] = useState("error");
      const [tasks, setTasks] = useState([]);
      const [upload, setUpload] = useState(null);
      const generations = useRef([0, 0]), alive = useRef(true), uploadRequest = useRef(null);
      const panesRef = useRef(panes), bookmarksRef = useRef(bookmarks), lists = useRef([]), scrolls = useRef(panes.map(pane => pane.scrollTop));
      const saveTimer = useRef(), confirmation = useRef(), seenTasks = useRef(new Map());
      panesRef.current = panes; bookmarksRef.current = bookmarks;
      const save = () => { try { localStorage.setItem("remote-ops.files." + sessionId, JSON.stringify(fileWorkspacePreferences({ panes: panesRef.current.map((pane, side) => ({ ...pane, scrollTop: scrolls.current[side] })), bookmarks: bookmarksRef.current }))); } catch { /* Browser storage may be disabled. */ } };
      useEffect(() => { save(); }, [panes, bookmarks]);
      const invoke = useCallback(body => request("/api/dsh-remote-ops/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId }) }), [sessionId]);
      const change = (side, patch) => setPanes(current => current.map((pane, index) => index === side ? { ...pane, ...patch } : pane));
      const load = async (side, endpoint, selected = []) => {
        const generation = ++generations.current[side];
        const position = sameFileLocation(panesRef.current[side], endpoint) ? scrolls.current[side] : 0;
        change(side, { ...endpoint, loading: true, loaded: false, error: "", entries: [], selected: [] });
        try {
          const value = await invoke({ action: "files", endpoint: fileEndpoint(endpoint) });
          if (alive.current && generation === generations.current[side]) {
            change(side, { path: value.path, draft: value.path, entries: value.entries, selected, loaded: true, loading: false });
            window.requestAnimationFrame(() => { const list = lists.current[side]; if (!list || generation !== generations.current[side]) return; list.scrollTop = position; if (selected.length) list.querySelector("[data-selected=true]")?.scrollIntoView({ block: "nearest" }); scrolls.current[side] = list.scrollTop; save(); });
          }
        } catch (error) { if (alive.current && generation === generations.current[side]) { change(side, { error: error.message }); onError(error.message); } }
        finally { if (alive.current && generation === generations.current[side]) change(side, { loading: false }); }
      };
      useEffect(() => {
        alive.current = true;
        void load(0, panes[0]); void load(1, panes[1]);
        return () => { alive.current = false; clearTimeout(saveTimer.current); save(); confirmation.current?.(false); uploadRequest.current?.abort(); };
      }, []);
      useEffect(() => {
        let stopped = false, timer, failures = 0;
        const poll = async () => {
          if (sessionId) try {
            const value = await invoke({ action: "transfers" }); failures = 0;
            if (!stopped) {
              for (const task of value.tasks) {
                if (task.finishedAt && seenTasks.current.get(task.id) !== task.status) panesRef.current.forEach((pane, side) => { if (sameFileLocation(pane, task.target)) void load(side, pane); });
                seenTasks.current.set(task.id, task.status);
              }
              for (const id of seenTasks.current.keys()) if (!value.tasks.some(task => task.id === id)) seenTasks.current.delete(id);
              setTasks(value.tasks);
            }
          } catch (error) { failures++; if (!stopped) onError(error.message); }
          if (!stopped) timer = setTimeout(poll, failures ? retryDelay(failures) : 1500);
        };
        void poll(); return () => { stopped = true; clearTimeout(timer); };
      }, [invoke, sessionId]);
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
        const target = { ...panes[side] };
        setPreparing(true);
        for (const file of fileList) {
          if (!alive.current) break;
          try {
            if (!await confirmOverwrite({ source: { kind: "browser" }, target: fileEndpoint(target), names: [file.name], browserFile: { size: file.size, lastModified: file.lastModified }, conflict })) break;
            await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest(); uploadRequest.current = xhr;
              setUpload({ name: file.name, bytes: 0, total: file.size });
              xhr.open("POST", fileUrl(target, file.name).replace("/browser-file?", "/browser-upload?"));
              xhr.upload.onprogress = event => { if (alive.current) setUpload({ name: file.name, bytes: event.loaded, total: file.size }); };
              xhr.onload = () => { let value; try { value = JSON.parse(xhr.responseText); } catch { value = { error: xhr.responseText }; } if (xhr.status >= 200 && xhr.status < 300) resolve(value); else reject(new Error(failureMessage(value, xhr.status))); };
              xhr.onerror = () => reject(new Error("BROWSER_UPLOAD_NETWORK: 浏览器上传网络中断"));
              xhr.onabort = () => reject(new Error("BROWSER_UPLOAD_CANCELLED: 已取消上传"));
              xhr.send(file);
            });
          } catch (error) { if (alive.current) onError(error.message); break; }
          finally { uploadRequest.current = null; if (alive.current) setUpload(null); }
        }
        if (alive.current) { setPreparing(false); if (sameFileLocation(panesRef.current[side], target)) void load(side, panesRef.current[side]); }
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
      const renderPane = (pane, side) => h("section", { className: "dsh-remote-ops__sftpPane", key: side, "aria-label": side ? "文件目标 B" : "文件来源 A" },
        h("div", { className: "dsh-remote-ops__sftpPaneHead" }, h("strong", null, side ? "B" : "A"),
          h("select", { "aria-label": `位置 ${side ? "B" : "A"}`, value: pane.kind === "host" ? "host" : pane.environment, onChange: event => void load(side, initial(event.target.value === "host" ? "host" : "ssh", event.target.value === "host" ? "" : event.target.value)) }, h("option", { value: "host" }, "DSH 所在主机"), environments.map(env => h("option", { key: env.id, value: env.id }, env.name))),
          h("button", { title: "上级目录", "aria-label": `上级目录 ${side ? "B" : "A"}`, disabled: pane.loading, onClick: () => void load(side, { ...pane, path: join(pane.path, "..") }) }, "↑"),
          h("button", { title: "刷新目录", "aria-label": `刷新目录 ${side ? "B" : "A"}`, disabled: pane.loading, onClick: () => void load(side, pane) }, h(IconRefreshOutline16)),
          h("button", { title: "收藏当前路径", "aria-label": "收藏路径 " + (side ? "B" : "A"), "aria-pressed": bookmarks.some(item => sameFileLocation(item, pane)), disabled: !pane.loaded, onClick: () => bookmark(side) }, bookmarks.some(item => sameFileLocation(item, pane)) ? "★" : "☆"),
          h("select", { "aria-label": "路径书签 " + (side ? "B" : "A"), value: "", onChange: event => { if (event.target.value !== "") void load(side, { ...initial("host"), ...bookmarks[Number(event.target.value)] }); } }, h("option", { value: "" }, "书签"), bookmarks.map((item, index) => h("option", { key: index, value: index }, (item.kind === "host" ? "本机" : environments.find(env => env.id === item.environment)?.name ?? item.environment) + " · " + item.path))),
          h("select", { "aria-label": "排序 " + (side ? "B" : "A"), value: pane.sort, onChange: event => change(side, { sort: event.target.value }) }, h("option", { value: "name" }, "名称"), h("option", { value: "size" }, "大小"), h("option", { value: "modified" }, "修改时间")),
        ),
        h("form", { className: "dsh-remote-ops__sftpPath", onSubmit: event => { event.preventDefault(); void load(side, { ...pane, path: pane.draft }); } }, h("input", { "aria-label": `路径 ${side ? "B" : "A"}`, disabled: pane.loading, value: pane.draft, onChange: event => change(side, { draft: event.target.value }) }), h("button", { title: "打开路径", "aria-label": "打开路径", disabled: pane.loading }, "→")),
        h("div", { className: "dsh-remote-ops__sftpEntries", ref: node => { lists.current[side] = node; }, onScroll: event => { if (pane.loading) return; scrolls.current[side] = event.currentTarget.scrollTop; clearTimeout(saveTimer.current); saveTimer.current = setTimeout(save, 300); }, "aria-busy": pane.loading }, pane.loading ? "加载中…" : pane.error ? h("pre", { className: "dsh-remote-ops__fileError" }, pane.error) : pane.entries.length ? sortedFileEntries(pane.entries, pane.sort).map(item => h("div", { className: "dsh-remote-ops__sftpEntry", key: item.name, "data-selected": pane.selected.includes(item.name) },
          h("input", { type: "checkbox", "aria-label": `选择 ${item.name}`, disabled: !["d", "-"].includes(item.type), checked: pane.selected.includes(item.name), onChange: event => change(side, { selected: event.target.checked ? [...pane.selected, item.name] : pane.selected.filter(name => name !== item.name) }) }),
          h("button", { className: "dsh-remote-ops__sftpName", onDoubleClick: () => { if (item.type === "d") void load(side, { ...pane, path: join(pane.path, item.name) }); }, title: item.name }, h("span", { className: "dsh-remote-ops__sftpIcon", "data-type": item.type === "d" ? "directory" : "file", "aria-hidden": true }, item.type === "d" ? h(IconFolderClose16) : "▱"), h("span", { className: "dsh-remote-ops__sftpLabel" }, item.name)),
          h("span", { className: "dsh-remote-ops__sftpSize" }, item.type === "d" ? "" : `${(item.size / 1024).toFixed(1)} K`),
        )) : h("div", { className: "dsh-remote-ops__sftpEmpty" }, "空目录")),
        h("div", { className: "dsh-remote-ops__toolbar" },
          h("label", { title: "从当前浏览器设备上传文件" }, "浏览器上传", h("input", { type: "file", multiple: true, disabled: !sessionId || !pane.loaded || preparing || Boolean(upload), style: { width: "130px" }, onChange: event => { const files = [...event.target.files]; event.target.value = ""; void browserUpload(side, files); } })),
          h("button", { disabled: !sessionId || pane.selected.length !== 1 || pane.entries.find(item => item.name === pane.selected[0])?.type !== "-", title: "下载到当前浏览器设备", onClick: () => { const link = document.createElement("a"); link.href = fileUrl(pane, pane.selected[0]); link.download = pane.selected[0]; link.click(); } }, h(IconDownloadOutline16), " 浏览器"),
        ),
      );
      return h("section", { className: "dsh-remote-ops__sftpWorkspace" },
        h("div", { className: "dsh-remote-ops__sftpHead" }, h("strong", null, "文件传输"), h("span", { className: "dsh-remote-ops__muted" }, sessionId ? "" : "请先选择一个 DSH 会话"), h("button", { className: "dsh-remote-ops__drawerClose", "aria-label": "关闭 SFTP", title: "关闭 SFTP", onClick: onClose }, "×")),
        h("div", { className: "dsh-remote-ops__toolbar" }, h("button", { disabled: !sessionId || !panes[0].selected.length || preparing || panes.some(pane => !pane.loaded), onClick: () => void transfer(0) }, "A → B"), h("button", { disabled: !sessionId || !panes[1].selected.length || preparing || panes.some(pane => !pane.loaded), onClick: () => void transfer(1) }, "A ← B"), h("label", null, "同名文件", h("select", { value: conflict, onChange: event => setConflict(event.target.value) }, h("option", { value: "error" }, "停止并报告"), h("option", { value: "skip" }, "跳过"), h("option", { value: "overwrite" }, "覆盖")))),
        h("div", { className: "dsh-remote-ops__sftpSplit" }, panes.map(renderPane)),
        h("div", { className: "dsh-remote-ops__transfers", "aria-label": "传输任务" }, upload ? h("div", { className: "dsh-remote-ops__transfer" }, h("span", null, `${upload.name} · ${upload.bytes}/${upload.total} B`), h("button", { onClick: () => uploadRequest.current?.abort() }, "取消上传")) : null,
          tasks.slice().reverse().map(task => h("div", { className: "dsh-remote-ops__transfer", key: task.id },
            h("span", null, task.names.join(", ") + " · " + { queued: "排队", running: "传输中", completed: "完成", cancelled: "已取消", failed: "失败" }[task.status] + " · " + (task.bytes / 1048576).toFixed(2) + " MiB"),
            ["queued", "running"].includes(task.status) ? h("button", { onClick: () => void invoke({ action: "transfer-cancel", id: task.id }).catch(error => onError(error.message)) }, "取消") : null,
            task.retryable ? h("button", { disabled: preparing, onClick: () => void retry(task) }, "重试未完成项") : null,
            task.counts?.completed ? h("button", { onClick: () => void reveal(task, task.items.find(item => item.status === "completed")) }, "定位") : null,
            task.error ? h("small", { className: "dsh-remote-ops__dangerAction" }, task.error.code + " · " + task.error.stage + " · " + task.error.message) : null,
            h("details", null, h("summary", null, "完成 " + (task.counts?.completed ?? 0) + " · 失败 " + (task.counts?.failed ?? 0) + " · 待处理 " + (task.counts?.pending ?? 0) + " · 跳过 " + (task.counts?.skipped ?? 0)),
              (task.items ?? []).map(item => h("div", { className: "dsh-remote-ops__transfer", key: item.name }, h("span", null, item.name + " · " + { completed: "完成", failed: "失败", pending: "待处理", running: "传输中", skipped: "跳过" }[item.status]), item.status === "completed" ? h("button", { title: "定位文件", onClick: () => void reveal(task, item) }, h(IconFolderClose16)) : null)),
              task.itemsTruncated ? h("small", null, "显示前 200 项") : null, task.error?.stack ? h("pre", null, task.error.stack) : null)
          )), tasks.length || upload ? null : "暂无传输任务"),
        preview ? h("div", { className: "dsh-remote-ops__modalBackdrop" }, h("section", { className: "dsh-remote-ops__modal", role: "dialog", "aria-modal": true, "aria-label": "确认覆盖" },
          h("div", { className: "dsh-remote-ops__row" }, h("span", null, "覆盖 " + preview.conflictCount + " 个同名项目"), h("button", { className: "dsh-remote-ops__drawerClose", "aria-label": "取消覆盖", onClick: () => finishPreview(false) }, "×")),
          h("small", null, (preview.source.path ?? "浏览器") + " → " + preview.target.path),
          preview.conflicts.map(item => h("div", { key: item.name }, h("strong", null, item.name), h("div", null, "来源：" + describeFile(item.source)), h("div", null, "目标：" + describeFile(item.target)))),
          preview.truncated ? h("small", null, "仅显示前 200 个冲突") : null,
          h("div", { className: "dsh-remote-ops__formActions" }, h("button", { onClick: () => finishPreview(false) }, "取消"), h("button", { className: "dsh-remote-ops__dangerAction", onClick: () => finishPreview(true) }, "确认覆盖"))
        )) : null,
      );
    }
    function CommandDialog({ sessionId, target, onClose }) {
      const [command, setCommand] = useState(""), [timeout, setTimeoutSeconds] = useState(30);
      const [running, setRunning] = useState(false), [result, setResult] = useState(null), [failure, setFailure] = useState("");
      const current = useRef(null), alive = useRef(true);
      const invoke = (body, signal) => request("/api/dsh-remote-ops/workspace", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId }) });
      const cancel = async () => { if (current.current) try { await invoke({ action: "command-cancel", requestId: current.current.id }); } catch (error) { if (alive.current) setFailure(error.message); } };
      useEffect(() => { alive.current = true; return () => { alive.current = false; if (current.current) { void cancel(); current.current.controller.abort(); } }; }, []);
      const execute = async event => {
        event.preventDefault();
        const id = window.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2), controller = new AbortController();
        current.current = { id, controller }; setRunning(true); setResult(null); setFailure("");
        try { const value = await invoke({ action: "command-execute", session: target.sessionId, command, timeoutSeconds: timeout, requestId: id }, controller.signal); if (alive.current) setResult(value); }
        catch (error) { if (alive.current) setFailure(error.message); }
        finally { current.current = null; if (alive.current) setRunning(false); }
      };
      const close = () => { if (!running || window.confirm("取消正在等待的独立命令并关闭？远程进程可能仍在运行。")) onClose(); };
      return h("div", { className: "dsh-remote-ops__modalBackdrop" }, h("section", { className: "dsh-remote-ops__modal", role: "dialog", "aria-modal": true, "aria-label": "独立命令" },
        h("div", { className: "dsh-remote-ops__row" }, h("span", null, "独立命令 · " + (target.name)), h("button", { className: "dsh-remote-ops__drawerClose", "aria-label": "关闭独立命令", onClick: close }, "×")),
        h("small", null, "工作目录：" + (target.kind === "local" ? target.workingDirectory : "SSH 服务默认目录") + " · 不继承交互终端的目录和临时变量"),
        h("form", { onSubmit: execute }, h("textarea", { autoFocus: true, required: true, maxLength: 32768, "aria-label": "独立命令内容", spellCheck: false, disabled: running, value: command, onChange: event => setCommand(event.target.value) }),
          h("div", { className: "dsh-remote-ops__toolbar" }, h("label", null, "超时（秒）", h("input", { type: "number", required: true, min: 1, max: 300, value: timeout, disabled: running, onChange: event => setTimeoutSeconds(Number(event.target.value)) })),
            running ? h("button", { type: "button", onClick: () => void cancel() }, h(IconStopFill16), " 取消") : h("button", { type: "submit", disabled: !command.trim() }, h(IconPlayOutline16), " 执行"))),
        failure ? h("pre", { className: "dsh-remote-ops__dangerAction" }, failure) : null,
        running ? h("div", { role: "status" }, "执行中") : null,
        result ? h(React.Fragment, null, h("strong", { role: "status" }, ({ completed: "已退出", failed: "执行失败", cancelled: "已取消", timed_out: "已超时", unknown: "退出未知" }[result.status] ?? result.status) + " · 退出码 " + (result.exitCode ?? "未知") + " · " + result.durationMs + " ms"),
          result.completion === "unknown" ? h("small", { className: "dsh-remote-ops__dangerAction" }, "未确认命令完成；远程进程可能仍在运行") : null,
          h("strong", null, "stdout" + (result.stdoutTruncated ? " · 已截断" : "")), h("pre", { "aria-label": "命令标准输出" }, result.stdout || "（空）"),
          h("strong", null, "stderr" + (result.stderrTruncated ? " · 已截断" : "")), h("pre", { "aria-label": "命令标准错误" }, result.stderr || "（空）")) : null
      ));
    }
    const terminalDraftPending = (pending, text) => {
      for (const char of text) { if (/[\r\n\u0003]/.test(char)) pending = false; else if (char >= " " || char === "\t" || char === "\u001b") pending = true; }
      return pending;
    };
    const quickPaneHeight = (value, availableHeight, terminalReserve) => Math.max(0, Math.min(Math.max(92, Number(value) || 190), Math.max(0, availableHeight - terminalReserve)));
    const quickCommandList = (commands, query = "", group = "", pinnedOnly = true) => commands.filter(item => (!pinnedOnly || item.pinned !== false) && (!group || item.group === group) && `${item.name}\n${item.command}\n${item.group}`.toLowerCase().includes(query.trim().toLowerCase())).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const quickDispatchDraft = (command, target, frame, owner, requestId) => ({ commandId: command.id, command: command.command, name: command.name, revision: command.revision, session: target?.sessionId, targetName: target?.name, streamId: frame?.streamId, owner, requestId });
    const quickDraftValid = (draft, owner, session, streamId) => Boolean(draft?.session && draft.streamId && draft.owner === owner && draft.session === session && draft.streamId === streamId);
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
      const dock = useRef(null), drag = useRef(null), sending = useRef(false), editing = useRef(false), dialog = useRef(null);
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
      const modalOpen = Boolean(manager || editor || confirmation);
      useEffect(() => {
        if (!modalOpen) return;
        const previous = document.activeElement;
        dialog.current?.querySelector("input,button,textarea")?.focus({ preventScroll: true });
        return () => previous?.isConnected && previous.focus({ preventScroll: true });
      }, [modalOpen, Boolean(editor), Boolean(confirmation)]);
      const iconButton = (label, Icon, onClick, disabled = false, extra = {}) => h("button", { type: "button", className: "dsh-remote-ops__quickIcon", "aria-label": label, title: label, disabled, onClick, ...extra }, h(Icon, { "aria-hidden": true }));
      const closeEditor = () => { if (!saving && (!editor || JSON.stringify(editor.value) === editor.original || window.confirm("放弃未保存的修改？"))) { setEditor(null); setFailure(""); } };
      const closeModal = () => { if (saving || pending) return; if (editor) closeEditor(); else { setManager(false); setConfirmation(null); setFailure(""); } };
      const modal = (title, content) => h("div", { className: "dsh-remote-ops__modalBackdrop" }, h("section", { className: "dsh-remote-ops__modal", role: "dialog", "aria-modal": true, "aria-label": title, ref: dialog, onKeyDown: event => {
        if (event.key === "Escape") { event.stopPropagation(); closeModal(); }
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']")];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      } }, h("div", { className: "dsh-remote-ops__quickModalHead" }, h("strong", null, title), iconButton("关闭快捷命令弹窗", IconCloseOutline16, closeModal, saving || pending, { className: "dsh-remote-ops__quickIcon dsh-remote-ops__dangerAction" })), content, failure ? h("pre", { role: "alert", className: "dsh-remote-ops__dangerAction" }, failure) : null));
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
          h("button", { disabled: saving, onClick: async () => { const name = window.prompt("快捷命令分组名称"); if (name?.trim()) await mutate({ action: "quick-group.create", name: name.trim() }); } }, "新建分组"),
          iconButton("重命名分组", IconEditOutline16, async () => { const name = window.prompt("新的快捷命令分组名称", group); if (name?.trim() && name.trim() !== group && await mutate({ action: "quick-group.rename", group, name: name.trim() })) setGroup(name.trim()); }, saving || !group),
          iconButton("删除空分组", IconCloseOutline16, async () => { if (window.confirm(`删除空分组“${group}”？`)) await mutate({ action: "quick-group.delete", group }); }, saving || !group)),
        h("div", { className: "dsh-remote-ops__quickLibrary" }, quickCommandList(commands, query, group, false).map(item => h("div", { key: item.id, className: "dsh-remote-ops__quickLibraryRow" },
          h("input", { type: "checkbox", checked: pinDraft?.id === item.id ? pinDraft.pinned : item.pinned !== false, "aria-label": `显示按钮 ${item.name}`, disabled: saving || Boolean(pinDraft), onChange: async event => { const pinned = event.target.checked; setPinDraft({ id: item.id, pinned }); if (!await mutate({ action: "quick.save", command: { ...item, expectedRevision: item.revision, pinned } })) setPinDraft(null); } }),
          h("span", { title: item.command }, item.name, h("small", null, item.group, item.confirm ? " · 执行前确认" : "")),
          iconButton(`上移 ${item.name}`, IconChevronUpOutline14, () => mutate({ action: "quick.move", commandId: item.id, direction: -1 }, true), saving || all[0]?.id === item.id),
          iconButton(`下移 ${item.name}`, IconChevronDownOutline14, () => mutate({ action: "quick.move", commandId: item.id, direction: 1 }, true), saving || all.at(-1)?.id === item.id),
          iconButton(`编辑 ${item.name}`, IconEditOutline16, () => startEditor(item), saving),
          iconButton(`删除命令 ${item.name}`, IconCloseOutline16, () => { if (window.confirm(`永久删除快捷命令“${item.name}”？`)) return mutate({ action: "quick.delete", commandId: item.id }); }, saving, { className: "dsh-remote-ops__quickIcon dsh-remote-ops__dangerAction" }))),
          commands.length ? null : h("p", null, "暂无命令")))) : null;
      const confirmView = confirmation ? modal("确认下发快捷命令", h(React.Fragment, null, h("strong", null, `${confirmation.name} → ${confirmation.targetName}`), h("small", { className: "dsh-remote-ops__sessionIdentity" }, confirmation.session), h("pre", null, confirmation.command), h("div", { className: "dsh-remote-ops__formActions" }, h("button", { disabled: pending, onClick: () => setConfirmation(null) }, "取消"), h("button", { "aria-label": "确认下发", disabled: pending || !quickDraftValid(confirmation, owner, target?.sessionId, frame?.streamId), onClick: () => send(confirmation, true) }, pending ? "下发中…" : "确认下发")))) : null;
      if (hidden) return null;
      return h("section", { ref: dock, className: "dsh-remote-ops__quickDock", "aria-label": "常用命令窗格", style: { height: open ? `${visibleHeight}px` : "42px" } },
        open ? h("div", { className: "dsh-remote-ops__quickResize", role: "separator", tabIndex: 0, "aria-label": "调整快捷命令区域高度", "aria-orientation": "horizontal", "aria-valuemin": Math.min(92, visibleHeight), "aria-valuemax": Math.max(0, bounds.available - bounds.reserve), "aria-valuenow": Math.round(visibleHeight), title: "拖动调整高度；双击恢复默认", onPointerDown: resize, onPointerMove: event => { if (drag.current?.id === event.pointerId) setHeight(quickPaneHeight(drag.current.height + drag.current.y - event.clientY, bounds.available, bounds.reserve)); }, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; }, onDoubleClick: () => setHeight(190), onKeyDown: event => { const values = { ArrowUp: visibleHeight + 32, ArrowDown: visibleHeight - 32, Home: 92, End: bounds.available - bounds.reserve }; if (event.key in values) { event.preventDefault(); setHeight(quickPaneHeight(values[event.key], bounds.available, bounds.reserve)); } } }) : null,
        h("div", { className: "dsh-remote-ops__quickHead" }, iconButton(open ? "收起常用命令" : "展开常用命令", open ? IconChevronDownOutline14 : IconChevronUpOutline14, () => setOpen(!open), false, { "aria-expanded": open }), h("div", { className: "dsh-remote-ops__quickIdentity" }, h("strong", null, "常用命令"), h("small", { title: target?.sessionId }, target?.name ?? "未选择终端")), iconButton("新增快捷命令", IconPlusOutline16, () => startEditor()), iconButton("管理快捷命令", IconSettingsOutline16, () => { setManager(true); setFailure(""); })),
        open ? filters : null,
        open ? h("div", { className: "dsh-remote-ops__quickButtons" }, items.length ? items.map(item => h("button", { key: item.id, "aria-label": `执行 ${item.name}`, title: `${item.name}\n${item.command}${item.confirm ? "\n执行前确认" : ""}`, disabled: pending || !ready || target?.disconnected, "aria-busy": pending, onClick: event => run(item, event) }, h(IconPlayOutline16, { "aria-hidden": true }), h("span", null, item.name))) : h("div", { className: "dsh-remote-ops__quickEmpty" }, commands.length ? "没有匹配的快捷按钮" : "暂无常用命令")) : null,
        open && pending ? h("div", { className: "dsh-remote-ops__quickReceipt", role: "status" }, "下发中…") : null,
        open && receipt ? h("div", { className: "dsh-remote-ops__quickReceipt", role: "status" }, `${receipt.label} · ${receipt.status === "written" ? "已写入终端" : receipt.status === "failed" ? "未下发" : "写入结果未知，请先检查终端"}`, receipt.error ? h("details", null, h("summary", null, "错误详情"), [receipt.error.code, receipt.error.stage, receipt.error.details].filter(Boolean).join("\n")) : null) : null,
        open && failure && !modalOpen ? h("div", { className: "dsh-remote-ops__quickReceipt dsh-remote-ops__dangerAction", role: "alert" }, failure) : null,
        editorView, managerView, confirmView);
    }
    function RemoteOpsPanel({ sessionId }) {
      const knownTabs = useRef({ owner: sessionId, tabs: [] });
      const [reviewStream, setReviewStream] = useState(null);
      const composingRef = useRef(false);
      const [loadedSnapshot, setSnapshot] = useState(empty); const [terminalFrames, setTerminalFrames] = useState({}); const [drawer, setDrawer] = useState(false); const [module, setModule] = useState("terminal"); const [quickOpen, setQuickOpen] = useState(() => { try { return localStorage.getItem("remote-ops.quick-open") !== "false"; } catch { return true; } }); const [environmentForm, setEnvironmentForm] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [actionNotice, setActionNotice] = useState(""); const [update, setUpdate] = useState(empty.update); const [updateBusy, setUpdateBusy] = useState(false); const [refreshBusy, setRefreshBusy] = useState(false); const [selectedEnv, setSelectedEnv] = useState(""); const [activeSessionId, setActiveSessionId] = useState(""); const [terminalInput, setTerminalInput] = useState(""); const [pendingSshInput, setPendingSshInput] = useState(""); const [quickHeight, setQuickHeight] = useState(190); const [search, setSearch] = useState(""); const outputRef = useRef(null); const terminalInputRef = useRef(null); const stickToBottom = useRef(true); const userScrollIntent = useRef(false); const scrollIntentTimer = useRef(); const rawInputQueue = useRef([]); const rawInputTimer = useRef(); const rawInputSending = useRef(false); const pendingSshInputRef = useRef(""); const refreshRequest = useRef(); const snapshotSignature = useRef(""); const terminalFramesRef = useRef({});
      const viewOwner = useRef(sessionId); viewOwner.current = sessionId;
      const snapshot = loadedSnapshot.viewOwner === (sessionId ?? "") ? loadedSnapshot : empty;
      const [outputConnection, setOutputConnection] = useState("connecting");
      const [unreadOutput, setUnreadOutput] = useState(false);
      const [inputFocused, setInputFocused] = useState(false);
      const [preferences, setPreferences] = useState(() => { try { return terminalPreferences(JSON.parse(localStorage.getItem("remote-ops.preferences") || "{}")); } catch { return terminalPreferences(); } });
      const [outputSearch, setOutputSearch] = useState("");
      const [searchOpen, setSearchOpen] = useState(false);
      const [matchIndex, setMatchIndex] = useState(0);
      const manualDrafts = useRef(new Map());
      const quickSending = useRef(false);
      const [pasteDraft, setPasteDraft] = useState(null);
      const [connectionChoices, setConnectionChoices] = useState(null);
      const [diagnosticPreview, setDiagnosticPreview] = useState(null);
      const [commandTarget, setCommandTarget] = useState(null);
      useEffect(() => { setCommandTarget(null); }, [sessionId]);
      useEffect(() => { setQuickHeight(preferences.quickHeight); }, []);
      useEffect(() => { try { localStorage.setItem("remote-ops.preferences", JSON.stringify({ ...preferences, quickHeight })); } catch { /* Storage can be disabled by browser policy. */ } }, [preferences, quickHeight]);
      useEffect(() => { setPasteDraft(null); setConnectionChoices(null); setActiveSessionId(""); setReviewStream(null); }, [sessionId]);
      const refresh = useCallback(() => {
        if (refreshRequest.current && refreshRequest.current.ownerKey === sessionId) return refreshRequest.current;
        const task = (async () => {
          try {
            const value = await request(`/api/dsh-remote-ops/state${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`);
            if (viewOwner.current !== sessionId) return false;
            value.viewOwner = sessionId ?? "";
            value.tabs = mergeSessionTabs(knownTabs.current.owner === sessionId ? knownTabs.current.tabs : [], value.sessions);
            knownTabs.current = { owner: sessionId, tabs: value.tabs };
            const signature = JSON.stringify(value);
            if (signature !== snapshotSignature.current) {
              snapshotSignature.current = signature;
              setSnapshot(value);
              if (value.update) setUpdate(value.update);
            }
            return true;
          } catch (cause) {
            if (viewOwner.current === sessionId) setError(cause instanceof Error ? cause.message : String(cause));
            return false;
          }
        })();
        task.ownerKey = sessionId;
        refreshRequest.current = task;
        void task.finally(() => { if (refreshRequest.current === task) refreshRequest.current = undefined; });
        return task;
      }, [sessionId]);
      useEffect(() => {
        let stopped = false, timer, attempt = 0;
        const poll = async () => { const ok = await refresh(); attempt = ok ? 0 : attempt + 1; if (!stopped) timer = setTimeout(poll, Math.max(3000, retryDelay(attempt))); };
        void poll(); return () => { stopped = true; clearTimeout(timer); };
      }, [refresh]);
      const workspaceAction = useCallback(async body => {
        const owner = sessionId;
        setBusy(true);
        try {
          const value = await request("/api/dsh-remote-ops/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId: owner }) });
          if (viewOwner.current !== owner) return undefined;
          setError(""); await refresh(); return value;
        } catch (cause) { if (viewOwner.current === owner) setError(cause.message); return undefined; }
        finally { setBusy(false); }
      }, [sessionId, refresh]);
      const checkUpdate = useCallback(async (silent = false) => { setUpdateBusy(true); if (!silent) setActionNotice(""); try { const value = await request("/api/dsh-remote-ops/update"); setUpdate(value); setError(""); if (!silent) setActionNotice(value.updateAvailable ? `发现新版本 v${value.latestVersion}` : `已是最新版本 v${value.currentVersion}`); return value; } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); if (!silent) setActionNotice("检查更新失败"); return undefined; } finally { setUpdateBusy(false); } }, []);
      useEffect(() => { void checkUpdate(true); }, [checkUpdate]);
      const refreshNow = useCallback(async () => { if (refreshBusy) return; setRefreshBusy(true); setActionNotice(""); const ok = await refresh(); setActionNotice(ok ? "已刷新" : "刷新失败"); setRefreshBusy(false); }, [refresh, refreshBusy]);
      useEffect(() => { if (!selectedEnv && snapshot.environments[0]) setSelectedEnv(snapshot.environments[0].id); if (!activeSessionId && snapshot.sessions.length) setActiveSessionId((snapshot.sessions.find(item => item.kind !== "local") ?? snapshot.sessions[0]).sessionId); }, [activeSessionId, selectedEnv, snapshot]);
      useEffect(() => { try { localStorage.setItem("remote-ops.quick-open", String(quickOpen)); } catch { /* Browser storage is optional. */ } }, [quickOpen]);
      const action = useCallback(async (body) => { setBusy(true); try { const value = await request("/api/dsh-remote-ops/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId }) }); setError(""); await refresh(); return value; } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return undefined; } finally { setBusy(false); } }, [refresh, sessionId]);
      const installUpdate = async () => { if (!update.updateAvailable || updateBusy) return; if (!window.confirm(`安装 Remote Ops v${update.latestVersion}？安装完成后需要重启 DSH。`)) return; setUpdateBusy(true); setActionNotice(""); try { const value = await request("/api/dsh-remote-ops/update", { method: "POST" }); setUpdate(value); setError(""); setActionNotice(`已安装 v${value.currentVersion ?? update.latestVersion}，请重启 DSH`); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setActionNotice("升级失败"); } finally { setUpdateBusy(false); } };
      const tabs = snapshot.tabs ?? snapshot.sessions;
      const activeSession = activeSessionId ? tabs.find(item => item.sessionId === activeSessionId) : tabs[0]; const activeEnvironment = snapshot.environments.find((item) => item.id === (activeSession?.environmentId ?? selectedEnv)); const localActive = activeSession?.kind === "local";
      const activeTerminalId = activeSession?.sessionId ?? "";
      const activeFrameKey = `${sessionId ?? ""}:${activeTerminalId}`;
      const activeTerminalFrame = activeTerminalId ? terminalFrames[activeFrameKey] : undefined;
      const terminalReady = terminalInputEnabled(snapshot) && !activeSession?.disconnected && Boolean(activeTerminalFrame?.streamId) && outputConnection === "connected" && reviewStream !== activeFrameKey;
      const terminalScreen = useMemo(() => terminalScreenModel(activeTerminalFrame?.raw ?? ""), [activeTerminalFrame?.raw]);
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
        const props = { key: `line-${index}`, "data-line": index, "data-match": matchedLines.has(index) };
        if (index !== terminalScreen.cursor.row || !terminalScreen.cursorVisible || !terminalReady) return h("span", props, line, index < lines.length - 1 ? "\n" : null);
        const before = line.slice(0, terminalScreen.cursor.column).padEnd(terminalScreen.cursor.column, " ");
        return h("span", props, before, h("span", { className: "dsh-remote-ops__inputCursor", "aria-hidden": true }), line.slice(terminalScreen.cursor.column), index < lines.length - 1 ? "\n" : null);
      }) : "等待终端输出…";
      useEffect(() => { if (!terminalReady) return undefined; const frame = window.requestAnimationFrame(() => terminalInputRef.current?.focus({ preventScroll: true })); return () => window.cancelAnimationFrame(frame); }, [activeTerminalId, terminalReady]);
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
              const changed = value.reset || Boolean(value.text) || previous?.status?.kind !== value.status?.kind || previous?.activity !== value.activity || JSON.stringify(previous?.control) !== JSON.stringify(value.control) || JSON.stringify(previous?.toolReceipt) !== JSON.stringify(value.toolReceipt);
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
              setError(cause instanceof Error ? cause.message : String(cause));
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
        if (value?.sessionId) { setActiveSessionId(value.sessionId); setDrawer(false); }
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
            try {
              await request("/api/dsh-remote-ops/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "input", ...input }) });
            } catch (cause) {
              rawInputQueue.current = [];
              setError(cause instanceof Error ? cause.message : String(cause));
              break;
            }
          }
        } finally {
          rawInputSending.current = false;
        }
      }, [activeSessionId, openFromSshCommand, sessionId, snapshot.bound, snapshot.localError, snapshot.sessions]);
      const queueRawInput = useCallback((text) => { if (!text || !terminalReady) return; if (quickSending.current) { setError("QUICK_DISPATCH_PENDING: 快捷命令正在下发，请稍后输入。"); return; } const draftKey = `${sessionId ?? ""}:${activeTerminalId}:${activeTerminalFrame?.streamId}`; manualDrafts.current.set(draftKey, terminalDraftPending(manualDrafts.current.get(draftKey), text)); queueTerminalInput(rawInputQueue.current, { session: activeTerminalId, sessionId, streamId: activeTerminalFrame?.streamId, text }); if (rawInputTimer.current || rawInputSending.current) return; rawInputTimer.current = window.setTimeout(() => { rawInputTimer.current = undefined; void flushRawInput(); }, 20); }, [activeTerminalId, flushRawInput, sessionId, terminalReady, activeTerminalFrame?.streamId]);
      useEffect(() => { rawInputQueue.current = []; manualDrafts.current.clear(); pendingSshInputRef.current = ""; setPendingSshInput(""); setTerminalInput(""); }, [sessionId]);
      useEffect(() => () => { if (rawInputTimer.current) window.clearTimeout(rawInputTimer.current); if (scrollIntentTimer.current) window.clearTimeout(scrollIntentTimer.current); rawInputQueue.current = []; }, []);
      const keySequence = (event) => { if (event.ctrlKey && !event.altKey && !event.metaKey) { const key = event.key.toLowerCase(); if (key.length === 1 && key >= "a" && key <= "z") return String.fromCharCode(key.charCodeAt(0) - 96); if (key === "[") return "\u001b"; if (key === "\\") return "\u001c"; if (key === "]") return "\u001d"; if (key === "^") return "\u001e"; if (key === "_") return "\u001f"; if (key === " ") return "\u0000"; } if (event.key === "Tab") return event.shiftKey ? "\u001b[Z" : "\t"; const sequences = { Enter: "\r", Escape: "\u001b", Backspace: "\u007f", Delete: "\u001b[3~", ArrowUp: "\u001b[A", ArrowDown: "\u001b[B", ArrowRight: "\u001b[C", ArrowLeft: "\u001b[D", Home: "\u001b[H", End: "\u001b[F", PageUp: "\u001b[5~", PageDown: "\u001b[6~", Insert: "\u001b[2~" }; return sequences[event.key]; };
      const addGroup = async () => { const name = ask("环境分组名称"); if (name) await action({ action: "group.create", name }); };
      const editGroup = async (group) => { const name = ask("新的环境分组名称", group); if (name && name !== group) await action({ action: "group.rename", group, name }); };
      const openEnvironmentForm = (initial) => setEnvironmentForm({ mode: initial ? "edit" : "create", id: initial?.id ?? "", name: initial?.name ?? "", host: initial?.host ?? "", username: initial?.username ?? "root", group: initial?.group ?? snapshot.groups[0] ?? "default", port: String(initial?.port ?? 22), passwordRef: initial?.passwordRef === "configured" ? "" : initial?.passwordRef ?? "", password: "", privateKeyPath: initial?.privateKeyPath ?? "", credentialConfigured: initial?.passwordRef === "configured" });
      const updateEnvironmentForm = (field, value) => setEnvironmentForm((current) => current ? { ...current, [field]: value } : current);
      const saveEnvironmentForm = async (event) => { event.preventDefault(); if (!environmentForm) return; const required = [["主机地址", environmentForm.host], ["用户名", environmentForm.username]]; const missing = required.find(([, value]) => !String(value ?? "").trim()); if (missing) { setError(`${missing[0]}不能为空`); return; } const port = Number(environmentForm.port); if (!Number.isInteger(port) || port < 1 || port > 65535) { setError("SSH 端口必须是 1-65535 的整数"); return; } const environment = { ...(environmentForm.id ? { id: environmentForm.id.trim() } : {}), name: environmentForm.name.trim() || environmentForm.host.trim(), host: environmentForm.host.trim(), username: environmentForm.username.trim(), group: environmentForm.group.trim() || "default", port }; if (environmentForm.privateKeyPath.trim()) environment.privateKeyPath = environmentForm.privateKeyPath.trim(); const body = { action: "environment.save", environment }; if (environmentForm.password) body.password = environmentForm.password; const value = await action(body); if (value) setEnvironmentForm(null); };
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
          const input = pasteSubmission(pasteDraft, sessionId);
          const value = await action({ action: "input", ...input });
          if (value) { const key = `${sessionId ?? ""}:${input.session}:${input.streamId}`; manualDrafts.current.set(key, terminalDraftPending(manualDrafts.current.get(key), input.text)); setPasteDraft(null); }
        } catch (cause) { setError(cause.message); }
      };
      const dismissTab = target => {
        knownTabs.current.tabs = knownTabs.current.tabs.filter(item => item.sessionId !== target);
        setSnapshot(current => ({ ...current, tabs: (current.tabs ?? []).filter(item => item.sessionId !== target) }));
        if (activeSessionId === target) setActiveSessionId("");
      };
      const releaseSession = async session => {
        if (session.disconnected) { dismissTab(session.sessionId); return; }
        if (!window.confirm(`关闭连接“${session.name}”？这会结束该终端会话。`)) return;
        const value = await action({ action: "close", session: session.sessionId });
        if (value?.closed) dismissTab(session.sessionId);
      };
      const reconnect = async () => {
        if (!activeEnvironment || !window.confirm(`重新连接“${activeSession.name}”？不会重发任何命令。`)) return;
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
          h("button", { className: "dsh-remote-ops__tiny dsh-remote-ops__dangerAction", onClick: () => { if (window.confirm(`删除环境“${env.name}”？`)) void action({ action: "environment.delete", environment: env.id }); } }, "×"),
          connections.length ? h("div", { className: "dsh-remote-ops__envConnections" }, connections.map((session, index) => h("div", { className: "dsh-remote-ops__envConnection", key: session.sessionId }, h("button", { className: "dsh-remote-ops__connectionLink", title: `会话：${session.ownerId} · 最近活动：${session.lastActivity ? new Date(session.lastActivity).toLocaleString() : "暂无"}`, onClick: () => { setActiveSessionId(session.sessionId); setSelectedEnv(env.id); setDrawer(false); } }, `连接 ${index + 1} · ${session.status?.kind === "running" ? "已连接" : "已退出"}`), h("button", { className: "dsh-remote-ops__tiny dsh-remote-ops__dangerAction", disabled: busy, title: "释放这个具体连接", onClick: () => void releaseSession(session) }, "释放")))) : null,
        );
      };
      const renderEnvironmentGroup = ({ group, items }) => h("section", { className: "dsh-remote-ops__group", key: group },
        h("div", { className: "dsh-remote-ops__groupTitle" },
          h("span", null, "▾ ", group),
          h("button", { className: "dsh-remote-ops__tiny", onClick: () => void editGroup(group) }, "编辑"),
          h("button", { className: "dsh-remote-ops__tiny", onClick: () => { if (window.confirm(`删除空分组“${group}”？`)) void action({ action: "group.delete", group }); } }, "×"),
        ),
        items.length ? items.map(renderEnvironment) : h("div", { className: "dsh-remote-ops__muted", style: { padding: "4px" } }, "空分组"),
      );
      const environmentFormView = environmentForm ? h("form", { className: "dsh-remote-ops__form", onSubmit: saveEnvironmentForm },
        h("strong", null, environmentForm.mode === "edit" ? "编辑环境" : "新增环境"),
        h("label", null, "显示名称", h("input", { value: environmentForm.name, onChange: (event) => updateEnvironmentForm("name", event.target.value), placeholder: "生产环境" })),
        h("label", null, "主机地址", h("input", { value: environmentForm.host, onChange: (event) => updateEnvironmentForm("host", event.target.value), placeholder: "192.168.1.10" })),
        h("div", { className: "dsh-remote-ops__row" },
          h("label", { style: { flex: 1 } }, "用户名", h("input", { autoComplete: "username", value: environmentForm.username, onChange: (event) => updateEnvironmentForm("username", event.target.value), placeholder: "root" })),
          h("label", { style: { width: "72px" } }, "端口", h("input", { value: environmentForm.port, onChange: (event) => updateEnvironmentForm("port", event.target.value), inputMode: "numeric" })),
        ),
        h("label", null, "环境分组", h("input", { value: environmentForm.group, onChange: (event) => updateEnvironmentForm("group", event.target.value), placeholder: "default" })),
        h("label", null, "SSH 密码", h("input", { type: "password", autoComplete: "new-password", value: environmentForm.password, onChange: (event) => updateEnvironmentForm("password", event.target.value), placeholder: environmentForm.credentialConfigured ? "留空保持原密码" : "输入 SSH 登录密码" })),
        h("label", null, "私钥路径", h("input", { value: environmentForm.privateKeyPath, onChange: (event) => updateEnvironmentForm("privateKeyPath", event.target.value), placeholder: "可选，本机路径" })),
        h("div", { className: "dsh-remote-ops__formNote" }, `${environmentForm.credentialConfigured ? "凭据已配置；密码留空保持原密码，输入新密码会更新凭据。" : "输入 SSH 密码后由系统自动保存到 Harness credentials；凭据引用由系统管理。"} 名称留空时使用主机地址。`),
        h("div", { className: "dsh-remote-ops__formActions" },
          h("button", { type: "button", className: "dsh-remote-ops__tiny", onClick: () => setEnvironmentForm(null) }, "取消"),
          h("button", { type: "submit", className: "dsh-remote-ops__tiny", disabled: busy }, busy ? "保存中…" : "保存"),
        ),
      ) : null;
      const envDrawer = drawer ? h("aside", { className: "dsh-remote-ops__drawer" },
        h("div", { className: "dsh-remote-ops__drawerHead" },
          h("strong", null, "环境"),
          h("button", { className: "dsh-remote-ops__tiny", onClick: addGroup }, "+ 分组"),
          h("button", { className: "dsh-remote-ops__tiny", onClick: () => openEnvironmentForm() }, "+ 环境"),
          h("button", { className: "dsh-remote-ops__drawerClose", "aria-label": "关闭环境", title: "关闭环境", onClick: () => setDrawer(false) }, "×"),
        ),
        h("div", { className: "dsh-remote-ops__drawerBody" },
          environmentFormView,
          h("div", { className: "dsh-remote-ops__tools" }, h("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "搜索环境" })),
          grouped.map(renderEnvironmentGroup),
          snapshot.groups.length ? null : h("div", { className: "dsh-remote-ops__emptyList" }, "还没有分组。点击“+ 分组”开始管理。"),
        ),
      ) : null;
      const quickPanel = h(QuickCommands, { commands: snapshot.quickCommands, groups: snapshot.quickGroups, owner: sessionId, target: activeSession, frame: activeTerminalFrame, ready: terminalReady, open: quickOpen, setOpen: setQuickOpen, height: quickHeight, setHeight: setQuickHeight, action, workspaceAction, onSending: value => { quickSending.current = value; }, hidden: module === "sftp", inputPending: () => Boolean(rawInputSending.current || rawInputQueue.current.length || composingRef.current || terminalInputRef.current?.value || manualDrafts.current.get(`${sessionId ?? ""}:${activeTerminalId}:${activeTerminalFrame?.streamId}`)) });
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
      const terminal = h("section", { className: "dsh-remote-ops__terminal" },
        h("div", { className: "dsh-remote-ops__terminalHead" },
          h("div", { className: "dsh-remote-ops__terminalIdentity" }, h("strong", null, activeSession?.name ?? "终端"), h("small", { title: localActive ? activeSession.workingDirectory : activeEnvironment?.host }, localActive ? activeSession.workingDirectory : activeEnvironment ? `${activeEnvironment.username}@${activeEnvironment.host}:${activeEnvironment.port ?? 22}` : activeSession?.sessionId)),
          h("button", { className: "dsh-remote-ops__headAction dsh-remote-ops__dangerAction", disabled: !activeSession, title: "Ctrl+C · 中断前台进程", "aria-label": "中断前台进程", onClick: () => void action({ action: "signal", session: activeSession?.sessionId, signal: "SIGINT" }) }, h(IconStopFill16, { "aria-hidden": true })),
          h("button", { className: "dsh-remote-ops__headAction", "aria-expanded": drawer, title: drawer ? "收起环境" : "打开环境", "aria-label": "环境管理", onClick: () => setDrawer((value) => !value) }, h(IconPanelLeftOutline16, { "aria-hidden": true })),
        ),
        h("div", { className: "dsh-remote-ops__tabs" }, tabs.length ? tabs.map((item) => h("div", { className: "dsh-remote-ops__tab", key: item.sessionId }, h("button", { "data-active": activeSession?.sessionId === item.sessionId, onClick: () => { setActiveSessionId(item.sessionId); setSelectedEnv(item.environmentId); stickToBottom.current = true; } }, `${item.name}${item.disconnected ? " · 已断开" : ""}`), item.kind === "ssh" ? h("button", { className: "dsh-remote-ops__tabClose dsh-remote-ops__dangerAction", title: item.disconnected ? "关闭记录" : "释放此连接", "aria-label": `释放${item.name}`, disabled: busy, onClick: (event) => { event.stopPropagation(); void releaseSession(item); } }, "×") : null)) : h("span", { className: "dsh-remote-ops__muted" }, "没有活动终端")),
        h("div", { className: "dsh-remote-ops__toolbar" },
          h("button", { title: "搜索输出", "aria-label": "搜索输出", "aria-expanded": searchOpen, onClick: () => setSearchOpen(value => !value) }, h(IconSearchOutline16)),
          h("button", { title: "独立执行命令", disabled: !sessionId || !activeSession || activeSession.disconnected, onClick: () => setCommandTarget({ ...activeSession }) }, h(IconPlayOutline16), " 独立命令"),
          h("button", { title: "复制选区或当前输出", "aria-label": "复制输出", onClick: () => { const selection = window.getSelection(); const text = outputRef.current?.contains(selection?.anchorNode) ? selection.toString() : ""; void writeClipboard(text || terminalOutput).catch(cause => setError(`CLIPBOARD_WRITE: ${cause.message}`)); } }, h(IconCopyOutline16)),
          h("label", null, "字号", h("input", { type: "number", min: 11, max: 22, "aria-label": "终端字号", value: preferences.fontSize, onChange: event => setPreferences(current => terminalPreferences({ ...current, fontSize: event.target.value })) })),
          h("label", null, h("input", { type: "checkbox", checked: preferences.wrap, onChange: event => setPreferences(current => ({ ...current, wrap: event.target.checked })) }), "换行"),
          h("span", null, { manual: "人工输入中", agent: "Agent 控制", available: "输入空闲" }[inputControl.holder] ?? "输入空闲"),
          h("button", { disabled: busy || !activeSession || activeSession.disconnected, onClick: () => void workspaceAction({ action: "control", session: activeTerminalId, control: inputControl.holder === "manual" ? "release" : "takeover" }) }, inputControl.holder === "manual" ? "交还 Agent" : "人工接管"),
          inputControl.waiting ? h("button", { disabled: busy, title: "停止等待输出，不发送 Ctrl+C", onClick: () => void workspaceAction({ action: "control", session: activeTerminalId, control: "stop-wait" }) }, "停止等待") : null,
        ),
        activeSession?.disconnected ? h("div", { className: "dsh-remote-ops__toolbar", role: "status" }, h("span", null, "连接已断开 · 保留最后输出"), activeEnvironment ? h("button", { disabled: busy, onClick: () => void reconnect() }, "重新连接") : null, h("button", { onClick: () => dismissTab(activeTerminalId) }, "关闭记录")) : null,
        reviewStream === activeFrameKey ? h("div", { className: "dsh-remote-ops__toolbar", role: "status" }, "终端已重建", h("button", { onClick: () => { setReviewStream(null); terminalInputRef.current?.focus(); } }, "启用新终端输入")) : null,
        searchOpen ? h("div", { className: "dsh-remote-ops__toolbar" }, h("input", { className: "dsh-remote-ops__search", "aria-label": "搜索终端输出", value: outputSearch, onChange: event => { setOutputSearch(event.target.value); setMatchIndex(0); }, onKeyDown: event => { if (event.key === "Enter") moveMatch(event.shiftKey ? -1 : 1); } }), h("span", null, `${matches.length ? matchIndex % matches.length + 1 : 0}/${matches.length}`), h("button", { disabled: !matches.length, title: "上一处", "aria-label": "上一处匹配", onClick: () => moveMatch(-1) }, "↑"), h("button", { disabled: !matches.length, title: "下一处", "aria-label": "下一处匹配", onClick: () => moveMatch(1) }, "↓")) : null,
        activeSession ? h("div", { className: "dsh-remote-ops__screen", "data-focused": inputFocused, onClick: () => { if (!window.getSelection()?.toString()) terminalInputRef.current?.focus(); } },
          h("pre", { className: "dsh-remote-ops__output", ref: outputRef, style: { fontSize: preferences.fontSize, whiteSpace: preferences.wrap && !terminalUsesGrid(terminalScreen) ? "pre-wrap" : "pre", overflowWrap: preferences.wrap && !terminalUsesGrid(terminalScreen) ? "anywhere" : "normal" }, tabIndex: 0, "aria-label": "终端输出", onWheel: markUserScrollIntent, onPointerDown: markUserScrollIntent, onScroll: (event) => { const node = event.currentTarget; rememberScroll(node); const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48; if (userScrollIntent.current) stickToBottom.current = nearBottom; else if (nearBottom) stickToBottom.current = true; if (nearBottom) setUnreadOutput(false); } }, terminalOutputView),
          terminalInputCapture,
          unreadOutput ? h("button", { className: "dsh-remote-ops__newOutput", onClick: jumpToLatest, title: "回到最新输出" }, "↓ 新输出") : null,
        ) : h("div", { className: "dsh-remote-ops__screen dsh-remote-ops__screenEmpty", onClick: () => terminalInputRef.current?.focus() }, h("div", { className: "dsh-remote-ops__empty" }, h("div", null, h("div", { style: { fontSize: "22px", marginBottom: "8px" } }, "›_"), h("div", null, terminalReady ? "输入 ssh [user@]host 并按 Enter 连接，或从环境抽屉选择环境。" : "等待本地 CMD 启动…"), pendingSshInput ? h("pre", { className: "dsh-remote-ops__pendingCommand" }, pendingSshInput) : null)), terminalInputCapture, h("div", { className: "dsh-remote-ops__screenHint" }, terminalReady ? "输入 SSH 命令 · Enter 连接" : "等待本地 CMD 启动…")),
        h("div", { className: "dsh-remote-ops__terminalStatus", role: "status" },
          h("span", { "data-state": outputConnection }, activeSession ? activeSession.disconnected ? "已断开" : outputConnection === "connected" ? "实时输出" : outputConnection === "retrying" ? "输出重连中" : "同步中" : "未连接"),
          h("span", { title: "Agent 绑定状态，不代表 Agent 已读取当前输出" }, snapshot.bound ? "Agent 已绑定" : "Agent 未绑定"),
          h("span", { title: activeTerminalFrame?.toolReceipt ? JSON.stringify(activeTerminalFrame.toolReceipt) : "尚未产生此输出流的工具读取回执" }, activeTerminalFrame?.toolReceipt ? "工具已返回 · " + new Date(activeTerminalFrame.toolReceipt.at).toLocaleTimeString() + (activeTerminalFrame.toolReceipt.newOutput ? " · 有新输出" : "") : "工具未读取"),
          h("span", { className: "dsh-remote-ops__sessionIdentity", title: activeTerminalId }, activeTerminalId ? `${localActive ? "本地" : "SSH"} · ${activeTerminalId.slice(-12)}` : ""),
          activityLabel ? h("span", { title: "PTY 存活与命令完成是不同状态" }, activityLabel) : null,
          activeTerminalFrame?.truncated ? h("span", { title: "历史已截断或输出流已重建" }, "历史已重置") : null,
        ),
      );
      const sftpWorkspace = module === "sftp" ? h(SftpWorkspace, { key: sessionId, sessionId, environments: snapshot.environments, initialEnvironment: activeEnvironment?.id, onError: setError, onClose: () => setModule("terminal") }) : null;
      const aux = module === "diagnostics" ? h("aside", { className: "dsh-remote-ops__aux" }, h("div", { className: "dsh-remote-ops__drawerHead" }, h("strong", null, "诊断"), h("button", { disabled: busy, onClick: async () => { const report = await workspaceAction({ action: "diagnostics" }); if (report) setDiagnosticPreview(JSON.stringify(report, null, 2)); } }, "预览导出"), h("button", { className: "dsh-remote-ops__drawerClose", title: "关闭诊断", "aria-label": "关闭诊断", onClick: () => setModule("terminal") }, "×")), h("pre", { className: "dsh-remote-ops__auxBody", style: { whiteSpace: "pre-wrap" } }, (snapshot.events ?? []).map((item) => JSON.stringify(item)).join("\n") || "暂无事件")) : null;
      const modal = (title, close, content) => h("div", { className: "dsh-remote-ops__modalBackdrop", onKeyDown: event => { if (event.key === "Escape") { event.stopPropagation(); close(); } } }, h("section", { className: "dsh-remote-ops__modal", role: "dialog", "aria-modal": true, "aria-label": title }, h("div", { className: "dsh-remote-ops__row" }, h("span", null, title), h("button", { className: "dsh-remote-ops__drawerClose", title: `关闭${title}`, "aria-label": `关闭${title}`, onClick: close }, "×")), content));
      const pasteView = pasteDraft ? modal("确认终端输入", () => setPasteDraft(null), h(React.Fragment, null, h("strong", null, `目标：${pasteDraft.name}`), h("small", null, pasteDraft.session), h("textarea", { autoFocus: true, "aria-label": "待发送内容", spellCheck: false, value: pasteDraft.text, onChange: event => setPasteDraft(current => ({ ...current, text: event.target.value })) }), /[\r\n]/.test(pasteDraft.text) ? h("strong", { className: "dsh-remote-ops__dangerAction" }, "包含换行，将提交命令") : null, h("div", { className: "dsh-remote-ops__formActions" }, h("button", { onClick: () => setPasteDraft(null) }, "取消"), h("button", { disabled: busy || !pasteDraft.text, onClick: () => void submitPaste() }, "发送到此终端")))) : null;
      const choicesView = connectionChoices ? modal("选择连接", () => setConnectionChoices(null), connectionChoices.map(item => h("button", { key: item.sessionId, onClick: () => { setActiveSessionId(item.sessionId); setConnectionChoices(null); setDrawer(false); } }, `${item.name} · ${item.ownerId} · ${item.lastActivity ? new Date(item.lastActivity).toLocaleTimeString() : "暂无活动"}`))) : null;
      const diagnosticsView = diagnosticPreview !== null ? modal("诊断导出预览", () => setDiagnosticPreview(null), h(React.Fragment, null, h("pre", null, diagnosticPreview), h("button", { onClick: () => { const url = URL.createObjectURL(new Blob([diagnosticPreview], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "remote-ops-diagnostics.json"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } }, h(IconDownloadOutline16), " 导出 JSON"))) : null;
      return h("div", { className: "dsh-remote-ops" },
        h("div", { className: "dsh-remote-ops__head" },
          h("strong", null, "Remote Ops"), h("span", { className: "dsh-remote-ops__version" }, `v${snapshot.pluginVersion ?? update.currentVersion ?? "?"}`),
          h("button", { className: `dsh-remote-ops__headAction${update.updateAvailable ? " dsh-remote-ops__update" : ""}`, disabled: updateBusy, "aria-busy": updateBusy, "aria-label": update.updateAvailable ? `升级 v${update.latestVersion}` : "检查更新", title: update.updateAvailable ? `升级 v${update.latestVersion}` : "检查更新", onClick: () => void (update.updateAvailable ? installUpdate() : checkUpdate(false)) }, h(IconDownloadOutline16, { "aria-hidden": true })),
          h("button", { className: "dsh-remote-ops__headAction", disabled: refreshBusy, "aria-busy": refreshBusy, "aria-label": "刷新状态", title: "刷新状态", onClick: () => void refreshNow() }, h(IconRefreshOutline16, { "aria-hidden": true })),
          actionNotice ? h("span", { className: "dsh-remote-ops__headNotice", "data-error": actionNotice.includes("失败") }, actionNotice) : null),
        error ? h("div", { className: "dsh-remote-ops__error", role: "alert" }, h("div", { className: "dsh-remote-ops__errorBody" }, error.split("\n")[0], h("details", null, h("summary", null, "错误详情"), error), /AUTH|credential|password|认证/i.test(error) ? h("button", { onClick: () => { setDrawer(true); if (activeEnvironment) openEnvironmentForm(activeEnvironment); } }, "检查环境凭据") : /CONTROL|ACTIVE/.test(error) ? h("button", { onClick: () => void workspaceAction({ action: "control", session: activeTerminalId, control: "takeover" }) }, "人工接管") : /OWNER|SESSION_REQUIRED/.test(error) ? h("button", { disabled: !sessionId, onClick: () => void workspaceAction({ action: "activate" }) }, "绑定当前会话") : h("button", { onClick: () => void refreshNow() }, "刷新状态")), h("button", { className: "dsh-remote-ops__errorClose", title: "关闭错误", "aria-label": "关闭错误", onClick: () => setError("") }, "×")) : null,
        pasteView, choicesView, diagnosticsView,
        commandTarget ? h(CommandDialog, { key: sessionId, sessionId, target: commandTarget, onClose: () => setCommandTarget(null) }) : null,
        h("div", { className: "dsh-remote-ops__workspace" }, h("nav", { className: "dsh-remote-ops__rail", "aria-label": "Remote Ops 导航" }, [["environments", "环境"], ["quick", "快捷命令"], ["sftp", "SFTP"], ["diagnostics", "诊断"]].map(([id, label]) => h("button", { key: id, "data-active": id === "environments" ? drawer : id === "quick" ? quickOpen : module === id, title: label, "aria-label": label, onClick: () => id === "environments" ? (setDrawer((value) => !value), setModule("terminal")) : id === "quick" ? (setDrawer(false), setModule("terminal"), setQuickOpen((value) => !value)) : (setDrawer(false), setModule((value) => value === id ? "terminal" : id)) }, glyph[id]))), h("main", { className: "dsh-remote-ops__main", "data-module": module }, module === "sftp" ? sftpWorkspace : terminal, quickPanel), envDrawer, aux));
    }
    function RemoteOpsTitle() { return h("span", null, "Remote Ops"); }
    function RemoteOpsLaunch({ wide, onClick, label }) { return h("button", { type: "button", className: "dsh-remote-ops__launchControl", title: label, "aria-label": label, onClick }, h("span", { className: "dsh-remote-ops__launchControlIcon", "aria-hidden": true }, "⌁"), wide ? h("span", { className: "dsh-remote-ops__launchLabel" }, label) : null); }
    const inject = ["slots", "locale"];
    function apply(ctx) {
      let grouped = false;
      const listeners = new Set();
      const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
      ctx.inject(["pluginNavigation"], (ready) => {
        ready.effect(() => {
          grouped = true;
          listeners.forEach(fn => fn());
          return () => { grouped = false; listeners.forEach(fn => fn()); };
        }, "dsh-remote-ops: shared navigation availability");
      });
      function OptionalLaunch(props) {
        const managed = useSyncExternalStore(subscribe, () => grouped);
        return managed ? null : h(RemoteOpsLaunch, props);
      }
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh: { title: "Remote Ops", guideTitle: "远程运维", guideDescription: "管理 SSH 环境、终端和 SFTP" }, en: { title: "Remote Ops", guideTitle: "Remote operations", guideDescription: "Manage SSH environments, terminals and SFTP" } }), "dsh-remote-ops: dictionaries");
      const getService = (context, service) => typeof context.get === "function" ? context.get(service) : context[service];
      const showLauncherError = (message) => { console.warn(`[dsh-remote-ops] ${message}`); if (typeof document === "undefined") return; let node = document.getElementById("dsh-remote-ops-launch-error"); if (!node) { node = document.createElement("div"); node.id = "dsh-remote-ops-launch-error"; node.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:99999;display:flex;align-items:flex-start;gap:10px;max-width:420px;padding:12px 12px 12px 14px;border:1px solid rgba(217,45,32,.45);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-state-error-primary,#d92d20);box-shadow:0 8px 28px rgba(16,24,40,.18);font:13px/1.45 system-ui,sans-serif"; const text = document.createElement("div"); text.dataset.role = "message"; text.style.cssText = "flex:1;white-space:pre-wrap;overflow-wrap:anywhere"; const close = document.createElement("button"); close.type = "button"; close.textContent = "×"; close.title = "关闭错误"; close.setAttribute("aria-label", "关闭错误"); close.style.cssText = "border:0;background:transparent;color:inherit;font-size:18px;line-height:1;cursor:pointer;padding:0 2px"; close.addEventListener("click", () => { node.hidden = true; }); node.append(text, close); document.body.appendChild(node); } const text = node.querySelector("[data-role=message]"); if (text) text.textContent = message; node.hidden = false; };
      let launcherTimer;
      const openRemoteOps = () => {
        if (launcherTimer) window.clearInterval(launcherTimer);
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
          if (tryOpen() || attempts >= 40) {
            window.clearInterval(launcherTimer);
            launcherTimer = undefined;
            if (attempts >= 40) showLauncherError("无法打开 Remote Ops：" + lastError + "。请确认当前运行的是 DSH Web profile，并重启 DSH 让插件重新加载。");
          }
        }, 250);
      };
      ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-remote-ops-launch", order: 40, label: () => t("title") }, (props) => h(OptionalLaunch, { ...props, onClick: openRemoteOps, label: t("title") }))), "dsh-remote-ops: launch button");
      ctx.inject(["sidebarRight", "sidebarRightTabs"], (ready) => {
        const sidebarRight = getService(ready, "sidebarRight");
        const sidebarRightTabs = getService(ready, "sidebarRightTabs");
        if (!sidebarRight || !sidebarRightTabs) return;
        ready.effect(() => sidebarRightTabs.register({ id: TAB_ID, kind: TAB_KIND, priority: "extension", title: () => t("title"), guide: [{ order: 40, title: () => t("guideTitle"), description: () => t("guideDescription"), icon: IconPanelLeftOutline16 }] }), "dsh-remote-ops: tab type");
        ready.effect(() => ready.slots.inject("sidebar.right.pane.tab", () => ready.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID }, RemoteOpsPanel)), "dsh-remote-ops: tab body");
        ready.effect(() => ready.slots.inject("sidebar.right.pane.tab.title", () => ready.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB_ID }, RemoteOpsTitle)), "dsh-remote-ops: tab title");
      });
    }
    return { inject, apply };
  },
});
