import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function registerBrowserSkill(ctx) {
  ctx.inject?.(["skills"], ready => {
    const path = fileURLToPath(new URL("../skills/remote-ops-browser/SKILL.md", import.meta.url));
    const raw = readFileSync(path, "utf8");
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
    const description = frontmatter?.[1].match(/^description: (.+)$/mu)?.[1].trim();
    if (!description) throw new Error("Remote Ops browser skill is missing its description");
    const summary = {
      name: "remote-ops-browser", description, path,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: "dsh-remote-ops", source: "bundled",
      resourceBase: { kind: "directory", path: dirname(path) },
    };
    ready.skills.registerProvider(() => ({
      name: summary.provider,
      // DSH's public BUNDLED_SKILL_RANK: user/project skills keep precedence.
      list: async () => [{ ...summary, rank: 600, locator: summary.name }],
      get: async () => ({ ...summary, content: raw.slice(frontmatter[0].length).trim() }),
    }));
  });
}
