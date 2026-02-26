export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

export interface RetryDependencies {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function computeBackoffDelay(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random
): number {
  const exponential = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
  const jitter = Math.floor(random() * policy.jitterMs);
  return exponential + jitter;
}

export async function waitBeforeRetry(
  attempt: number,
  policy: RetryPolicy,
  dependencies: RetryDependencies = {}
): Promise<void> {
  const sleep = dependencies.sleep ?? defaultSleep;
  const random = dependencies.random ?? Math.random;
  const delay = computeBackoffDelay(attempt, policy, random);
  await sleep(delay);
}
