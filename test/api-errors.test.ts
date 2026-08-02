import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { requestJson } from "../src/api/client.js";
import { main } from "../src/cli.js";
import { CliFailure } from "../src/runtime/errors.js";

async function invokeAuthStatus(
  responseOptions: {
    status: number;
    message: string;
    headers?: Record<string, string>;
  },
  extraArgs: string[] = [],
) {
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-api-error-"));
  const configDir = join(homeDir, ".sharge");
  await mkdir(configDir, { mode: 0o700 });
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(responseOptions.status, {
      "Content-Type": "application/json",
      "X-Request-Id": `req_${responseOptions.status}`,
      ...responseOptions.headers,
    });
    response.end(
      JSON.stringify({
        code: responseOptions.status,
        message: responseOptions.message,
        data: null,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  await writeFile(
    join(configDir, "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_error",
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: "lms-api-error-secret",
    })}\n`,
    { mode: 0o600 },
  );
  let stdout = "";
  try {
    const exitCode = await main(
      ["node", "sharge", "auth", "status", "--json", ...extraArgs],
      {
        env: {},
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      {
        stdout: (value) => {
          stdout += value;
        },
        stderr: () => {},
      },
    );
    return { exitCode, requests, stdout, envelope: JSON.parse(stdout) };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(homeDir, { recursive: true, force: true });
  }
}

async function invokeAuthStatusAt(baseUrl: string, extraArgs: string[] = []) {
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-api-network-"));
  const configDir = join(homeDir, ".sharge");
  await mkdir(configDir, { mode: 0o700 });
  await writeFile(
    join(configDir, "settings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      installationId: "install_network",
      baseUrl,
      apiKey: "lms-network-secret",
    })}\n`,
    { mode: 0o600 },
  );
  let stdout = "";
  try {
    const exitCode = await main(
      ["node", "sharge", "auth", "status", "--json", ...extraArgs],
      {
        env: {},
        homeDir,
        cwd: homeDir,
        platform: process.platform,
      },
      {
        stdout: (value) => {
          stdout += value;
        },
        stderr: () => {},
      },
    );
    return { exitCode, envelope: JSON.parse(stdout) };
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

it("maps a 403 response to PERMISSION_DENIED", async () => {
  const result = await invokeAuthStatus({
    status: 403,
    message: "Forbidden",
  });

  expect(result.exitCode).toBe(4);
  expect(result.requests).toBe(1);
  expect(result.envelope).toMatchObject({
    error: {
      type: "PERMISSION_DENIED",
      retryable: false,
    },
    meta: {
      requestId: "req_403",
      httpStatus: 403,
    },
  });
});

it("maps a 400 response to INVALID_INPUT", async () => {
  const result = await invokeAuthStatus({
    status: 400,
    message: "Invalid request",
  });

  expect(result.exitCode).toBe(2);
  expect(result.requests).toBe(1);
  expect(result.envelope).toMatchObject({
    error: {
      type: "INVALID_INPUT",
      retryable: false,
    },
    meta: {
      requestId: "req_400",
      httpStatus: 400,
    },
  });
});

it("maps a 404 response to NOT_FOUND", async () => {
  const result = await invokeAuthStatus({
    status: 404,
    message: "Not found",
  });

  expect(result.exitCode).toBe(5);
  expect(result.requests).toBe(1);
  expect(result.envelope).toMatchObject({
    error: {
      type: "NOT_FOUND",
      retryable: false,
    },
    meta: {
      requestId: "req_404",
      httpStatus: 404,
    },
  });
});

it("maps a 409 response to CONFLICT", async () => {
  const result = await invokeAuthStatus({
    status: 409,
    message: "Conflict",
  });

  expect(result.exitCode).toBe(6);
  expect(result.requests).toBe(1);
  expect(result.envelope).toMatchObject({
    error: {
      type: "CONFLICT",
      retryable: false,
    },
    meta: {
      requestId: "req_409",
      httpStatus: 409,
    },
  });
});

it("maps a 429 response to retryable RATE_LIMITED without retrying", async () => {
  const result = await invokeAuthStatus({
    status: 429,
    message: "Rate limit exceeded",
    headers: { "Retry-After": "3" },
  });

  expect(result.exitCode).toBe(7);
  expect(result.requests).toBe(1);
  expect(result.envelope).toMatchObject({
    error: {
      type: "RATE_LIMITED",
      retryable: true,
    },
    meta: {
      requestId: "req_429",
      httpStatus: 429,
    },
  });
});

it("maps a 5xx response to retryable SERVER_ERROR without retrying", async () => {
  const result = await invokeAuthStatus({
    status: 503,
    message: "Service unavailable",
  });

  expect(result.exitCode).toBe(8);
  expect(result.requests).toBe(1);
  expect(result.envelope).toMatchObject({
    error: {
      type: "SERVER_ERROR",
      retryable: true,
    },
    meta: {
      requestId: "req_503",
      httpStatus: 503,
    },
  });
});

it("redacts the configured API key if a server error message echoes it", async () => {
  const result = await invokeAuthStatus({
    status: 503,
    message: "failed for lms-api-error-secret",
  });

  expect(result.exitCode).toBe(8);
  expect(result.stdout).not.toContain("lms-api-error-secret");
  expect(result.envelope.error.message).toContain("[REDACTED]");
});

it("maps a connection failure to retryable NETWORK_ERROR", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  const result = await invokeAuthStatusAt(`http://127.0.0.1:${address.port}`);
  expect(result.exitCode).toBe(8);
  expect(result.envelope).toMatchObject({
    error: {
      type: "NETWORK_ERROR",
      retryable: true,
    },
    meta: {
      requestId: null,
      httpStatus: null,
    },
  });
});

it("honors --timeout and maps an aborted request to TIMEOUT without retrying", async () => {
  let requests = 0;
  const server = createServer(() => {
    requests += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  try {
    const result = await invokeAuthStatusAt(
      `http://127.0.0.1:${address.port}`,
      ["--timeout", "1s"],
    );
    expect(result.exitCode).toBe(8);
    expect(requests).toBe(1);
    expect(result.envelope).toMatchObject({
      error: {
        type: "TIMEOUT",
        retryable: true,
      },
      meta: {
        requestId: null,
        httpStatus: null,
      },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("maps a timeout while consuming a response body and preserves response metadata", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, {
      "Content-Type": "application/json",
      "X-Request-Id": "req_body_timeout",
    });
    response.write('{"code":0,"message":"ok","data":');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  try {
    const result = await invokeAuthStatusAt(
      `http://127.0.0.1:${address.port}`,
      ["--timeout", "1s"],
    );
    expect(requests).toBe(1);
    expect(result.exitCode).toBe(8);
    expect(result.envelope).toMatchObject({
      error: { type: "TIMEOUT", retryable: true },
      meta: { requestId: "req_body_timeout", httpStatus: 200 },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("maps a malformed successful response to a stable server protocol error", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "sharge-malformed-body-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "X-Request-Id": "req_malformed",
    });
    response.end("<html>not json</html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  try {
    await expect(
      requestJson(
        {
          env: {},
          homeDir,
          cwd: homeDir,
          platform: process.platform,
        },
        {
          baseUrl: `http://127.0.0.1:${address.port}`,
          apiKey: "lms-malformed-secret",
          timezone: "UTC",
          method: "GET",
          path: "/malformed",
        },
      ),
    ).rejects.toMatchObject({
      type: "SERVER_ERROR",
      exitCode: 8,
      requestId: "req_malformed",
      httpStatus: 200,
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(homeDir, { recursive: true, force: true });
  }
});

it("marks a write network failure as unknown outcome and not retryable", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

  const error = await requestJson(
    {
      env: {},
      homeDir: tmpdir(),
      cwd: tmpdir(),
      platform: process.platform,
    },
    {
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: "lms-write-secret",
      timezone: "UTC",
      method: "POST",
      path: "/write",
    },
  ).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(CliFailure);
  expect(error).toMatchObject({
    type: "NETWORK_ERROR",
    retryable: false,
    outcome: "unknown",
  });
});

it("rejects an invalid jq expression before making a network request", async () => {
  const result = await invokeAuthStatus({ status: 200, message: "ok" }, [
    "--jq",
    ".data[",
  ]);

  expect(result.exitCode).toBe(2);
  expect(result.requests).toBe(0);
  expect(result.envelope).toMatchObject({
    error: {
      type: "INVALID_INPUT",
      field: "--jq",
    },
  });
});

it("never applies jq to an error envelope", async () => {
  const result = await invokeAuthStatus(
    { status: 401, message: "Invalid token" },
    ["--jq", ".error.type"],
  );

  expect(result.exitCode).toBe(3);
  expect(result.requests).toBe(1);
  expect(result.envelope).toMatchObject({
    schemaVersion: "1",
    ok: false,
    error: { type: "CREDENTIAL_INVALID" },
  });
});
