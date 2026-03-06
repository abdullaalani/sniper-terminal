import CryptoJS from 'crypto-js';

const STORAGE_KEY = 'sniper_terminal_secrets';

export const saveEncryptedKeys = (apiKey: string, apiSecret: string, password: string): boolean => {
  try {
    const data = JSON.stringify({ apiKey, apiSecret });
    const encrypted = CryptoJS.AES.encrypt(data, password).toString();
    localStorage.setItem(STORAGE_KEY, encrypted);
    return true;
  } catch (e) {
    console.error("Encryption failed", e);
    return false;
  }
};

export const getDecryptedKeys = (password: string): { apiKey: string; apiSecret: string } | null => {
  try {
    const encrypted = localStorage.getItem(STORAGE_KEY);
    if (!encrypted) return null;

    const bytes = CryptoJS.AES.decrypt(encrypted, password);
    const decryptedData = bytes.toString(CryptoJS.enc.Utf8);
    
    if (!decryptedData) return null; // Wrong password results in empty string usually

    return JSON.parse(decryptedData);
  } catch (e) {
    console.error("Decryption failed", e);
    return null;
  }
};

export const hasSavedKeys = (): boolean => {
  return !!localStorage.getItem(STORAGE_KEY);
};

export const clearKeys = () => {
  localStorage.removeItem(STORAGE_KEY);
};