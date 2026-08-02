import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  reserveExplicitDownload,
  reserveGeneratedDownload,
  safeDownloadFileName,
  writeAllDownloadChunk,
} from "../src/runtime/download-files.js";
import { CliFailure } from "../src/runtime/errors.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("download file safety", () => {
  it("publishes a generated download under the next suffix if the target is stolen", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sharge-download-reservation-"));
    cleanupPaths.push(cwd);
    const reserved = await reserveGeneratedDownload(cwd, "image.png");
    await reserved.handle.write("downloaded");
    await rm(reserved.filePath, { force: true });
    await writeFile(reserved.filePath, "replacement");

    await reserved.commit();

    expect(await readFile(join(cwd, "image.png"), "utf8")).toBe("replacement");
    expect(reserved.filePath).toBe(join(cwd, "image-1.png"));
    expect(await readFile(reserved.filePath, "utf8")).toBe("downloaded");
  });

  it("never overwrites an explicit no-overwrite target stolen before commit", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sharge-download-explicit-"));
    cleanupPaths.push(cwd);
    const reserved = await reserveExplicitDownload(
      cwd,
      "image.png",
      false,
      () =>
        new CliFailure({
          type: "FILE_EXISTS",
          exitCode: 2,
          message: "exists",
          nextAction: { description: "retry", command: "sharge --help" },
        }),
      (message) =>
        new CliFailure({
          message,
          nextAction: { description: "retry", command: "sharge --help" },
        }),
    );
    await reserved.handle.write("downloaded");
    await rm(reserved.filePath, { force: true });
    await writeFile(reserved.filePath, "replacement");

    await expect(reserved.commit()).rejects.toMatchObject({
      type: "FILE_EXISTS",
    });
    await reserved.cleanup();
    expect(await readFile(reserved.filePath, "utf8")).toBe("replacement");
  });

  it("limits UTF-8 filenames by bytes while preserving the extension", () => {
    const suggested = `${"😀".repeat(180)}.png`;
    const safe = safeDownloadFileName(
      `attachment; filename*=UTF-8''${encodeURIComponent(suggested)}`,
      "fallback.png",
    );

    expect(Buffer.byteLength(safe)).toBeLessThanOrEqual(180);
    expect(safe).toMatch(/\.png$/);
  });

  it("writes an entire chunk even when the file writer performs short writes", async () => {
    const output: number[] = [];
    const calls: Array<{ offset: number; length: number }> = [];
    const writer = {
      write: async (buffer: Uint8Array, offset: number, length: number) => {
        const bytesWritten = Math.min(2, length);
        calls.push({ offset, length });
        output.push(...buffer.subarray(offset, offset + bytesWritten));
        return { bytesWritten };
      },
    };

    await writeAllDownloadChunk(writer, Uint8Array.from([1, 2, 3, 4, 5]));

    expect(output).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toEqual([
      { offset: 0, length: 5 },
      { offset: 2, length: 3 },
      { offset: 4, length: 1 },
    ]);
  });
});
