import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  randomBytes,
  type KeyObject,
} from "node:crypto";

const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const VERSIONED_KEY_PATTERN = /^SESSION_ENCRYPTION_KEY_V([1-9]\d*)$/;

type RuntimeSecretEnvironment = Readonly<Record<string, string | undefined>>;

export type EncryptedSessionValue = {
  readonly ciphertext: Uint8Array;
  readonly keyVersion: number;
  readonly nonce: Uint8Array;
};

export class SessionEncryptionConfigurationError extends Error {
  constructor() {
    super("Session encryption runtime configuration is invalid.");
    this.name = "SessionEncryptionConfigurationError";
  }
}

export class SessionEncryptionError extends Error {
  constructor() {
    super("Session encryption failed.");
    this.name = "SessionEncryptionError";
  }
}

export class SessionDecryptionError extends Error {
  constructor() {
    super("Session decryption authentication failed.");
    this.name = "SessionDecryptionError";
  }
}

export class SessionKeyring {
  readonly currentVersion: number;
  private readonly keys: ReadonlyMap<number, KeyObject>;

  constructor(currentVersion: number, keys: ReadonlyMap<number, KeyObject>) {
    if (!Number.isSafeInteger(currentVersion) || !keys.has(currentVersion)) {
      throw new SessionEncryptionConfigurationError();
    }

    this.currentVersion = currentVersion;
    this.keys = new Map(keys);
  }

  keyFor(version: number): KeyObject {
    const key = this.keys.get(version);
    if (!key) {
      throw new SessionEncryptionConfigurationError();
    }

    return key;
  }
}

export function loadSessionKeyring(
  environment: RuntimeSecretEnvironment = process.env,
): SessionKeyring {
  const currentVersion = Number(
    environment.SESSION_ENCRYPTION_CURRENT_VERSION,
  );
  const keys = new Map<number, KeyObject>();

  for (const [name, encodedKey] of Object.entries(environment)) {
    const match = VERSIONED_KEY_PATTERN.exec(name);
    if (!match || !encodedKey) {
      continue;
    }

    const version = Number(match[1]);
    const keyBytes = Buffer.from(encodedKey, "base64");
    if (!Number.isSafeInteger(version) || keyBytes.byteLength !== AES_KEY_BYTES) {
      throw new SessionEncryptionConfigurationError();
    }

    keys.set(version, createSecretKey(keyBytes));
    keyBytes.fill(0);
  }

  return new SessionKeyring(currentVersion, keys);
}

function additionalData(userId: string): Buffer {
  if (userId.length === 0) {
    throw new SessionEncryptionError();
  }

  return Buffer.from(userId, "utf8");
}

export class AesGcmSessionCipher {
  constructor(private readonly keyring: SessionKeyring) {}

  encrypt(userId: string, plaintext: Uint8Array): EncryptedSessionValue {
    if (plaintext.byteLength === 0) {
      throw new SessionEncryptionError();
    }

    const keyVersion = this.keyring.currentVersion;
    const nonce = randomBytes(GCM_NONCE_BYTES);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.keyring.keyFor(keyVersion),
      nonce,
      { authTagLength: GCM_TAG_BYTES },
    );
    cipher.setAAD(additionalData(userId));

    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const framedCiphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);

    return {
      ciphertext: new Uint8Array(framedCiphertext),
      keyVersion,
      nonce: new Uint8Array(nonce),
    };
  }

  decrypt(userId: string, value: EncryptedSessionValue): Uint8Array {
    try {
      if (
        value.nonce.byteLength !== GCM_NONCE_BYTES ||
        value.ciphertext.byteLength <= GCM_TAG_BYTES
      ) {
        throw new SessionDecryptionError();
      }

      const framed = Buffer.from(value.ciphertext);
      const tagOffset = framed.byteLength - GCM_TAG_BYTES;
      const ciphertext = framed.subarray(0, tagOffset);
      const authenticationTag = framed.subarray(tagOffset);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.keyring.keyFor(value.keyVersion),
        value.nonce,
        { authTagLength: GCM_TAG_BYTES },
      );
      decipher.setAAD(additionalData(userId));
      decipher.setAuthTag(authenticationTag);

      return new Uint8Array(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]),
      );
    } catch {
      throw new SessionDecryptionError();
    }
  }
}
