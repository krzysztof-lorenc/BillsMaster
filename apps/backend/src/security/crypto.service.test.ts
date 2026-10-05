import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CryptoService } from './crypto.service.js';

describe('CryptoService', () => {
  test('should hash and verify user passwords', async () => {
    const rawPass = 'SecretP@ssw0rd123';
    const hash = await CryptoService.hashPassword(rawPass);

    assert.notEqual(rawPass, hash);
    assert.equal(await CryptoService.verifyPassword(rawPass, hash), true);
    assert.equal(await CryptoService.verifyPassword('WrongPass', hash), false);
  });

  test('should encrypt and decrypt provider credentials using AES-256-GCM', () => {
    const sensitivePassword = 'ExternalPortalPassword!99#';
    const encrypted = CryptoService.encrypt(sensitivePassword);

    assert.ok(typeof encrypted === 'string');
    const parts = encrypted.split(':');
    assert.equal(parts.length, 3); // iv : authTag : ciphertext
    assert.notEqual(parts[2], sensitivePassword);

    const decrypted = CryptoService.decrypt(encrypted);
    assert.equal(decrypted, sensitivePassword);
  });

  test('should reject tampered ciphertext with auth tag validation', () => {
    const sensitive = 'SampleSecret123';
    const encrypted = CryptoService.encrypt(sensitive);

    // Tamper with ciphertext
    const parts = encrypted.split(':');
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('a') ? 'b' : 'a');
    const tampered = parts.join(':');

    assert.throws(() => {
      CryptoService.decrypt(tampered);
    });
  });

  test('should mask logins correctly', () => {
    assert.equal(CryptoService.maskLogin('john.doe@example.com'), 'j***e@example.com');
    assert.equal(CryptoService.maskLogin('user1234'), 'us***34');
    assert.equal(CryptoService.maskLogin('ab'), 'a***');
  });
});
