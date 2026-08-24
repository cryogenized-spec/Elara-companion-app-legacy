type KVNamespace = {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  delete(key: string): Promise<void>;
};

export type CloudflareLockboxEnv = {
  GOOGLE_VAULT_KV: KVNamespace;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_OAUTH_REDIRECT_URI: string;
  GEMINI_API_KEY: string;
  ELARA_BACKGROUND_TOKEN: string;
};

function requiredString(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Required Lockbox binding ${key} is not configured.`);
  return value.trim();
}

export function createCloudflareLockbox(env: CloudflareLockboxEnv) {
  return {
    googleOAuthClientId: () => requiredString(env, 'GOOGLE_OAUTH_CLIENT_ID'),
    googleOAuthClientSecret: () => requiredString(env, 'GOOGLE_OAUTH_CLIENT_SECRET'),
    googleOAuthRedirectUri: () => requiredString(env, 'GOOGLE_OAUTH_REDIRECT_URI'),
    googleVaultKv: () => env.GOOGLE_VAULT_KV,
    geminiApiKey: () => requiredString(env, 'GEMINI_API_KEY'),
    backgroundToken: () => requiredString(env, 'ELARA_BACKGROUND_TOKEN'),
  };
}
