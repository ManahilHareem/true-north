import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { argon2id } from 'hash-wasm';
import {
  EncryptedVaultPayload,
  VaultConfig,
  VaultKdfParams,
  VaultLoginItem,
  VaultLoginItemInput,
  VaultLoginSecretData,
  VaultSessionState,
} from '../models/interfaces';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const PASSWORD_VERIFIER = 'true-north-vault-verifier-v1';

@Injectable({ providedIn: 'root' })
export class VaultCryptoService {
  private readonly cryptoVersion = 1;
  private readonly defaultKdf: Omit<VaultKdfParams, 'salt'> = {
    algorithm: 'argon2id',
    iterations: 3,
    memorySize: 65536,
    parallelism: 1,
    hashLength: 32,
  };

  private vaultKeyBytes: Uint8Array | null = null;
  private sessionStateSubject = new BehaviorSubject<VaultSessionState>({
    isConfigured: false,
    isUnlocked: false,
    unlockedAt: null,
  });

  sessionState$ = this.sessionStateSubject.asObservable();

  get sessionState(): VaultSessionState {
    return this.sessionStateSubject.value;
  }

  setConfigured(isConfigured: boolean): void {
    this.sessionStateSubject.next({
      ...this.sessionState,
      isConfigured,
    });
  }

  clearSession(): void {
    if (this.vaultKeyBytes) {
      this.vaultKeyBytes.fill(0);
    }
    this.vaultKeyBytes = null;
    this.sessionStateSubject.next({
      ...this.sessionState,
      isUnlocked: false,
      unlockedAt: null,
    });
  }

  async initializeVault(masterPassword: string): Promise<{ config: Omit<VaultConfig, 'createdAt' | 'updatedAt'>; recoveryKey: string; }> {
    const salt = this.randomBytes(16);
    const vaultKey = this.randomBytes(32);
    const recoveryKey = this.formatRecoveryKey(this.bytesToBase64Url(this.randomBytes(32)));
    const passwordKey = await this.derivePasswordKey(masterPassword, salt);
    const recoveryKeyBytes = this.recoveryKeyToBytes(recoveryKey);

    const wrappedVaultKeyByPassword = await this.encryptBytes(vaultKey, passwordKey);
    const wrappedVaultKeyByRecovery = await this.encryptBytes(vaultKey, recoveryKeyBytes);
    const passwordVerifier = await this.encryptText(PASSWORD_VERIFIER, vaultKey);

    this.vaultKeyBytes = vaultKey;
    this.sessionStateSubject.next({
      isConfigured: true,
      isUnlocked: true,
      unlockedAt: Date.now(),
    });

    return {
      config: {
        cryptoVersion: this.cryptoVersion,
        kdf: {
          ...this.defaultKdf,
          salt: this.bytesToBase64(salt),
        },
        wrappedVaultKeyByPassword,
        wrappedVaultKeyByRecovery,
        passwordVerifier,
      },
      recoveryKey,
    };
  }

  async unlockWithPassword(masterPassword: string, config: VaultConfig): Promise<void> {
    const passwordKey = await this.derivePasswordKey(masterPassword, this.base64ToBytes(config.kdf.salt), config.kdf);
    const vaultKey = await this.decryptBytes(config.wrappedVaultKeyByPassword, passwordKey);
    await this.verifyVaultKey(vaultKey, config.passwordVerifier);
    this.vaultKeyBytes = vaultKey;
    this.sessionStateSubject.next({
      isConfigured: true,
      isUnlocked: true,
      unlockedAt: Date.now(),
    });
  }

  async recoverVault(recoveryKey: string, config: VaultConfig, newMasterPassword: string): Promise<Omit<VaultConfig, 'createdAt' | 'updatedAt'>> {
    const recoveryKeyBytes = this.recoveryKeyToBytes(recoveryKey);
    const vaultKey = await this.decryptBytes(config.wrappedVaultKeyByRecovery, recoveryKeyBytes);
    await this.verifyVaultKey(vaultKey, config.passwordVerifier);

    const newSalt = this.randomBytes(16);
    const passwordKey = await this.derivePasswordKey(newMasterPassword, newSalt);

    this.vaultKeyBytes = vaultKey;
    this.sessionStateSubject.next({
      isConfigured: true,
      isUnlocked: true,
      unlockedAt: Date.now(),
    });

    return {
      cryptoVersion: this.cryptoVersion,
      kdf: {
        ...this.defaultKdf,
        salt: this.bytesToBase64(newSalt),
      },
      wrappedVaultKeyByPassword: await this.encryptBytes(vaultKey, passwordKey),
      wrappedVaultKeyByRecovery: config.wrappedVaultKeyByRecovery,
      passwordVerifier: config.passwordVerifier,
    };
  }

  async encryptVaultItem(input: VaultLoginItemInput): Promise<Pick<VaultLoginItem, 'type' | 'title' | 'provider' | 'favorite' | 'tags' | 'encryptedPayload' | 'cryptoVersion'>> {
    const vaultKey = this.requireVaultKey();
    const encryptedPayload = await this.encryptText(JSON.stringify({
      username: input.username,
      password: input.password,
      url: input.url,
      notes: input.notes,
    }), vaultKey);

    return {
      type: 'login',
      title: input.title.trim(),
      provider: input.provider.trim(),
      favorite: input.favorite,
      tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
      encryptedPayload,
      cryptoVersion: this.cryptoVersion,
    };
  }

  async decryptVaultItem(item: VaultLoginItem): Promise<VaultLoginSecretData> {
    const vaultKey = this.requireVaultKey();
    const plaintext = await this.decryptText(item.encryptedPayload, vaultKey);
    const parsed = JSON.parse(plaintext);
    return {
      username: parsed.username || '',
      password: parsed.password || '',
      url: parsed.url || '',
      notes: parsed.notes || '',
    };
  }

  async decryptVaultItems(items: VaultLoginItem[]): Promise<Record<string, VaultLoginSecretData>> {
    const entries = await Promise.all(items
      .filter((item) => item.id)
      .map(async (item) => [item.id!, await this.decryptVaultItem(item)] as const));

    return Object.fromEntries(entries);
  }

  private async verifyVaultKey(vaultKey: Uint8Array, verifier: EncryptedVaultPayload): Promise<void> {
    const plaintext = await this.decryptText(verifier, vaultKey);
    if (plaintext !== PASSWORD_VERIFIER) {
      throw new Error('Invalid vault credentials.');
    }
  }

  private async derivePasswordKey(
    password: string,
    salt: Uint8Array,
    params?: VaultKdfParams,
  ): Promise<Uint8Array> {
    const kdf = params || { ...this.defaultKdf, salt: '' };
    const key = await argon2id({
      password,
      salt,
      parallelism: kdf.parallelism,
      iterations: kdf.iterations,
      memorySize: kdf.memorySize,
      hashLength: kdf.hashLength,
      outputType: 'binary',
    });
    return key as Uint8Array;
  }

  private async encryptText(plaintext: string, keyBytes: Uint8Array): Promise<EncryptedVaultPayload> {
    return this.encryptBytes(textEncoder.encode(plaintext), keyBytes);
  }

  private async decryptText(payload: EncryptedVaultPayload, keyBytes: Uint8Array): Promise<string> {
    const bytes = await this.decryptBytes(payload, keyBytes);
    return textDecoder.decode(bytes);
  }

  private async encryptBytes(plaintext: Uint8Array, keyBytes: Uint8Array): Promise<EncryptedVaultPayload> {
    const key = await crypto.subtle.importKey('raw', this.toArrayBuffer(keyBytes), 'AES-GCM', false, ['encrypt']);
    const iv = this.randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: this.toArrayBuffer(iv) },
      key,
      this.toArrayBuffer(plaintext),
    );
    return {
      iv: this.bytesToBase64(iv),
      ciphertext: this.bytesToBase64(new Uint8Array(ciphertext)),
    };
  }

  private async decryptBytes(payload: EncryptedVaultPayload, keyBytes: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', this.toArrayBuffer(keyBytes), 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.toArrayBuffer(this.base64ToBytes(payload.iv)) },
      key,
      this.toArrayBuffer(this.base64ToBytes(payload.ciphertext)),
    );
    return new Uint8Array(plaintext);
  }

  private requireVaultKey(): Uint8Array {
    if (!this.vaultKeyBytes) {
      throw new Error('Vault is locked.');
    }
    return this.vaultKeyBytes;
  }

  private randomBytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  private base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  private bytesToBase64Url(bytes: Uint8Array): string {
    return this.bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private base64UrlToBytes(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    return this.base64ToBytes(padded);
  }

  private recoveryKeyToBytes(value: string): Uint8Array {
    const normalized = value.replace(/-/g, '').trim();
    return this.base64UrlToBytes(normalized);
  }

  private formatRecoveryKey(value: string): string {
    return value.match(/.{1,4}/g)?.join('-') || value;
  }

  private toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
}
