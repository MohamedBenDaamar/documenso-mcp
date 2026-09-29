import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTokenCipher } from "../src/crypto/token-cipher.js";
import { TOKEN_A, USER_A } from "./fixtures.js";

const rows = new Map<string, Record<string, unknown>>();

// The store only calls from(...).select(...).eq(...).maybeSingle() for reads, so a small stand-in is enough.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: async () => ({ data: rows.get(userId) ?? null, error: null }),
        }),
      }),
    }),
  }),
}));

const { createSupabaseConnectionStore } = await import("../src/connections/store.js");

function storeWith(key: Buffer) {
  return createSupabaseConnectionStore({
    supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
    publishableKey: "sb_publishable_example",
    cipher: createTokenCipher(key),
  });
}

afterEach(() => {
  rows.clear();
  vi.restoreAllMocks();
});

describe("Supabase connection store", () => {
  it("decrypts the caller's row", async () => {
    const key = randomBytes(32);
    rows.set(USER_A.id, {
      token_ciphertext: createTokenCipher(key).encrypt(TOKEN_A, USER_A.id),
      token_hint: TOKEN_A.slice(-4),
      verified_at: "2026-09-29T10:00:00.000Z",
    });

    expect(await storeWith(key).get(USER_A)).toEqual({
      token: TOKEN_A,
      tokenHint: TOKEN_A.slice(-4),
      verifiedAt: "2026-09-29T10:00:00.000Z",
    });
  });

  it("treats a row encrypted with another key as not connected, without exposing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    rows.set(USER_A.id, {
      token_ciphertext: createTokenCipher(randomBytes(32)).encrypt(TOKEN_A, USER_A.id),
      token_hint: TOKEN_A.slice(-4),
      verified_at: "2026-09-29T10:00:00.000Z",
    });

    expect(await storeWith(randomBytes(32)).get(USER_A)).toBeNull();
    expect(warn).toHaveBeenCalledWith('{"event":"connection_undecryptable"}');
  });
});
