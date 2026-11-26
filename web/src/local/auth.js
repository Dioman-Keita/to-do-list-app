// Mot de passe du journal autonome : même empreinte que le serveur (scrypt, dans settings.password_hash),
// donc une sauvegarde du PC s'ouvre sur le téléphone avec le même mot de passe, et inversement.
// Pas de cookie : le journal est déverrouillé en mémoire, et se reverrouille à chaque lancement.
import { scryptAsync } from '@noble/hashes/scrypt.js';

const SCRYPT = { N: 16384, r: 8, p: 1 };
const MIN_LENGTH = 4;
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await scryptAsync(String(password), salt, { ...SCRYPT, dkLen: 64 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${b64(salt)}$${b64(key)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, N, r, p, salt, key] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = unb64(key);
  const actual = await scryptAsync(String(password ?? ''), unb64(salt), { N: Number(N), r: Number(r), p: Number(p), dkLen: expected.length });
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0 && actual.length === expected.length;
}

export function checkNewPassword(password) {
  const p = String(password ?? '');
  if (p.length < MIN_LENGTH) return `Le mot de passe doit faire au moins ${MIN_LENGTH} caractères.`;
  if (p.length > 200) return 'Le mot de passe est trop long.';
  return null;
}

// Limite des essais : 10 erreurs en 15 minutes.
const failures = [];
export function tooManyAttempts() {
  const now = Date.now();
  while (failures.length && now - failures[0] > 15 * 60 * 1000) failures.shift();
  return failures.length >= 10;
}
export const recordFailure = () => failures.push(Date.now());
export const clearFailures = () => (failures.length = 0);
