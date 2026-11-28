import test from "node:test";
import assert from "node:assert/strict";
import { functionsFrom } from "../../../../docs/tests/mod-view.mjs";

const source = new URL("./stacks.js", import.meta.url);
const dir = "/work/projects/site";
const http = "http://mail.example.test:8125";
const https = "https://mail.example.test:8126";

test("the stack carries the Mailpit URL reported for this project's scheme", () => {
  const { readDdev, stacksFor } = functionsFrom(source, {}, ["readDdev", "stacksFor"]);
  const project = { approot: dir, status: "running", mailpit_url: http, mailpit_https_url: https };
  function stack(fields) {
    const ddev = readDdev(JSON.stringify({ raw: [{ ...project, ...fields }] }));
    return stacksFor(dir, "/home/test", { ddev })[0];
  }
  assert.equal(stack({ primary_url: "https://site.example.test" }).mailpit, https);
  assert.equal(stack({ primary_url: "http://site.example.test" }).mailpit, http);
  assert.equal(stack({ mailpit_https_url: "file:///irrelevant" }).mailpit, http);
  assert.equal(stack({ router_disabled: true }).mailpit, null);
  assert.equal(stack({ mailpit_url: "", mailpit_https_url: null }).mailpit, null);
});

test("Adminer needs a running service with a browser URL in the clicked project", async () => {
  let reply;
  const exec = async (cmd, args, options) => {
    assert.equal(cmd, "ddev");
    assert.deepEqual([...args], ["describe", "--json-output", "--skip-hooks"]);
    assert.equal(options.cwd, dir);
    return reply;
  };
  const { adminerUrl } = functionsFrom(source, { exec }, ["adminerUrl"]);
  const stack = { dir, url: "http://site.example.test" };
  const endpoint = "http://database.example.test:9200";
  const service = { status: "running", http_url: endpoint, https_url: "https://database.example.test:9201" };
  for (const [adminer, expected] of [
    [service, endpoint], [undefined, null], [{ ...service, status: "stopped" }, null],
    [{ status: "running", http_url: "file:///irrelevant" }, null],
  ]) {
    reply = { code: 0, stdout: "noise\n" + JSON.stringify({ raw: { services: { adminer } } }) };
    assert.equal(await adminerUrl(stack), expected);
  }
  reply = { code: 1, stdout: "" };
  assert.equal(await adminerUrl(stack), null);
});
