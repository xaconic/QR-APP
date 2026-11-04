const RETRY_DELAYS_MS = [300, 800];

export function isTransientNetworkError(error: unknown): boolean {
  if (typeof error === 'string') {
    return /network request failed|failed to fetch|networkerror|timed? ?out|connection (?:reset|refused|lost)|econnreset|socket hang up/i
      .test(error);
  }
  if (typeof error !== 'object' || error === null) return false;

  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : '';
  return /network request failed|failed to fetch|networkerror|timed? ?out|connection (?:reset|refused|lost)|econnreset|socket hang up/i
    .test(message);
}

export function shouldRetryRequest(method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return normalizedMethod === 'GET' || normalizedMethod === 'HEAD';
}

export async function retryTransientNetworkRequest<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await request();
      if (typeof result === 'object' && result !== null && 'error' in result && isTransientNetworkError(result.error)) {
        throw result.error;
      }
      return result;
    } catch (error) {
      if (!isTransientNetworkError(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}
