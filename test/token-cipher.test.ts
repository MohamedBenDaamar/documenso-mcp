import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createTokenCipher } from "../src/crypto/token-cipher.js";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TOKEN = "api_teamatoken00000";

describe("token cipher", () => {
  const cipher = createTokenCipher(randomBytes(32));

  it("round-trips a token for the same user", () => {
    const payload = cipher.encrypt(TOKEN, USER_A);

    expect(payload.startsWith("v1.")).toBe(true);
    expect(payload).not.toContain(TOKEN);
    expect(cipher.decrypt(payload, USER_A)).toBe(TOKEN);
  });

  it("uses a fresh IV, so the same token never produces the same ciphertext", () => {
    expect(cipher.encrypt(TOKEN, USER_A)).not.toBe(cipher.encrypt(TOKEN, USER_A));
  });

  it("refuses to decrypt a ciphertext copied into another user's row", () => {
    const payload = cipher.encrypt(TOKEN, USER_A);

    expect(() => cipher.decrypt(payload, USER_B)).toThrow();
  });

  it("refuses a tampered ciphertext", () => {
    const [version, iv, data] = cipher.encrypt(TOKEN, USER_A).split(".");
    const bytes = Buffer.from(data!, "base64url");
    bytes[0] = bytes[0]! ^ 0xff;

    expect(() => cipher.decrypt(`${version}.${iv}.${bytes.toString("base64url")}`, USER_A)).toThrow();
  });

  it("refuses a ciphertext made with another key", () => {
    const payload = createTokenCipher(randomBytes(32)).encrypt(TOKEN, USER_A);

    expect(() => cipher.decrypt(payload, USER_A)).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => createTokenCipher(randomBytes(16))).toThrow("32 bytes");
  });
});
