import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export class CryptoService {
  private static masterKey: Buffer = Buffer.from(config.MASTER_ENCRYPTION_KEY, 'hex');

  /**
   * Hashes a user account password using bcrypt.
   */
  public static async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  /**
   * Verifies a user account password against a hash.
   */
  public static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Encrypts sensitive external provider credentials (e.g. passwords)
   * using AES-256-GCM authenticated encryption.
   * Returns a self-contained string formatted as "iv:authTag:ciphertext".
   */
  public static encrypt(plainText: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypts provider credentials using AES-256-GCM.
   * Accepts self-contained "iv:authTag:ciphertext" string.
   * Throws an error if authentication tag verification fails (detecting tampering).
   */
  public static decrypt(payload: string | EncryptedPayload): string {
    let ivHex: string;
    let authTagHex: string;
    let ciphertextHex: string;

    if (typeof payload === 'string') {
      const parts = payload.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted payload format');
      }
      [ivHex, authTagHex, ciphertextHex] = parts;
    } else {
      ivHex = payload.iv;
      authTagHex = payload.authTag;
      ciphertextHex = payload.ciphertext;
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Masks a login string for display in UI (e.g. "j***e@domain.com" or "u***1")
   */
  public static maskLogin(login: string): string {
    if (!login) return '****';
    if (login.includes('@')) {
      const [user, domain] = login.split('@');
      const maskedUser = user.length <= 2 
        ? user[0] + '***' 
        : user[0] + '***' + user[user.length - 1];
      return `${maskedUser}@${domain}`;
    }
    if (login.length <= 3) return login[0] + '***';
    return login.slice(0, 2) + '***' + login.slice(-2);
  }
}
