import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { TokenCipher } from "../crypto/token-cipher.js";

/** A signed-in Supabase user, identified by a verified access token. */
export type UserSession = {
  id: string;
  accessToken: string;
};

export type DocumensoConnection = {
  token: string;
  tokenHint: string;
  verifiedAt: string;
};

export type ConnectionStore = {
  get(user: UserSession): Promise<DocumensoConnection | null>;
  save(user: UserSession, token: string, verifiedAt: Date): Promise<void>;
  remove(user: UserSession): Promise<void>;
};

/** Raised for any storage failure. Carries no Supabase error details, which can include SQL and schema names. */
export class ConnectionStoreError extends Error {
  constructor() {
    super("The Documenso connection could not be read or saved.");
    this.name = "ConnectionStoreError";
  }
}

const TABLE = "documenso_connections";

type StoreOptions = {
  supabaseUrl: string;
  publishableKey: string;
  cipher: TokenCipher;
};

export function tokenHint(token: string): string {
  return token.slice(-4);
}

/**
 * Stores connections in Supabase using the user's own access token, so row level security limits
 * every query to that user's row. The server holds no Supabase key that can bypass it.
 */
export function createSupabaseConnectionStore({ supabaseUrl, publishableKey, cipher }: StoreOptions): ConnectionStore {
  function clientFor(user: UserSession): SupabaseClient {
    return createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
    });
  }

  return {
    async get(user) {
      const { data, error } = await clientFor(user)
        .from(TABLE)
        .select("token_ciphertext, token_hint, verified_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        throw new ConnectionStoreError();
      }

      if (!data) {
        return null;
      }

      let token: string;

      try {
        token = cipher.decrypt(data.token_ciphertext, user.id);
      } catch {
        // Encrypted with another key (for example a different environment) or tampered with. Never use it,
        // and treat the user as not connected so linking a token again overwrites the row.
        console.warn(JSON.stringify({ event: "connection_undecryptable" }));
        return null;
      }

      return { token, tokenHint: data.token_hint, verifiedAt: data.verified_at };
    },

    async save(user, token, verifiedAt) {
      const { error } = await clientFor(user)
        .from(TABLE)
        .upsert(
          {
            user_id: user.id,
            token_ciphertext: cipher.encrypt(token, user.id),
            token_hint: tokenHint(token),
            verified_at: verifiedAt.toISOString(),
          },
          { onConflict: "user_id" },
        );

      if (error) {
        throw new ConnectionStoreError();
      }
    },

    async remove(user) {
      const { error } = await clientFor(user).from(TABLE).delete().eq("user_id", user.id);

      if (error) {
        throw new ConnectionStoreError();
      }
    },
  };
}
