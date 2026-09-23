---
title: Downloads
description: Download paths, name collisions, overwrites, redirects, checksums, and file safety.
---

# Downloads

Sharge CLI downloads audio, images, and video from AI Live Photo items and audio from Recordings. Binary content never goes to stdout.

## Default path

Without `--file`, the CLI saves to the current working directory:

```sh
sharge recordings download 456 --json
```

It prefers a safe filename from the server's `Content-Disposition`, falling back to names such as `recording-456.m4a` or `note-123-image.jpg`. Directory components, control characters, and unsafe characters are removed from server-provided names; they cannot change the destination directory.

## Name collisions

For an automatically generated filename, the CLI chooses an available suffix such as `recording-456-1.m4a`. It reserves the name before reading the body. If another process takes the planned name, the CLI uses the same temporary download to choose another safe suffix, without overwriting the other file or downloading again.

An explicit path behaves differently:

```sh
sharge recordings download 456 --file ./meeting.m4a --json
```

An existing explicit target returns `FILE_EXISTS`. To replace that exact path:

```sh
sharge recordings download 456 --file ./meeting.m4a --overwrite --json
```

`--overwrite` expresses the exact replacement intent, so it does not also require `--yes`. `--file -` is unsupported. An explicit target or any parent directory that is a symlink fails; the CLI checks before network access and after receiving headers. If a no-overwrite target is taken during download, the other file is preserved and the command fails with `FILE_EXISTS`.

## Atomic output

The CLI reserves a destination, streams to a temporary file while computing SHA-256, and publishes only the complete file. Normal output uses a no-replace operation; only explicit `--overwrite` uses atomic replacement. Failed downloads clean up temporary files rather than leaving a partial file that appears complete.

## Result

Text mode prints an absolute path. JSON includes the final path, byte count, media type, and SHA-256:

```json
{
  "data": {
    "filePath": "/workspace/recording-456.m4a",
    "bytes": 1048576,
    "mediaType": "audio/mp4",
    "sha256": "..."
  }
}
```

Agents must read `filePath` instead of guessing the final name.

## Redirect safety

A download may redirect to a short-lived signed URL. The CLI sends the API key only to the initial Open Platform request; it does not send Authorization to later redirects, including cross-origin destinations. It follows at most five HTTP(S) redirects, rejects redirect URLs with credentials, and does not log or return signed URLs as a business result.

The download pipeline also accepts an Open Platform JSON redirect containing `data.url`. Other successful JSON shapes are not written as files.

## Dry run

```sh
sharge notes download 123 --media image --dry-run --json
```

A dry run makes no network request and creates no file. It shows the endpoint, planned absolute path, naming source, overwrite policy, required scope, and unverified conditions. It cannot confirm that remote media exists.

## Timeout

The default total download timeout is `10m`; specify a unit when overriding it:

```sh
sharge recordings download 456 --timeout 20m --json
```

Timeouts are not automatically retried. An incomplete temporary file is removed; check the error's `retryable` field before deciding whether to download again.

## Commands

```sh
sharge notes download 123 --media audio
sharge notes download 123 --media image --file ./photo.jpg
sharge notes download 123 --media video --json
sharge recordings download 456
sharge recordings download 456 --file ./meeting.m4a --json
```
