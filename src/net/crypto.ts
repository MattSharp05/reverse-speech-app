/**
 * Private messages over a broadcast channel (Game Night). Everyone in a room hears every
 * message, so what's meant for one player is sealed for them: each phone and the TV have an
 * ECDH P-256 key pair, and each phone–TV pair derives an AES-GCM key nobody else can. Sealing
 * also proves who sent a message, so nobody can act as another player.
 *
 * WebCrypto needs a secure context (HTTPS or localhost). On a plain-http LAN dev server there's
 * none: `cryptoAvailable()` is false and messages travel unsealed (dev only).
 */

export interface Sealed {
  iv: string;
  ct: string;
}

export interface Identity {
  /** Public key, raw, base64: shared with the room. */
  pub: string;
  privateKey: CryptoKey;
}

export interface SavedIdentity {
  pub: string;
  priv: JsonWebKey;
}

const subtle = (): SubtleCrypto | undefined => globalThis.crypto?.subtle;
export const cryptoAvailable = (): boolean => subtle() !== undefined;

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function newIdentity(): Promise<{ identity: Identity; saved: SavedIdentity }> {
  const pair = await subtle()!.generateKey(ECDH, true, ['deriveKey']);
  const pub = toBase64(await subtle()!.exportKey('raw', pair.publicKey));
  const priv = await subtle()!.exportKey('jwk', pair.privateKey);
  return { identity: { pub, privateKey: pair.privateKey }, saved: { pub, priv } };
}

export async function loadIdentity(saved: SavedIdentity): Promise<Identity> {
  const privateKey = await subtle()!.importKey('jwk', saved.priv, ECDH, true, ['deriveKey']);
  return { pub: saved.pub, privateKey };
}

/** The key two ends share: mine (private) with theirs (public). */
export async function sharedKey(mine: Identity, theirs: string): Promise<CryptoKey> {
  const publicKey = await subtle()!.importKey('raw', fromBase64(theirs), ECDH, false, []);
  return subtle()!.deriveKey({ name: 'ECDH', public: publicKey }, mine.privateKey, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = await subtle()!.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: toBase64(iv), ct: toBase64(ct) };
}

/** The sealed value, or null when it wasn't sealed with this key (or was tampered with). */
export async function unseal(key: CryptoKey, sealed: Sealed): Promise<unknown> {
  try {
    const data = await subtle()!.decrypt({ name: 'AES-GCM', iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.ct));
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
}
