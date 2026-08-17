const yieldToMain = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<void> {
  const cap = Math.max(1, Math.floor(concurrency));
  let next = 0;
  const total = tasks.length;
  if (total === 0) return Promise.resolve();

  return new Promise((resolve) => {
    let active = 0;
    let done = 0;

    const launchNext = () => {
      while (active < cap && next < total) {
        const i = next++;
        active++;
        const task = tasks[i];
        Promise.resolve()
          .then(task)
          .then(() => yieldToMain())
          .catch(() => undefined)
          .finally(() => {
            active--;
            done++;
            if (done >= total) resolve();
            else launchNext();
          });
      }
    };

    launchNext();
  });
}
