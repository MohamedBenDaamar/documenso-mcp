import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type TokenCipher = {
  encrypt(plaintext: string, userId: string): string;
  decrypt(payload: string, userId: string): string;
};

/**
 * AES-256-GCM encryption for stored Documenso tokens.
 *
 * The user ID is authenticated as additional data, so a ciphertext copied into another user's row
 * fails to decrypt instead of handing that user someone else's Documenso access.
 */
export function createTokenCipher(key: Buffer): TokenCipher {
  if (key.length !== 32) {
    throw new Error("The connection encryption key must be 32 bytes.");
  }

  const additionalData = (userId: string) => Buffer.from(`documenso-connection:${userId}`, "utf8");

  return {
    encrypt(plaintext, userId) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(additionalData(userId));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);

      return `${VERSION}.${iv.toString("base64url")}.${ciphertext.toString("base64url")}`;
    },

    decrypt(payload, userId) {
      const [version, ivPart, dataPart] = payload.split(".");

      if (version !== VERSION || !ivPart || !dataPart) {
        throw new Error("Unsupported connection ciphertext.");
      }

      const iv = Buffer.from(ivPart, "base64url");
      const data = Buffer.from(dataPart, "base64url");

      if (iv.length !== IV_BYTES || data.length <= TAG_BYTES) {
        throw new Error("Malformed connection ciphertext.");
      }

      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(additionalData(userId));
      decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));

      return Buffer.concat([decipher.update(data.subarray(0, data.length - TAG_BYTES)), decipher.final()]).toString(
        "utf8",
      );
    },
  };
}
