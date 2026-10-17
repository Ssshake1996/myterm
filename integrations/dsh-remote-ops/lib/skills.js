import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function registerBundledSkills(ctx) {
  ctx.inject?.(["skills"], ready => {
    const entries = ["remote-ops-browser", "remote-ops-environments"].map(name => {
      const path = fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url));
      const raw = readFileSync(path, "utf8");
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
      const description = frontmatter?.[1].match(/^description: (.+)$/mu)?.[1].trim();
      if (!description) throw new Error(`Remote Ops skill ${name} is missing its description`);
      const summary = {
        name, description, path, locator: name, rank: 600,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: "dsh-remote-ops", source: "bundled",
        resourceBase: { kind: "directory", path: dirname(path) },
      };
      return { summary, content: raw.slice(frontmatter[0].length).trim() };
    });
    ready.skills.registerProvider(() => ({
      name: "dsh-remote-ops",
      // DSH's public BUNDLED_SKILL_RANK: user/project skills keep precedence.
      list: async () => entries.map(entry => ({ ...entry.summary })),
      get: async candidate => {
        const entry = entries.find(value => value.summary.name === candidate?.name && value.summary.locator === candidate?.locator);
        return entry ? { ...entry.summary, content: entry.content } : undefined;
      },
    }));
  });
}
