import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTransientNetworkError,
  retryTransientNetworkRequest,
  shouldRetryRequest,
} from '../lib/networkRetry.ts';

test('retries transient network failures and returns the first successful result', async () => {
  let attempts = 0;
  const result = await retryTransientNetworkRequest(async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('Network request failed');
    return 'connected';
  });

  assert.equal(result, 'connected');
  assert.equal(attempts, 2);
});

test('does not retry non-network errors', async () => {
  let attempts = 0;
  await assert.rejects(retryTransientNetworkRequest(async () => {
    attempts += 1;
    throw new Error('Invalid login credentials');
  }), /Invalid login credentials/);

  assert.equal(attempts, 1);
});

test('retries transient errors returned by Supabase-style results', async () => {
  let attempts = 0;
  const result = await retryTransientNetworkRequest(async () => {
    attempts += 1;
    if (attempts === 1) return { data: null, error: new TypeError('Network request failed') };
    return { data: 'connected', error: null };
  });

  assert.deepEqual(result, { data: 'connected', error: null });
  assert.equal(attempts, 2);
});

test('does not retry authentication errors returned by Supabase', async () => {
  let attempts = 0;
  const result = await retryTransientNetworkRequest(async () => {
    attempts += 1;
    return { data: null, error: new Error('Invalid login credentials') };
  });

  assert.equal(result.error?.message, 'Invalid login credentials');
  assert.equal(attempts, 1);
});

test('retries transient profile errors returned as strings', async () => {
  let attempts = 0;
  const result = await retryTransientNetworkRequest(async () => {
    attempts += 1;
    if (attempts === 1) return { profile: null, error: 'Network request failed' };
    return { profile: { role: 'admin' }, error: null };
  });

  assert.deepEqual(result, { profile: { role: 'admin' }, error: null });
  assert.equal(attempts, 2);
});

test('recognizes transient network and timeout errors only', () => {
  assert.equal(isTransientNetworkError(new Error('The request timed out.')), true);
  assert.equal(isTransientNetworkError(new TypeError('Network request failed')), true);
  assert.equal(isTransientNetworkError(new Error('Invalid login credentials')), false);
  assert.equal(isTransientNetworkError(null), false);
});

test('retries only safe HTTP reads at the fetch level', () => {
  assert.equal(shouldRetryRequest('GET'), true);
  assert.equal(shouldRetryRequest('HEAD'), true);
  assert.equal(shouldRetryRequest('POST'), false);
  assert.equal(shouldRetryRequest('DELETE'), false);
});
