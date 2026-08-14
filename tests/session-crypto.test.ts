import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AesGcmSessionCipher,
  loadSessionKeyring,
  SessionDecryptionError,
} from "@/src/lib/riot/session-crypto";

function runtimeSecrets(currentVersion: number, keys: Map<number, Buffer>) {
  return Object.fromEntries([
    ["SESSION_ENCRYPTION_CURRENT_VERSION", String(currentVersion)],
    ...[...keys].map(([version, key]) => [
      `SESSION_ENCRYPTION_KEY_V${version}`,
      key.toString("base64"),
    ]),
  ]);
}

function digest(value: Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

function sameValue(left: Uint8Array, right: Uint8Array): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

describe("AES-256-GCM session encryption", () => {
  it("round trips fixture material without exposing plaintext assertions", () => {
    const cipher = new AesGcmSessionCipher(
      loadSessionKeyring(runtimeSecrets(1, new Map([[1, randomBytes(32)]]))),
    );
    const plaintext = randomBytes(48);

    const decrypted = cipher.decrypt(
      "11111111-1111-4111-8111-111111111111",
      cipher.encrypt("11111111-1111-4111-8111-111111111111", plaintext),
    );

    expect(sameValue(decrypted, plaintext)).toBe(true);
  });

  it("uses a unique cryptographically secure nonce for each encryption", () => {
    const cipher = new AesGcmSessionCipher(
      loadSessionKeyring(runtimeSecrets(1, new Map([[1, randomBytes(32)]]))),
    );
    const plaintext = randomBytes(48);

    const first = cipher.encrypt(
      "11111111-1111-4111-8111-111111111111",
      plaintext,
    );
    const second = cipher.encrypt(
      "11111111-1111-4111-8111-111111111111",
      plaintext,
    );

    expect(timingSafeEqual(first.nonce, second.nonce)).toBe(false);
  });

  it("rejects ciphertext under the wrong user AAD", () => {
    const cipher = new AesGcmSessionCipher(
      loadSessionKeyring(runtimeSecrets(1, new Map([[1, randomBytes(32)]]))),
    );
    const encrypted = cipher.encrypt(
      "11111111-1111-4111-8111-111111111111",
      randomBytes(48),
    );

    expect(() =>
      cipher.decrypt("22222222-2222-4222-8222-222222222222", encrypted),
    ).toThrow(SessionDecryptionError);
  });

  it("rejects tampered ciphertext or authentication tags", () => {
    const cipher = new AesGcmSessionCipher(
      loadSessionKeyring(runtimeSecrets(1, new Map([[1, randomBytes(32)]]))),
    );
    const encrypted = cipher.encrypt(
      "11111111-1111-4111-8111-111111111111",
      randomBytes(48),
    );
    const tampered = {
      ...encrypted,
      ciphertext: new Uint8Array(encrypted.ciphertext),
    };
    tampered.ciphertext[tampered.ciphertext.length - 1] ^= 1;

    expect(() =>
      cipher.decrypt("11111111-1111-4111-8111-111111111111", tampered),
    ).toThrow(SessionDecryptionError);
  });

  it("decrypts old versions while encrypting new values with the current key", () => {
    const versionOneKey = randomBytes(32);
    const versionTwoKey = randomBytes(32);
    const oldCipher = new AesGcmSessionCipher(
      loadSessionKeyring(runtimeSecrets(1, new Map([[1, versionOneKey]]))),
    );
    const plaintext = randomBytes(48);
    const oldValue = oldCipher.encrypt(
      "11111111-1111-4111-8111-111111111111",
      plaintext,
    );
    const rotatedCipher = new AesGcmSessionCipher(
      loadSessionKeyring(
        runtimeSecrets(
          2,
          new Map([
            [1, versionOneKey],
            [2, versionTwoKey],
          ]),
        ),
      ),
    );

    const decryptedOldValue = rotatedCipher.decrypt(
      "11111111-1111-4111-8111-111111111111",
      oldValue,
    );
    const newValue = rotatedCipher.encrypt(
      "11111111-1111-4111-8111-111111111111",
      plaintext,
    );

    expect(sameValue(decryptedOldValue, plaintext)).toBe(true);
    expect(oldValue.keyVersion).toBe(1);
    expect(newValue.keyVersion).toBe(2);
  });
});
