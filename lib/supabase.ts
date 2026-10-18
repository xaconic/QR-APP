import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const REQUEST_TIMEOUT_MS = 15000;
const WEB_SESSION_PERSISTENCE_KEY = 'acadence.remember-session';
const NATIVE_SESSION_PERSISTENCE_KEY = 'acadence-remember-session';

const WebStorageAdapter = {
  getItem: async (key: string) => {
    if (typeof window === 'undefined') return null;
    if (window.localStorage.getItem(WEB_SESSION_PERSISTENCE_KEY) !== 'true') {
      window.localStorage.removeItem(key);
      return null;
    }
    return window.localStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (typeof window !== 'undefined') {
      if (window.localStorage.getItem(WEB_SESSION_PERSISTENCE_KEY) === 'true') {
        window.localStorage.setItem(key, value);
      } else {
        window.localStorage.removeItem(key);
      }
    }
  },
  removeItem: async (key: string) => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(key);
    }
  },
};

const SECURE_STORE_CHUNK_BYTES = 1800;
const secureStoreManifestKey = (key: string) => `${key}.chunk-count`;
const secureStoreChunkKey = (key: string, index: number) => `${key}.chunk.${index}`;

async function removeNativeItem(key: string) {
  const manifestKey = secureStoreManifestKey(key);
  const manifest = await SecureStore.getItemAsync(manifestKey);
  const chunkCount = Number(manifest);
  await SecureStore.deleteItemAsync(key);
  await SecureStore.deleteItemAsync(manifestKey);
  if (Number.isInteger(chunkCount) && chunkCount > 0) {
    await Promise.all(
      Array.from({ length: chunkCount }, (_, index) => SecureStore.deleteItemAsync(secureStoreChunkKey(key, index))),
    );
  }
}

function splitSecureStoreValue(value: string) {
  const chunks: string[] = [];
  let chunk = '';
  let byteLength = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const characterBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (byteLength + characterBytes > SECURE_STORE_CHUNK_BYTES) {
      chunks.push(chunk);
      chunk = '';
      byteLength = 0;
    }
    chunk += character;
    byteLength += characterBytes;
  }

  if (chunk || chunks.length === 0) chunks.push(chunk);
  return chunks;
}

const NativeSecureStoreAdapter = {
  getItem: async (key: string) => {
    if (await SecureStore.getItemAsync(NATIVE_SESSION_PERSISTENCE_KEY) !== 'true') {
      await removeNativeItem(key);
      return null;
    }
    const manifest = await SecureStore.getItemAsync(secureStoreManifestKey(key));
    if (!manifest) return SecureStore.getItemAsync(key);

    const chunkCount = Number(manifest);
    if (!Number.isInteger(chunkCount) || chunkCount < 1) {
      throw new Error('Saved authentication data has an invalid secure-storage manifest.');
    }
    const chunks = await Promise.all(
      Array.from({ length: chunkCount }, (_, index) => SecureStore.getItemAsync(secureStoreChunkKey(key, index))),
    );
    if (chunks.some((chunk) => chunk === null)) {
      throw new Error('Saved authentication data is incomplete in secure storage.');
    }
    return chunks.join('');
  },
  setItem: async (key: string, value: string) => {
    if (await SecureStore.getItemAsync(NATIVE_SESSION_PERSISTENCE_KEY) !== 'true') {
      await removeNativeItem(key);
      return;
    }
    const manifestKey = secureStoreManifestKey(key);
    const previousCountValue = await SecureStore.getItemAsync(manifestKey);
    const previousCount = Number(previousCountValue);
    const chunks = splitSecureStoreValue(value);

    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(secureStoreChunkKey(key, index), chunk)));
    await SecureStore.setItemAsync(manifestKey, String(chunks.length));
    await SecureStore.deleteItemAsync(key);

    if (Number.isInteger(previousCount) && previousCount > chunks.length) {
      await Promise.all(
        Array.from({ length: previousCount - chunks.length }, (_, index) =>
          SecureStore.deleteItemAsync(secureStoreChunkKey(key, chunks.length + index)),
        ),
      );
    }
  },
  removeItem: removeNativeItem,
};

const storage = Platform.OS === 'web' ? WebStorageAdapter : NativeSecureStoreAdapter;

export async function setSessionPersistence(remember: boolean) {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    if (remember) window.localStorage.setItem(WEB_SESSION_PERSISTENCE_KEY, 'true');
    else window.localStorage.removeItem(WEB_SESSION_PERSISTENCE_KEY);
    return;
  }

  if (remember) await SecureStore.setItemAsync(NATIVE_SESSION_PERSISTENCE_KEY, 'true');
  else await SecureStore.deleteItemAsync(NATIVE_SESSION_PERSISTENCE_KEY);
}

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const requestSignal = init?.signal;
  let timedOut = false;
  const abortRequest = () => controller.abort();

  if (requestSignal?.aborted) abortRequest();
  else requestSignal?.addEventListener('abort', abortRequest, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error('The request timed out. Check your connection and try again.', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener('abort', abortRequest);
  }
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn('Supabase environment variables are missing. The app will still start, but auth/database features will not work until the .env file is configured.');
}

export const supabaseSignUpClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
    storageKey: 'qr-attendance-signup',
  },
});

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
