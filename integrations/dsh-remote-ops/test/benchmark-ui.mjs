// Optional local microbenchmark; not a CI timing gate and not SSH/network timing.
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import vm from "node:vm";
import assert from "node:assert/strict";

function model(source) {
  const start=source.indexOf("    const terminalScreenModel ="),end=source.indexOf("    const terminalVisibleText",start),context={};
  vm.runInNewContext(source.slice(start,end).replace("const terminalScreenModel","globalThis.model"),context);
  return context.model;
}
const current=model(await readFile(new URL("../lib/client.js",import.meta.url),"utf8"));
const baseline=model(execFileSync("git",["show","dsh-remote-ops-v0.4.0:integrations/dsh-remote-ops/lib/client.js"],{encoding:"utf8"}));
const cases={plain:Array.from({length:6500},(_,i)=>"line "+i+" "+"text ".repeat(8)).join("\r\n").slice(-262144),sgr:("\x1b[32mline\x1b[0m "+"text ".repeat(8)+"\r\n").repeat(6000).slice(-262144)};
const results=[];
for(const [name,input] of Object.entries(cases)){
  assert.equal(JSON.stringify(current(input)),JSON.stringify(baseline(input)),"screen and cursor must remain identical");
  const measure=render=>{const times=[];for(let n=0;n<12;n++){const start=performance.now();render(input);times.push(performance.now()-start);}times.sort((a,b)=>a-b);return {medianMs:+times[6].toFixed(2),maxMs:+times.at(-1).toFixed(2)};};
  results.push({name,bytes:Buffer.byteLength(input),baseline:measure(baseline),current:measure(current)});
}
console.log(JSON.stringify({node:process.version,platform:process.platform,scope:"parser only; no browser DOM, SSH or network",results},null,2));
