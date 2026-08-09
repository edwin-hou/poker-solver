import { CancelledSolveError, solveHoldemRiver } from "./src/solver.js";

let activeJob = 0;

self.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  if (message.type === "cancel") {
    activeJob += 1;
    return;
  }
  if (message.type !== "solve") return;

  const jobId = ++activeJob;
  const started = performance.now();
  try {
    const result = await solveHoldemRiver(message.config, {
      yieldEvery: 5_000,
      isCancelled: () => jobId !== activeJob,
      onProgress: (progress) => {
        if (jobId === activeJob) self.postMessage({ type: "progress", jobId, progress });
      },
    });
    if (jobId !== activeJob) return;
    result.runtimeMs = performance.now() - started;
    self.postMessage({ type: "result", jobId, result });
  } catch (error) {
    if (error instanceof CancelledSolveError || jobId !== activeJob) {
      self.postMessage({ type: "cancelled", jobId });
      return;
    }
    self.postMessage({
      type: "error",
      jobId,
      error: {
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
        stack: error?.stack ?? "",
      },
    });
  }
});
