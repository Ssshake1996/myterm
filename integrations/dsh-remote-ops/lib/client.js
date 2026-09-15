window.__ModuleLoader__.load({
  id: "@dsh/remote-ops",
  factory: (require) => {
    const React = require("react");
    const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React;
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
    async function request(path, init) { const response = await fetch(path, init); const text = await response.text(); let value = {}; try { value = text ? JSON.parse(text) : {}; } catch { throw new Error(`HTTP ${response.status}: ${text}`); } if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`); return value; }
    const empty = { groups: [], environments: [], quickGroups: [], quickCommands: [], sessions: [], events: [], bound: false, pluginName: "dsh-remote-ops", pluginVersion: "0.2.13", update: { currentVersion: "0.2.13", latestVersion: "0.2.13", updateAvailable: false } };
    const glyph = { environments: "▦", quick: "⌘", sftp: "⇄", diagnostics: "⌁" };
    const slug = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || `item-${Date.now()}`;
    const terminalScreenModel = (value, rows = 40, columns = 160) => {
      const source = String(value ?? "");
      const screen = Array.from({ length: rows }, () => []);
      const scrollback = [];
      let row = 0;
      let column = 0;
      let savedRow = 0;
      let savedColumn = 0;
      const lineText = (line) => line.join("").replace(/\s+$/g, "");
      const fillTo = (line, target) => { while (line.length < target) line.push(" "); };
      const lineFeed = () => {
        row += 1;
        if (row < rows) return;
        scrollback.push(lineText(screen.shift()));
        screen.push([]);
        row = rows - 1;
      };
      const put = (character) => {
        if (column >= columns) { column = 0; lineFeed(); }
        const line = screen[row];
        fillTo(line, column);
        line[column] = character;
        column += 1;
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
        if (final === "H" || final === "f") { row = Math.max(0, Math.min(rows - 1, (values[0] || 1) - 1)); column = Math.max(0, Math.min(columns - 1, (values[1] || 1) - 1)); }
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
      while (firstLine < allLines.length - 1 && allLines[firstLine] === "") firstLine += 1;
      let lastLine = Math.max(cursorLine, 0);
      while (lastLine < allLines.length - 1 && allLines[lastLine + 1] !== undefined) lastLine += 1;
      while (lastLine > firstLine && allLines[lastLine] === "" && lastLine !== cursorLine) lastLine -= 1;
      const lines = allLines.slice(firstLine, lastLine + 1);
      while (lines.length && lines[lines.length - 1] === "" && lines.length - 1 !== cursorLine - firstLine) lines.pop();
      while (lines.length && lines[0] === "" && cursorLine - firstLine > 0) { lines.shift(); firstLine += 1; }
      if (!lines.length) lines.push("");
      const visibleCursorRow = Math.max(0, cursorLine - firstLine);
      const text = lines.map((line) => line.replace(/\s+$/g, "")).join("\n");
      return { text, cursor: { row: visibleCursorRow, column: Math.max(0, Math.min(columns, column)) } };
    };
    const terminalVisibleText = (value, rows = 40, columns = 160) => terminalScreenModel(value, rows, columns).text;
    const ask = (label, value = "") => { const result = window.prompt(label, value); return result === null ? undefined : result.trim(); };
    const parseSshCommand = (value) => { const text = String(value ?? "").trim(); if (!/^ssh(?:\s|$)/i.test(text)) return undefined; const tokens = text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.slice(1).map((item) => item.replace(/^("|')|("|')$/g, "")) ?? []; let hostToken = ""; let username = ""; let port = 22; let privateKeyPath = ""; const takesValue = new Set(["-p", "-i", "-l", "-F", "-J", "-o", "-b", "-D", "-L", "-R", "-W", "-S", "-B", "-c", "-m", "-w"]); for (let index = 0; index < tokens.length; index += 1) { const token = tokens[index]; if (token === "--") { hostToken = tokens[index + 1] ?? ""; break; } if (token === "-p") { port = Number(tokens[++index]); continue; } if (token.startsWith("-p") && token.length > 2) { port = Number(token.slice(2)); continue; } if (token === "-i") { privateKeyPath = tokens[++index] ?? ""; continue; } if (token.startsWith("-i") && token.length > 2) { privateKeyPath = token.slice(2); continue; } if (token === "-l") { username = tokens[++index] ?? ""; continue; } if (token.startsWith("-l") && token.length > 2) { username = token.slice(2); continue; } if (token.startsWith("-")) { if (takesValue.has(token)) index += 1; continue; } if (!hostToken) hostToken = token; } if (!hostToken) return { error: "SSH 命令缺少主机地址，请使用 ssh [user@]host。" }; const at = hostToken.lastIndexOf("@"); if (at >= 0) { username = hostToken.slice(0, at) || username; hostToken = hostToken.slice(at + 1); } const host = hostToken.replace(/^\[|\]$/g, ""); if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return { error: "SSH 命令中的主机或端口无效。" }; return { host, username, port, privateKeyPath }; };

    const terminalInputEnabled = (snapshot) => Boolean(snapshot?.bound || snapshot?.sessions?.some((item) => item.kind === "local" && item.status?.kind === "running"));
    const terminalInputCompositionValue = (value, composing) => composing ? undefined : String(value ?? "");
    function RemoteOpsPanel({ sessionId }) {
      const composingRef = useRef(false);
      const [snapshot, setSnapshot] = useState(empty); const [terminalFrames, setTerminalFrames] = useState({}); const [drawer, setDrawer] = useState(false); const [module, setModule] = useState("terminal"); const [quickOpen, setQuickOpen] = useState(true); const [environmentForm, setEnvironmentForm] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [actionNotice, setActionNotice] = useState(""); const [update, setUpdate] = useState(empty.update); const [updateBusy, setUpdateBusy] = useState(false); const [refreshBusy, setRefreshBusy] = useState(false); const [selectedEnv, setSelectedEnv] = useState(""); const [activeSessionId, setActiveSessionId] = useState(""); const [terminalInput, setTerminalInput] = useState(""); const [pendingSshInput, setPendingSshInput] = useState(""); const [quickGroup, setQuickGroup] = useState(""); const [quickHeight, setQuickHeight] = useState(190); const [search, setSearch] = useState(""); const [sftpPath, setSftpPath] = useState("."); const [entries, setEntries] = useState([]); const outputRef = useRef(null); const terminalInputRef = useRef(null); const stickToBottom = useRef(true); const userScrollIntent = useRef(false); const scrollIntentTimer = useRef(); const quickRef = useRef(null); const rawInputQueue = useRef(""); const rawInputTimer = useRef(); const rawInputSending = useRef(false); const pendingSshInputRef = useRef(""); const refreshRequest = useRef(); const snapshotSignature = useRef(""); const terminalFramesRef = useRef({});
      const refresh = useCallback(() => {
        if (refreshRequest.current) return refreshRequest.current;
        const task = (async () => {
          try {
            const value = await request(`/api/dsh-remote-ops/state${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`);
            const signature = JSON.stringify(value);
            if (signature !== snapshotSignature.current) {
              snapshotSignature.current = signature;
              setSnapshot(value);
              if (value.update) setUpdate(value.update);
            }
            return true;
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            return false;
          }
        })();
        refreshRequest.current = task;
        void task.finally(() => { if (refreshRequest.current === task) refreshRequest.current = undefined; });
        return task;
      }, [sessionId]);
      useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [refresh]);
      const checkUpdate = useCallback(async (silent = false) => { setUpdateBusy(true); if (!silent) setActionNotice(""); try { const value = await request("/api/dsh-remote-ops/update"); setUpdate(value); setError(""); if (!silent) setActionNotice(value.updateAvailable ? `发现新版本 v${value.latestVersion}` : `已是最新版本 v${value.currentVersion}`); return value; } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); if (!silent) setActionNotice("检查更新失败"); return undefined; } finally { setUpdateBusy(false); } }, []);
      useEffect(() => { void checkUpdate(true); }, [checkUpdate]);
      const refreshNow = useCallback(async () => { if (refreshBusy) return; setRefreshBusy(true); setActionNotice(""); const ok = await refresh(); setActionNotice(ok ? "已刷新" : "刷新失败"); setRefreshBusy(false); }, [refresh, refreshBusy]); const startQuickResize = (event) => { event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); const startY = event.clientY; const startHeight = quickHeight ?? quickRef.current?.getBoundingClientRect().height ?? 190; const minHeight = 92; const maxHeight = Math.min(360, Math.max(180, Math.floor(window.innerHeight * 0.5))); const move = (moveEvent) => setQuickHeight(Math.max(minHeight, Math.min(maxHeight, startHeight + startY - moveEvent.clientY))); const stop = () => { window.removeEventListener("pointermove", move); document.body.style.cursor = ""; document.body.style.userSelect = ""; }; document.body.style.cursor = "ns-resize"; document.body.style.userSelect = "none"; window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop, { once: true }); };       useEffect(() => { if (!selectedEnv && snapshot.environments[0]) setSelectedEnv(snapshot.environments[0].id); if (!quickGroup && snapshot.quickGroups[0]) setQuickGroup(snapshot.quickGroups[0]); if (activeSessionId && !snapshot.sessions.some((item) => item.sessionId === activeSessionId)) setActiveSessionId(""); if (!activeSessionId && snapshot.sessions.length) setActiveSessionId((snapshot.sessions.find((item) => item.kind !== "local") ?? snapshot.sessions[0]).sessionId); }, [activeSessionId, quickGroup, selectedEnv, snapshot]);
      useEffect(() => { if (module === "quick") quickRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [module]);
      const action = useCallback(async (body) => { setBusy(true); try { const value = await request("/api/dsh-remote-ops/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sessionId ? { ...body, sessionId } : body) }); setError(""); await refresh(); return value; } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return undefined; } finally { setBusy(false); } }, [refresh, sessionId]);
      const installUpdate = async () => { if (!update.updateAvailable || updateBusy) return; if (!window.confirm(`安装 Remote Ops v${update.latestVersion}？安装完成后需要重启 DSH。`)) return; setUpdateBusy(true); setActionNotice(""); try { const value = await request("/api/dsh-remote-ops/update", { method: "POST" }); setUpdate(value); setError(""); setActionNotice(`已安装 v${value.currentVersion ?? update.latestVersion}，请重启 DSH`); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setActionNotice("升级失败"); } finally { setUpdateBusy(false); } };
      const activeSession = snapshot.sessions.find((item) => item.sessionId === activeSessionId) ?? snapshot.sessions[0]; const activeEnvironment = snapshot.environments.find((item) => item.id === (activeSession?.environmentId ?? selectedEnv)); const localActive = activeSession?.kind === "local"; const terminalReady = terminalInputEnabled(snapshot);
      const activeTerminalId = activeSession?.sessionId ?? "";
      const activeTerminalFrame = activeTerminalId ? terminalFrames[activeTerminalId] : undefined;
      const terminalScreen = useMemo(() => terminalScreenModel(activeTerminalFrame?.raw ?? ""), [activeTerminalFrame?.raw]);
      const terminalOutput = terminalScreen.text;
      const terminalOutputView = terminalOutput ? terminalOutput.split("\n").map((line, index, lines) => {
        if (index !== terminalScreen.cursor.row) return h("span", { key: `line-${index}` }, line, index < lines.length - 1 ? "\n" : null);
        const before = line.slice(0, terminalScreen.cursor.column).padEnd(terminalScreen.cursor.column, " ");
        return h("span", { key: `line-${index}` }, before, h("span", { className: "dsh-remote-ops__inputCursor", "aria-hidden": true }), line.slice(terminalScreen.cursor.column), index < lines.length - 1 ? "\n" : null);
      }) : "等待终端输出…";
      useEffect(() => { if (!terminalReady) return undefined; const frame = window.requestAnimationFrame(() => terminalInputRef.current?.focus()); return () => window.cancelAnimationFrame(frame); }, [activeTerminalId, terminalReady]);
      useEffect(() => {
        if (!activeTerminalId) return undefined;
        let cancelled = false;
        let controller;
        const poll = async () => {
          while (!cancelled) {
            const previous = terminalFramesRef.current[activeTerminalId];
            const params = new URLSearchParams({ session: activeTerminalId, waitMs: document.hidden ? "25000" : "20000" });
            if (sessionId) params.set("sessionId", sessionId);
            if (Number.isSafeInteger(previous?.nextOffset)) params.set("offset", String(previous.nextOffset));
            controller = new AbortController();
            try {
              const value = await request(`/api/dsh-remote-ops/terminal?${params}`, { signal: controller.signal });
              if (cancelled) break;
              const changed = value.reset || Boolean(value.text) || previous?.status?.kind !== value.status?.kind;
              if (changed || !previous) {
                const currentFrame = terminalFramesRef.current[activeTerminalId];
                const raw = (value.reset ? String(value.text ?? "") : `${currentFrame?.raw ?? ""}${value.text ?? ""}`).slice(-(256 * 1024));
                const next = { raw, nextOffset: value.nextOffset, revision: value.revision, status: value.status };
                const frames = { ...terminalFramesRef.current, [activeTerminalId]: next };
                terminalFramesRef.current = frames;
                setTerminalFrames(frames);
              }
              if (value.status?.kind === "exited") void refresh();
            } catch (cause) {
              if (cancelled || cause?.name === "AbortError") break;
              setError(cause instanceof Error ? cause.message : String(cause));
              void refresh();
              await new Promise((resolve) => window.setTimeout(resolve, 600));
            }
            controller = undefined;
          }
        };
        void poll();
        return () => { cancelled = true; controller?.abort(); };
      }, [activeTerminalId, refresh, sessionId]);
      useEffect(() => {
        if (!stickToBottom.current) return undefined;
        const frame = window.requestAnimationFrame(() => { const node = outputRef.current; if (node) node.scrollTop = node.scrollHeight; });
        return () => window.cancelAnimationFrame(frame);
      }, [activeTerminalId, terminalOutput]);
      const grouped = snapshot.groups.map((group) => ({ group, items: snapshot.environments.filter((item) => item.group === group && (!search || `${item.name} ${item.host} ${item.group}`.toLowerCase().includes(search.toLowerCase()))) })); const quickItems = snapshot.quickCommands.filter((item) => !quickGroup || item.group === quickGroup);
      const connect = async (env) => { if (!snapshot.bound) { setError("当前对话尚未初始化 Harness Agent，请先发送一条 DSH 消息。"); return; } setSelectedEnv(env.id); const value = await action({ action: "open", environment: env.id }); if (value?.sessionId) setActiveSessionId(value.sessionId); };
      const send = async (text) => { if (!terminalReady) { setError("本地终端尚未就绪；连接 SSH 环境前请先等待本地 CMD 启动。"); return; } let target = activeSession?.sessionId; if (!target && selectedEnv && snapshot.bound) { const opened = await action({ action: "open", environment: selectedEnv }); target = opened?.sessionId; if (target) setActiveSessionId(target); } if (!target) { setError("当前没有可用终端。"); return; } await action({ action: "send", session: target, text, submit: true }); };
      const openFromSshCommand = useCallback(async (command) => { const parsed = parseSshCommand(command); if (!parsed) { setError("当前没有活动 SSH 会话，请输入 ssh [user@]host 并按 Enter 连接。"); return; } if (parsed.error) { setError(parsed.error); return; } const saved = snapshot.environments.find((item) => item.host === parsed.host && Number(item.port ?? 22) === parsed.port && (!parsed.username || item.username === parsed.username)); if (!saved && !parsed.username) { setError("SSH 命令未指定用户名，且目标环境未保存；请使用 ssh user@host。 "); return; } const value = saved ? await action({ action: "open", environment: saved.id }) : await action({ action: "open-command", environment: parsed }); if (value?.sessionId) { setActiveSessionId(value.sessionId); setSelectedEnv(saved?.id ?? ""); pendingSshInputRef.current = ""; setPendingSshInput(""); } }, [action, snapshot.environments]);
      const flushRawInput = useCallback(async () => {
        if (rawInputSending.current) return;
        rawInputSending.current = true;
        try {
          while (rawInputQueue.current) {
            const target = activeSessionId || snapshot.sessions[0]?.sessionId;
            const text = rawInputQueue.current;
            rawInputQueue.current = "";
            const localReady = snapshot.sessions.some((item) => item.kind === "local" && item.status?.kind === "running");
            if (!snapshot.bound && !localReady) { setError(snapshot.localError || "本地终端尚未就绪，请稍后重试。"); break; }
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
              await request("/api/dsh-remote-ops/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sessionId ? { action: "input", sessionId, session: target, text } : { action: "input", session: target, text }) });
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
              break;
            }
          }
        } finally {
          rawInputSending.current = false;
        }
      }, [activeSessionId, openFromSshCommand, sessionId, snapshot.bound, snapshot.localError, snapshot.sessions]);
      const queueRawInput = useCallback((text) => { if (!text) return; rawInputQueue.current += text; if (rawInputTimer.current || rawInputSending.current) return; rawInputTimer.current = window.setTimeout(() => { rawInputTimer.current = undefined; void flushRawInput(); }, 20); }, [flushRawInput]);
      useEffect(() => () => { if (rawInputTimer.current) window.clearTimeout(rawInputTimer.current); if (scrollIntentTimer.current) window.clearTimeout(scrollIntentTimer.current); rawInputQueue.current = ""; }, []);
      const keySequence = (event) => { if (event.ctrlKey && !event.altKey && !event.metaKey) { const key = event.key.toLowerCase(); if (key.length === 1 && key >= "a" && key <= "z") return String.fromCharCode(key.charCodeAt(0) - 96); if (key === "[") return "\u001b"; if (key === "\\") return "\u001c"; if (key === "]") return "\u001d"; if (key === "^") return "\u001e"; if (key === "_") return "\u001f"; if (key === " ") return "\u0000"; } if (event.key === "Tab") return event.shiftKey ? "\u001b[Z" : "\t"; const sequences = { Enter: "\r", Escape: "\u001b", Backspace: "\u007f", Delete: "\u001b[3~", ArrowUp: "\u001b[A", ArrowDown: "\u001b[B", ArrowRight: "\u001b[C", ArrowLeft: "\u001b[D", Home: "\u001b[H", End: "\u001b[F", PageUp: "\u001b[5~", PageDown: "\u001b[6~", Insert: "\u001b[2~" }; return sequences[event.key]; };
      const addGroup = async () => { const name = ask("环境分组名称"); if (name) await action({ action: "group.create", name }); };
      const editGroup = async (group) => { const name = ask("新的环境分组名称", group); if (name && name !== group) await action({ action: "group.rename", group, name }); };
      const openEnvironmentForm = (initial) => setEnvironmentForm({ mode: initial ? "edit" : "create", id: initial?.id ?? "", name: initial?.name ?? "", host: initial?.host ?? "", username: initial?.username ?? "root", group: initial?.group ?? snapshot.groups[0] ?? "default", port: String(initial?.port ?? 22), passwordRef: initial?.passwordRef === "configured" ? "" : initial?.passwordRef ?? "", password: "", privateKeyPath: initial?.privateKeyPath ?? "", credentialConfigured: initial?.passwordRef === "configured" });
      const updateEnvironmentForm = (field, value) => setEnvironmentForm((current) => current ? { ...current, [field]: value } : current);
      const saveEnvironmentForm = async (event) => { event.preventDefault(); if (!environmentForm) return; const required = [["环境 ID", environmentForm.id], ["环境名称", environmentForm.name], ["主机地址", environmentForm.host], ["用户名", environmentForm.username]]; const missing = required.find(([, value]) => !String(value ?? "").trim()); if (missing) { setError(`${missing[0]}不能为空`); return; } const port = Number(environmentForm.port); if (!Number.isInteger(port) || port < 1 || port > 65535) { setError("SSH 端口必须是 1-65535 的整数"); return; } const environment = { id: environmentForm.id.trim(), name: environmentForm.name.trim(), host: environmentForm.host.trim(), username: environmentForm.username.trim(), group: environmentForm.group.trim() || "default", port }; if (environmentForm.privateKeyPath.trim()) environment.privateKeyPath = environmentForm.privateKeyPath.trim(); const body = { action: "environment.save", environment }; if (environmentForm.password) body.password = environmentForm.password; const value = await action(body); if (value) setEnvironmentForm(null); };
      const addQuickGroup = async () => { const name = ask("快捷命令分组名称"); if (name) await action({ action: "quick-group.create", name }); };
      const editQuickGroup = async (group) => { const name = ask("新的快捷命令分组名称", group); if (name && name !== group) await action({ action: "quick-group.rename", group, name }); };
      const addQuick = async (initial) => { const name = ask("命令标题", initial?.name ?? ""); if (!name) return; const group = ask(`快捷命令分组（可选：${snapshot.quickGroups.join(", ")}）`, initial?.group ?? snapshot.quickGroups[0] ?? "default") || "default"; const command = window.prompt("命令内容（支持多行）", initial?.command ?? ""); if (command === null || !command.trim()) return; const id = initial?.id ?? slug(name); await action({ action: "quick.save", command: { id, name, group, command } }); };
      const renderEnvironment = (env) => h("div", { className: "dsh-remote-ops__env", key: env.id },
        h("span", { className: "dsh-remote-ops__dot", "data-connected": env.active }),
        h("div", { className: "dsh-remote-ops__envInfo", onClick: () => setSelectedEnv(env.id), onDoubleClick: () => void connect(env) },
          h("div", { className: "dsh-remote-ops__envName" }, env.name),
          h("div", { className: "dsh-remote-ops__envMeta" }, `${env.username}@${env.host}:${env.port ?? 22}`),
        ),
        h("button", { className: "dsh-remote-ops__tiny", disabled: busy || !snapshot.bound, onClick: () => void connect(env) }, env.active ? "切换" : "连接"),
        h("button", { className: "dsh-remote-ops__tiny", onClick: () => openEnvironmentForm(env) }, "编辑"),
        h("button", { className: "dsh-remote-ops__tiny", onClick: () => { if (window.confirm(`删除环境“${env.name}”？`)) void action({ action: "environment.delete", environment: env.id }); } }, "×"),
      );
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
        h("label", null, "环境 ID", h("input", { value: environmentForm.id, disabled: environmentForm.mode === "edit", onChange: (event) => updateEnvironmentForm("id", event.target.value), placeholder: "例如 prod-east" })),
        h("label", null, "显示名称", h("input", { value: environmentForm.name, onChange: (event) => updateEnvironmentForm("name", event.target.value), placeholder: "生产环境" })),
        h("label", null, "主机地址", h("input", { value: environmentForm.host, onChange: (event) => updateEnvironmentForm("host", event.target.value), placeholder: "192.168.1.10" })),
        h("div", { className: "dsh-remote-ops__row" },
          h("label", { style: { flex: 1 } }, "用户名", h("input", { autoComplete: "username", value: environmentForm.username, onChange: (event) => updateEnvironmentForm("username", event.target.value), placeholder: "root" })),
          h("label", { style: { width: "72px" } }, "端口", h("input", { value: environmentForm.port, onChange: (event) => updateEnvironmentForm("port", event.target.value), inputMode: "numeric" })),
        ),
        h("label", null, "环境分组", h("input", { value: environmentForm.group, onChange: (event) => updateEnvironmentForm("group", event.target.value), placeholder: "default" })),
        h("label", null, "SSH 密码", h("input", { type: "password", autoComplete: "new-password", value: environmentForm.password, onChange: (event) => updateEnvironmentForm("password", event.target.value), placeholder: environmentForm.credentialConfigured ? "留空保持原密码" : "输入 SSH 登录密码" })),
        h("label", null, "私钥路径", h("input", { value: environmentForm.privateKeyPath, onChange: (event) => updateEnvironmentForm("privateKeyPath", event.target.value), placeholder: "可选，本机路径" })),
        h("div", { className: "dsh-remote-ops__formNote" }, environmentForm.credentialConfigured ? "凭据已配置；密码留空保持原密码，输入新密码会更新凭据。" : "输入 SSH 密码后由系统自动保存到 Harness credentials；凭据引用由系统管理。"),
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
      const quickPanel = quickOpen ? h("div", { className: "dsh-remote-ops__quickDock", style: { height: `${quickHeight}px` } }, h("div", { className: "dsh-remote-ops__quickResize", role: "separator", "aria-label": "调整快捷命令区域高度", title: "拖动调整快捷命令区域高度；双击恢复默认高度", onPointerDown: startQuickResize, onDoubleClick: () => setQuickHeight(190) }), h("section", { className: "dsh-remote-ops__quick", ref: quickRef },
        h("div", { className: "dsh-remote-ops__quickHead" },
          h("strong", null, "快捷命令"),
          h("span", { className: "dsh-remote-ops__muted" }, `${quickItems.length} 条`),
          h("button", { className: "dsh-remote-ops__tiny", onClick: addQuickGroup }, "+ 分组"),
          h("button", { className: "dsh-remote-ops__tiny", disabled: !snapshot.quickGroups.length, onClick: () => void addQuick() }, "+ 命令"),
          h("button", { className: "dsh-remote-ops__tiny", onClick: () => setQuickOpen(false), title: "收起快捷命令栏" }, "收起"),
        ),
        h("div", { className: "dsh-remote-ops__quickBody" },
          h("div", { className: "dsh-remote-ops__quickGroups" },
            snapshot.quickGroups.map((group) => h("button", { key: group, "data-active": quickGroup === group, onClick: () => setQuickGroup(group), title: group }, group)),
            quickGroup ? h("div", { className: "dsh-remote-ops__row" },
              h("button", { className: "dsh-remote-ops__tiny", onClick: () => void editQuickGroup(quickGroup) }, "编辑"),
              h("button", { className: "dsh-remote-ops__tiny", onClick: () => { if (window.confirm(`删除快捷命令分组“${quickGroup}”？`)) void action({ action: "quick-group.delete", group: quickGroup }); } }, "×"),
            ) : null,
          ),
          h("div", { className: "dsh-remote-ops__quickItems" },
            quickItems.length ? quickItems.map((item) => h("div", { className: "dsh-remote-ops__quickItem", key: item.id, title: item.command },
              h("span", null, item.name),
              h("button", { className: "dsh-remote-ops__tiny", disabled: busy || !snapshot.bound, onClick: () => void send(item.command) }, "执行"),
              h("button", { className: "dsh-remote-ops__tiny", onClick: () => void addQuick(item) }, "编辑"),
              h("button", { className: "dsh-remote-ops__tiny", onClick: () => { if (window.confirm(`删除快捷命令“${item.name}”？`)) void action({ action: "quick.delete", commandId: item.id }); } }, "×"),
            )) : h("div", { className: "dsh-remote-ops__muted" }, snapshot.quickGroups.length ? "当前分组没有命令。" : "请先添加快捷命令分组。"),
          ),
        ),
      )) : null;
      const markUserScrollIntent = (event) => {
        if (event?.type === "pointerdown" && event.clientX < event.currentTarget.getBoundingClientRect().right - 18) return;
        userScrollIntent.current = true;
        if (scrollIntentTimer.current) window.clearTimeout(scrollIntentTimer.current);
        scrollIntentTimer.current = window.setTimeout(() => { userScrollIntent.current = false; scrollIntentTimer.current = undefined; }, 250);
      };
      const terminalInputCapture = h("textarea", { ref: terminalInputRef, className: "dsh-remote-ops__inputCapture", value: terminalInput, readOnly: !terminalReady, spellCheck: false, autoCapitalize: "off", autoCorrect: "off", "aria-label": "终端输入", onCompositionStart: () => { composingRef.current = true; }, onCompositionEnd: () => { composingRef.current = false; }, onChange: (event) => { const value = event.target.value; const completed = terminalInputCompositionValue(value, composingRef.current || event.isComposing || event.nativeEvent?.isComposing); setTerminalInput(value); if (completed !== undefined) { if (completed) queueRawInput(completed); setTerminalInput(""); } }, onKeyDown: (event) => { if (event.isComposing || event.nativeEvent?.isComposing || composingRef.current) return; const sequence = keySequence(event); if (sequence !== undefined) { event.preventDefault(); queueRawInput(sequence); setTerminalInput(""); } }, onPaste: (event) => { event.preventDefault(); queueRawInput(event.clipboardData.getData("text")); } });
      const terminal = h("section", { className: "dsh-remote-ops__terminal" },
        h("div", { className: "dsh-remote-ops__terminalHead" },
          h("strong", null, localActive ? `${activeSession.name} · ${activeSession.workingDirectory ?? "本地"}` : activeEnvironment ? `${activeEnvironment.name} · ${activeEnvironment.host}` : "SSH 终端"),
          h("small", null, activeSession ? activeSession.status?.kind ?? "运行中" : "未连接"),
          h("button", { className: "dsh-remote-ops__headAction", disabled: busy || !activeSession, onClick: () => void action({ action: "signal", session: activeSession?.sessionId, signal: "SIGINT" }) }, "中断"),
          h("button", { className: "dsh-remote-ops__headAction", "aria-expanded": drawer, title: drawer ? "收起环境" : "打开环境", onClick: () => setDrawer((value) => !value) }, "环境"),
        ),
        h("div", { className: "dsh-remote-ops__tabs" }, snapshot.sessions.length ? snapshot.sessions.map((item) => h("button", { key: item.sessionId, "data-active": activeSession?.sessionId === item.sessionId, onClick: () => { setActiveSessionId(item.sessionId); setSelectedEnv(item.environmentId); stickToBottom.current = true; } }, item.name)) : h("span", { className: "dsh-remote-ops__muted" }, "没有活动终端")),
        activeSession ? h("div", { className: "dsh-remote-ops__screen", onClick: () => terminalInputRef.current?.focus() },
          h("pre", { className: "dsh-remote-ops__output", ref: outputRef, onWheel: markUserScrollIntent, onPointerDown: markUserScrollIntent, onScroll: (event) => { const node = event.currentTarget; const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48; if (userScrollIntent.current) stickToBottom.current = nearBottom; else if (nearBottom) stickToBottom.current = true; } }, terminalOutputView),
          terminalInputCapture,
          terminalOutput ? null : h("div", { className: "dsh-remote-ops__screenHint" }, "点击输入 · Tab 补齐 · Ctrl+C 中断"),
        ) : h("div", { className: "dsh-remote-ops__screen dsh-remote-ops__screenEmpty", onClick: () => terminalInputRef.current?.focus() }, h("div", { className: "dsh-remote-ops__empty" }, h("div", null, h("div", { style: { fontSize: "22px", marginBottom: "8px" } }, "›_"), h("div", null, terminalReady ? "输入 ssh [user@]host 并按 Enter 连接，或从环境抽屉选择环境。" : "等待本地 CMD 启动…"), pendingSshInput ? h("pre", { className: "dsh-remote-ops__pendingCommand" }, pendingSshInput) : null)), terminalInputCapture, h("div", { className: "dsh-remote-ops__screenHint" }, terminalReady ? "输入 SSH 命令 · Enter 连接" : "等待本地 CMD 启动…")),
      );
      const aux = module === "sftp" ? h("aside", { className: "dsh-remote-ops__aux" }, h("div", { className: "dsh-remote-ops__drawerHead" }, h("strong", null, "SFTP"), h("button", { className: "dsh-remote-ops__tiny", onClick: () => setModule("terminal") }, "×")), h("div", { className: "dsh-remote-ops__auxBody" }, h("input", { value: sftpPath, onChange: (event) => setSftpPath(event.target.value), placeholder: "远程路径，例如 /etc" }), snapshot.environments.map((env) => h("div", { className: "dsh-remote-ops__card", key: env.id }, h("div", { className: "dsh-remote-ops__row" }, h("span", null, env.name), h("button", { className: "dsh-remote-ops__tiny", disabled: busy || !snapshot.bound, onClick: async () => { const value = await action({ action: "sftp", operation: "list", environment: env.id, path: sftpPath }); if (value?.entries) setEntries(value.entries); } }, "读取")))), h("pre", { className: "dsh-remote-ops__card", style: { whiteSpace: "pre-wrap", maxHeight: "300px", overflow: "auto" } }, entries.map((item) => `${item.type === "d" ? "目录" : "文件"}  ${item.name}  ${item.size ?? ""}`).join("\n") || "暂无目录内容"))) : module === "diagnostics" ? h("aside", { className: "dsh-remote-ops__aux" }, h("div", { className: "dsh-remote-ops__drawerHead" }, h("strong", null, "诊断"), h("button", { className: "dsh-remote-ops__tiny", onClick: () => setModule("terminal") }, "×")), h("pre", { className: "dsh-remote-ops__auxBody", style: { whiteSpace: "pre-wrap" } }, (snapshot.events ?? []).map((item) => JSON.stringify(item)).join("\n") || "暂无事件")) : null;
      return h("div", { className: "dsh-remote-ops" }, h("div", { className: "dsh-remote-ops__head" }, h("strong", null, "Remote Ops"), h("span", { className: "dsh-remote-ops__version" }, `v${snapshot.pluginVersion ?? update.currentVersion ?? "?"}`), h("button", { className: "dsh-remote-ops__headEnv dsh-remote-ops__headAction", "aria-expanded": drawer, onClick: () => setDrawer((value) => !value), title: drawer ? "收起环境" : activeEnvironment?.name ?? "打开环境" }, activeEnvironment?.name ?? "选择环境"), h("span", { className: "dsh-remote-ops__muted" }, snapshot.sessions.length ? `${snapshot.sessions.length} 个终端` : (snapshot.bound ? "0 个终端" : "等待本地 CMD")) , update.updateAvailable ? h("button", { className: "dsh-remote-ops__headAction dsh-remote-ops__update", disabled: updateBusy, "aria-busy": updateBusy, onClick: () => void installUpdate() }, updateBusy ? "升级中…" : `升级 v${update.latestVersion}`) : h("button", { className: "dsh-remote-ops__headAction", disabled: updateBusy, "aria-busy": updateBusy, onClick: () => void checkUpdate(false) }, updateBusy ? "检查中…" : "检查更新"), h("button", { className: "dsh-remote-ops__headAction", disabled: busy || refreshBusy, "aria-busy": refreshBusy, onClick: () => void refreshNow() }, refreshBusy ? "刷新中…" : "刷新"), h("span", { className: "dsh-remote-ops__headNotice", "data-error": actionNotice.includes("失败") }, actionNotice)), error ? h("div", { className: "dsh-remote-ops__error" }, h("div", { className: "dsh-remote-ops__errorBody" }, error), h("button", { className: "dsh-remote-ops__errorClose", title: "关闭错误", "aria-label": "关闭错误", onClick: () => setError("") }, "×")) : null, h("div", { className: "dsh-remote-ops__workspace" }, h("nav", { className: "dsh-remote-ops__rail", "aria-label": "Remote Ops 导航" }, [["environments", "环境"], ["quick", "快捷命令"], ["sftp", "SFTP"], ["diagnostics", "诊断"]].map(([id, label]) => h("button", { key: id, "data-active": id === "environments" ? drawer : id === "quick" ? quickOpen : module === id, title: label, "aria-label": label, onClick: () => id === "environments" ? (setDrawer((value) => !value), setModule("terminal")) : id === "quick" ? (setDrawer(false), setModule("terminal"), setQuickOpen((value) => !value)) : (setDrawer(false), setModule((value) => value === id ? "terminal" : id)) }, glyph[id])), h("div", { className: "dsh-remote-ops__railSpacer" }), h("button", { className: "dsh-remote-ops__headAction", title: "刷新", onClick: () => void refreshNow() }, "↻")), h("main", { className: "dsh-remote-ops__main" }, terminal, quickPanel), envDrawer, aux));
    }
    function RemoteOpsTitle() { return h("span", null, "Remote Ops"); }
    function RemoteOpsLaunch({ wide, onClick, label }) { return h("button", { type: "button", className: "dsh-remote-ops__launchControl", title: label, "aria-label": label, onClick }, h("span", { className: "dsh-remote-ops__launchControlIcon", "aria-hidden": true }, "⌁"), wide ? h("span", { className: "dsh-remote-ops__launchLabel" }, label) : null); }
    const inject = ["slots", "locale"];
    function apply(ctx) {
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
      ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-remote-ops-launch", order: 40, label: () => t("title") }, (props) => h(RemoteOpsLaunch, { ...props, onClick: openRemoteOps, label: t("title") }))), "dsh-remote-ops: launch button");
      ctx.inject(["sidebarRight", "sidebarRightTabs"], (ready) => {
        const sidebarRight = getService(ready, "sidebarRight");
        const sidebarRightTabs = getService(ready, "sidebarRightTabs");
        if (!sidebarRight || !sidebarRightTabs) return;
        ready.effect(() => sidebarRightTabs.register({ id: TAB_ID, kind: TAB_KIND, priority: "extension", title: () => t("title"), guide: [{ order: 30, title: () => t("guideTitle"), description: () => t("guideDescription") }] }), "dsh-remote-ops: tab type");
        ready.effect(() => ready.slots.inject("sidebar.right.pane.tab", () => ready.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID }, RemoteOpsPanel)), "dsh-remote-ops: tab body");
        ready.effect(() => ready.slots.inject("sidebar.right.pane.tab.title", () => ready.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB_ID }, RemoteOpsTitle)), "dsh-remote-ops: tab title");
      });
    }
    return { inject, apply };
  },
});
