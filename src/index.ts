#!/usr/bin/env node
import { main } from "./cli.js";
import { defaultCliRuntime } from "./runtime/context.js";

const interruptController = new AbortController();
const onInterrupt = () => interruptController.abort();
process.once("SIGINT", onInterrupt);
try {
  process.exitCode = await main(process.argv, {
    ...defaultCliRuntime(),
    signal: interruptController.signal,
  });
} finally {
  process.removeListener("SIGINT", onInterrupt);
}
