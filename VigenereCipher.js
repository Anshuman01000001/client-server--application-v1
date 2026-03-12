// VigenereCipher.js - Vigenère cipher for ASCII printable characters (32-126)

const ALPHABET_SIZE = 95; // ASCII 32-126
const BASE = 32;

function encrypt(plaintext, key) {
  if (!key || key.length < 10) {
    throw new Error('Key must be at least 10 characters');
  }
  let result = '';
  for (let i = 0; i < plaintext.length; i++) {
    let charCode = plaintext.charCodeAt(i);
    let keyCode = key.charCodeAt(i % key.length);
    let shift = keyCode - BASE;
    let newCode = ((charCode - BASE + shift) % ALPHABET_SIZE + ALPHABET_SIZE) % ALPHABET_SIZE + BASE;
    result += String.fromCharCode(newCode);
  }
  return result;
}

function decrypt(ciphertext, key) {
  if (!key || key.length < 10) {
    throw new Error('Key must be at least 10 characters');
  }
  let result = '';
  for (let i = 0; i < ciphertext.length; i++) {
    let charCode = ciphertext.charCodeAt(i);
    let keyCode = key.charCodeAt(i % key.length);
    let shift = keyCode - BASE;
    let newCode = ((charCode - BASE - shift) % ALPHABET_SIZE + ALPHABET_SIZE) % ALPHABET_SIZE + BASE;
    result += String.fromCharCode(newCode);
  }
  return result;
}

module.exports = { encrypt, decrypt };
