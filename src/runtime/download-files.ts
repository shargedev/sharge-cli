import { randomUUID } from "node:crypto";
import { link, lstat, open, realpath, rename, rm } from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { CliFailure } from "./errors.js";

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function dispositionValue(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }
  const encoded = contentDisposition.match(
    /(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/i,
  )?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      return null;
    }
  }
  const quoted = contentDisposition.match(
    /(?:^|;)\s*filename\s*=\s*"((?:\\.|[^"])*)"/i,
  )?.[1];
  if (quoted !== undefined) {
    return quoted.replace(/\\(.)/g, "$1");
  }
  return (
    contentDisposition
      .match(/(?:^|;)\s*filename\s*=\s*([^;]+)/i)?.[1]
      ?.trim() ?? null
  );
}

export function safeDownloadFileName(
  contentDisposition: string | null,
  fallback: string,
): string {
  const suggested = dispositionValue(contentDisposition);
  const leaf = basename((suggested ?? "").replaceAll("\\", "/"));
  const withoutControls = Array.from(leaf, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? "_" : character;
  }).join("");
  let safe = withoutControls
    .normalize("NFC")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();
  if (WINDOWS_RESERVED_NAME.test(safe)) {
    safe = `_${safe}`;
  }
  safe = truncateUtf8FileName(safe, 180);
  return safe.length > 0 ? safe : fallback;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maximumBytes) {
      break;
    }
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function truncateUtf8FileName(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value) <= maximumBytes) {
    return value;
  }
  const extensionIndex = value.lastIndexOf(".");
  const extension =
    extensionIndex > 0 &&
    Buffer.byteLength(value.slice(extensionIndex)) < maximumBytes
      ? value.slice(extensionIndex)
      : "";
  const stem = extension ? value.slice(0, extensionIndex) : value;
  return `${truncateUtf8(
    stem,
    maximumBytes - Buffer.byteLength(extension),
  )}${extension}`;
}

export function fallbackNoteDownloadFileName(
  resourceId: string,
  media: "audio" | "image" | "video",
): string {
  const extension = {
    audio: "m4a",
    image: "jpg",
    video: "mp4",
  }[media];
  return `note-${resourceId}-${media}.${extension}`;
}

export function fallbackRecordingDownloadFileName(recordingId: string): string {
  return `recording-${recordingId}.m4a`;
}

export type ReservedDownload = {
  filePath: string;
  temporaryPath: string;
  handle: Awaited<ReturnType<typeof open>>;
  commit: () => Promise<void>;
  cleanup: () => Promise<void>;
};

type DownloadWriter = {
  write: (
    buffer: Uint8Array,
    offset: number,
    length: number,
  ) => Promise<{ bytesWritten: number }>;
};

export async function writeAllDownloadChunk(
  writer: DownloadWriter,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await writer.write(
      chunk,
      offset,
      chunk.byteLength - offset,
    );
    if (bytesWritten <= 0) {
      throw new Error("download file writer made no progress");
    }
    offset += bytesWritten;
  }
}

function sameFile(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function assertNoDownloadSymlinkAncestors(
  cwd: string,
  filePath: string,
  unsafeFailure: (message: string) => CliFailure,
): Promise<void> {
  const parent = dirname(resolve(filePath));
  const resolvedCwd = resolve(cwd);
  const fromCwd = relative(resolvedCwd, parent);
  const parentIsWithinCwd =
    fromCwd === "" || (fromCwd !== ".." && !fromCwd.startsWith(`..${sep}`));
  const start = parentIsWithinCwd
    ? await realpath(resolvedCwd)
    : parse(parent).root;
  const segments = (parentIsWithinCwd ? fromCwd : relative(start, parent))
    .split(sep)
    .filter(Boolean);
  let current = start;
  for (const segment of segments) {
    current = join(current, segment);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw unsafeFailure("显式下载目标的父目录不存在。");
      }
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      throw unsafeFailure("显式下载目标的父目录不能包含符号链接。");
    }
    if (!metadata.isDirectory()) {
      throw unsafeFailure("显式下载目标的父路径不是目录。");
    }
  }
}

export async function validateExplicitDownloadTarget(
  cwd: string,
  file: string,
  overwrite: boolean,
  existsFailure: () => CliFailure,
  unsafeFailure: (message: string) => CliFailure,
): Promise<void> {
  const targetPath = resolve(cwd, file);
  await assertNoDownloadSymlinkAncestors(cwd, targetPath, unsafeFailure);
  try {
    const metadata = await lstat(targetPath);
    if (metadata.isSymbolicLink()) {
      throw unsafeFailure("显式下载目标不能是符号链接。");
    }
    if (!metadata.isFile()) {
      throw unsafeFailure("显式下载目标必须是普通文件路径。");
    }
    if (!overwrite) {
      throw existsFailure();
    }
  } catch (error) {
    if (error instanceof CliFailure) {
      throw error;
    }
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    try {
      const parent = await lstat(dirname(targetPath));
      if (!parent.isDirectory()) {
        throw unsafeFailure("显式下载目标的父路径不是目录。");
      }
    } catch (parentError) {
      if (parentError instanceof CliFailure) {
        throw parentError;
      }
      if (
        parentError instanceof Error &&
        "code" in parentError &&
        parentError.code === "ENOENT"
      ) {
        throw unsafeFailure("显式下载目标的父目录不存在。");
      }
      throw parentError;
    }
  }
}

type DownloadMarker = {
  filePath: string;
  markerPath: string;
  handle: Awaited<ReturnType<typeof open>>;
  identity: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>;
};

async function createDownloadMarker(
  filePath: string,
): Promise<DownloadMarker | null> {
  const markerPath = join(
    dirname(filePath),
    `.${basename(filePath)}.sharge-reservation`,
  );
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(markerPath, "wx", 0o600);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return null;
    }
    throw error;
  }
  try {
    const identity = await handle.stat();
    return { filePath, markerPath, handle, identity };
  } catch (error) {
    try {
      await handle.close();
    } catch {}
    await rm(markerPath, { force: true });
    throw error;
  }
}

async function releaseDownloadMarker(marker: DownloadMarker | null) {
  if (!marker) {
    return;
  }
  try {
    const current = await lstat(marker.markerPath);
    if (sameFile(marker.identity, current)) {
      await rm(marker.markerPath, { force: true });
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  } finally {
    try {
      await marker.handle.close();
    } catch {}
  }
}

async function createReservedDownload(options: {
  filePath: string;
  marker: DownloadMarker | null;
  overwrite: boolean;
  ownershipFailure: () => CliFailure;
  nextGeneratedCandidate?: () => Promise<{
    filePath: string;
    marker: DownloadMarker;
  }>;
}): Promise<ReservedDownload> {
  let filePath = options.filePath;
  let marker = options.marker;
  const directory = dirname(filePath);
  const temporaryPath = join(
    directory,
    `.${basename(filePath)}.sharge-${randomUUID()}.tmp`,
  );
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    return {
      get filePath() {
        return filePath;
      },
      temporaryPath,
      handle,
      commit: async () => {
        await handle.close();
        if (options.overwrite) {
          await rename(temporaryPath, filePath);
          return;
        }
        while (true) {
          try {
            await link(temporaryPath, filePath);
            await rm(temporaryPath, { force: true });
            await releaseDownloadMarker(marker);
            marker = null;
            return;
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !("code" in error) ||
              error.code !== "EEXIST"
            ) {
              throw error;
            }
          }
          if (!options.nextGeneratedCandidate) {
            throw options.ownershipFailure();
          }
          await releaseDownloadMarker(marker);
          const next = await options.nextGeneratedCandidate();
          filePath = next.filePath;
          marker = next.marker;
        }
      },
      cleanup: async () => {
        try {
          await handle.close();
        } catch {}
        await rm(temporaryPath, { force: true });
        await releaseDownloadMarker(marker);
        marker = null;
      },
    };
  } catch (error) {
    await releaseDownloadMarker(marker);
    throw error;
  }
}

function suffixedName(fileName: string, index: number): string {
  if (index === 0) {
    return fileName;
  }
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex <= 0) {
    return `${fileName}-${index}`;
  }
  return `${fileName.slice(0, extensionIndex)}-${index}${fileName.slice(extensionIndex)}`;
}

export async function reserveGeneratedDownload(
  cwd: string,
  fileName: string,
  helpCommand = "sharge notes download --help --json",
): Promise<ReservedDownload> {
  let nextIndex = 0;
  const nextCandidate = async () => {
    while (nextIndex < 10_000) {
      const index = nextIndex;
      nextIndex += 1;
      const filePath = resolve(cwd, suffixedName(fileName, index));
      try {
        await lstat(filePath);
        continue;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }
      const marker = await createDownloadMarker(filePath);
      if (!marker) {
        continue;
      }
      try {
        await lstat(filePath);
        await releaseDownloadMarker(marker);
        continue;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          await releaseDownloadMarker(marker);
          throw error;
        }
      }
      return { filePath, marker };
    }
    throw new Error("unable to reserve a generated download filename");
  };
  const initial = await nextCandidate();
  return await createReservedDownload({
    ...initial,
    overwrite: false,
    ownershipFailure: () =>
      new CliFailure({
        type: "FILE_EXISTS",
        exitCode: 2,
        message: "下载文件名在发布前已被其他进程占用。",
        nextAction: {
          description: "重新执行以选择下一个可用文件名",
          command: helpCommand,
        },
      }),
    nextGeneratedCandidate: nextCandidate,
  });
}

export async function proposeGeneratedDownloadPath(
  cwd: string,
  fileName: string,
): Promise<string> {
  for (let index = 0; index < 10_000; index += 1) {
    const filePath = resolve(cwd, suffixedName(fileName, index));
    try {
      await lstat(filePath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return filePath;
      }
      throw error;
    }
  }
  throw new Error("unable to propose a generated download filename");
}

export async function reserveExplicitDownload(
  cwd: string,
  file: string,
  overwrite: boolean,
  existsFailure: () => CliFailure,
  unsafeFailure: (message: string) => CliFailure,
): Promise<ReservedDownload> {
  const filePath = resolve(cwd, file);
  await assertNoDownloadSymlinkAncestors(cwd, filePath, unsafeFailure);
  let marker: DownloadMarker | null = null;
  if (!overwrite) {
    try {
      await lstat(filePath);
      throw existsFailure();
    } catch (error) {
      if (error instanceof CliFailure) {
        throw error;
      }
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    marker = await createDownloadMarker(filePath);
    if (!marker) {
      throw existsFailure();
    }
    try {
      await lstat(filePath);
      await releaseDownloadMarker(marker);
      throw existsFailure();
    } catch (error) {
      if (error instanceof CliFailure) {
        throw error;
      }
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        await releaseDownloadMarker(marker);
        throw error;
      }
    }
  }
  return await createReservedDownload({
    filePath,
    marker,
    overwrite,
    ownershipFailure: existsFailure,
  });
}
