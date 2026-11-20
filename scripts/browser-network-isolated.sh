#!/usr/bin/env bash
set -euo pipefail
# This script runs ONLY in a fresh CI network namespace, never on the user's host.
ip link set lo up
test "$(ip -o link show | awk -F': ' '{print $2}' | tr '\n' ' ')" = 'lo '
# Model a connected intranet, without giving this namespace any uplink.
# Both ends of the veth stay inside it; no bridge, NAT or host-facing peer exists.
ip link add mcp0 type veth peer name mcp1
ip addr add 198.18.0.1/30 dev mcp0
ip addr add 198.18.0.2/30 dev mcp1
ip link set mcp0 up
ip link set mcp1 up
test -z "$(ip route show default)"
test -z "$(ip -6 route show default)"
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
export REMOTE_OPS_NETWORK_ISOLATION=linux-private-namespace-no-uplink
export MCP_EVIDENCE="$PWD/output/browser-mcp-network/browser"
strace -f -e trace=network,close -s 160 -o output/browser-mcp-network/browser.trace node integrations/dsh-remote-ops/test/browser-mcp-live.mjs
node scripts/check-browser-network.mjs output/browser-mcp-network/browser.trace
strace -f -e trace=network,close -s 160 -o output/browser-mcp-network/dsh.trace node e2e/runner/browser-mcp-native.mjs "$1"
node scripts/check-browser-network.mjs output/browser-mcp-network/dsh.trace
