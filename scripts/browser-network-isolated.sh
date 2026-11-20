#!/usr/bin/env bash
set -euo pipefail
# This script runs ONLY in a fresh CI network namespace, never on the user's host.
ip link set lo up
test "$(ip -o link show | awk -F': ' '{print $2}' | tr '\n' ' ')" = 'lo '
mkdir -p output/browser-mcp-network
ip route show table all > output/browser-mcp-network/routes.txt
node --input-type=module -e '
import net from "node:net";
const socket=net.connect({host:"192.0.2.1",port:443});
socket.setTimeout(2000);
socket.on("connect",()=>{console.error("Isolation failed");process.exit(1)});
socket.on("timeout",()=>{console.error("Isolation probe did not get an immediate route rejection");process.exit(1)});
socket.on("error",error=>{if(!["ENETUNREACH","EHOSTUNREACH"].includes(error.code)){console.error(error);process.exit(1)}console.log("PASS OS denied non-loopback route: "+error.code)});
' > output/browser-mcp-network/isolation-probe.txt
export REMOTE_OPS_NETWORK_ISOLATION=linux-loopback-only
export MCP_EVIDENCE="$PWD/output/browser-mcp-network/browser"
strace -f -e trace=network,close -s 160 -o output/browser-mcp-network/browser.trace node integrations/dsh-remote-ops/test/browser-mcp-live.mjs
node scripts/check-browser-network.mjs output/browser-mcp-network/browser.trace
strace -f -e trace=network,close -s 160 -o output/browser-mcp-network/dsh.trace node e2e/runner/browser-mcp-native.mjs "$1"
node scripts/check-browser-network.mjs output/browser-mcp-network/dsh.trace
