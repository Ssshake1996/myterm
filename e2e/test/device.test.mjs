import test from "node:test";
import assert from "node:assert/strict";
import ssh2 from "ssh2";
import { startFakeDevice } from "../harness/fake-device.mjs";

const { Client } = ssh2;

function connect(device, password = device.password) {
  const client = new Client();
  return new Promise((resolve, reject) => {
    client.once("ready", () => resolve(client));
    client.once("error", reject);
    client.connect({ host: device.host, port: device.port, username: device.username, password, readyTimeout: 3000 });
  });
}

async function shell(client) {
  const stream = await new Promise((resolve, reject) => client.shell({ rows: 40, cols: 160 }, (error, value) => error ? reject(error) : resolve(value)));
  let text = "";
  stream.on("data", (chunk) => { text += chunk.toString("utf8"); });
  const waitFor = async (needle) => {
    const deadline = Date.now() + 2000;
    while (!text.includes(needle)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${needle} in ${text}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  };
  return { stream, waitFor, read: () => text };
}

test("the fake device asks for confirmation and does not continue until y is typed", async () => {
  const device = await startFakeDevice();
  try {
    const client = await connect(device);
    const session = await shell(client);
    await session.waitFor("admin:/>");
    session.stream.write("delete lun 3\r");
    await session.waitFor("(y/n)");
    assert.deepEqual(device.log.executed, []);
    session.stream.write("y\r");
    await session.waitFor("Are you sure");
    session.stream.write("y\r");
    await session.waitFor("Success: delete lun 3");
    assert.deepEqual(device.log.executed, ["delete lun 3"]);
    client.end();
  } finally { await device.close(); }
});

test("a wrong password is rejected and a window change is recorded", async () => {
  const device = await startFakeDevice();
  try {
    await assert.rejects(connect(device, "nope"));
    const client = await connect(device);
    const session = await shell(client);
    await session.waitFor("admin:/>");
    session.stream.setWindow(50, 200, 0, 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(device.log.windows.some((item) => item.rows === 50 && item.cols === 200));
    client.end();
  } finally { await device.close(); }
});
