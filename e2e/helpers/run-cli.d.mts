export type ProcessResult = {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

export type ProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stdin?: "ignore" | string;
};

export function mergeProcessOptions(
  options: ProcessOptions,
  defaults: ProcessOptions,
): ProcessOptions;

export function runProcess(
  command: string[],
  options?: ProcessOptions,
): Promise<ProcessResult>;

export function runBuiltCli(
  repositoryRoot: string,
  args: string[],
  options?: ProcessOptions,
): Promise<ProcessResult>;
