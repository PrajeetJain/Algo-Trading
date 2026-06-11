export function createRateLimiter(rules) {
  const state = Object.fromEntries(
    Object.entries(rules).map(([key, rule]) => [
      key,
      {
        ...rule,
        queue: Promise.resolve(),
        lastRun: 0,
        calls: 0,
        delayed: 0,
      },
    ])
  );

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function schedule(key, task) {
    const bucket = state[key] ?? state.other;
    const run = bucket.queue.then(async () => {
      const now = Date.now();
      const delay = Math.max(0, bucket.minIntervalMs - (now - bucket.lastRun));
      if (delay > 0) {
        bucket.delayed += 1;
        await wait(delay);
      }
      bucket.lastRun = Date.now();
      bucket.calls += 1;
      return task();
    });
    bucket.queue = run.catch(() => undefined);
    return run;
  }

  function status() {
    return Object.fromEntries(
      Object.entries(state).map(([key, item]) => [
        key,
        {
          label: item.label,
          minIntervalMs: item.minIntervalMs,
          calls: item.calls,
          delayed: item.delayed,
          lastRunAt: item.lastRun ? new Date(item.lastRun).toISOString() : null,
        },
      ])
    );
  }

  return {
    schedule,
    status,
  };
}
