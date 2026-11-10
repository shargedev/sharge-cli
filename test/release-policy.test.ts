import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const exec = promisify(execFile);
const workflow = z
  .object({
    jobs: z.object({
      publish: z.object({
        steps: z.array(
          z
            .object({ id: z.string().optional(), run: z.string().optional() })
            .passthrough(),
        ),
      }),
    }),
  })
  .parse(
    parse(
      await readFile(
        new URL("../.github/workflows/release.yml", import.meta.url),
        "utf8",
      ),
    ),
  );
const policy = workflow.jobs.publish.steps.find(
  (step) => step.id === "policy",
)?.run;

it.each([
  ["0.3.0-alpha.0", "true", "v0.3.0-alpha.0", "alpha"],
  ["0.3.0", "false", "v0.3.0", "latest"],
  ["0.3.0-beta.0", "true", "v0.3.0-beta.0", null],
  ["0.3.0-alpha.0", "false", "v0.3.0-alpha.0", null],
  ["0.3.0", "true", "v0.3.0", null],
  ["0.3.0-alpha.0", "true", "v0.3.0", null],
])("guards publication of %s with prerelease=%s and tag=%s", async (version, prerelease, tag, channel) => {
  if (!policy) throw Error("release policy missing");
  const cwd = await mkdtemp(join(tmpdir(), "sharge-release-policy-"));
  const output = join(cwd, "output");
  try {
    await writeFile(join(cwd, "package.json"), JSON.stringify({ version }));
    const result = await exec("bash", ["-e", "-c", policy], {
      cwd,
      env: {
        ...process.env,
        RELEASE_PRERELEASE: prerelease,
        GITHUB_REF_NAME: tag,
        GITHUB_OUTPUT: output,
      },
    }).then(
      () => true,
      () => false,
    );
    expect(result).toBe(channel !== null);
    if (channel)
      expect(await readFile(output, "utf8")).toBe(`publish-tag=${channel}\n`);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
