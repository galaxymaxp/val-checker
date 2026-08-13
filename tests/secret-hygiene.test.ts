import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function git(...args: string[]) {
  const repository = process.cwd().replaceAll("\\", "/");

  return execFileSync("git", ["-c", `safe.directory=${repository}`, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

describe("repository secret hygiene", () => {
  it("put the secret-safe ignore rules in the root commit", () => {
    const rootCommit = git("rev-list", "--max-parents=0", "HEAD");
    const rootFiles = git("show", "--pretty=format:", "--name-only", rootCommit).split(/\r?\n/);

    expect(rootFiles).toContain(".gitignore");
    expect(rootFiles).toContain(".env.example");
  });

  it("tracks no secret-bearing file names", () => {
    const tracked = git("ls-files").split(/\r?\n/).filter(Boolean);
    const forbidden = tracked.filter((file) => {
      const basename = file.split("/").at(-1) ?? file;
      const isEnvironmentFile = basename.startsWith(".env") && basename !== ".env.example";

      return (
        isEnvironmentFile ||
        /^cookies.*\.json$/i.test(basename) ||
        /^jar_live\.json$/i.test(basename) ||
        /\.(pem|key)$/i.test(basename)
      );
    });

    expect(forbidden).toEqual([]);
  });
});
