/**
 * Which positions have been answered, as a bitmap over position indices. Port of
 * `AnsweredPositions.swift`: about 3 KB for 25,000 positions, stored as base64.
 */
export class AnsweredSet {
  private bytes: Uint8Array;

  constructor(bytes: Uint8Array = new Uint8Array(0)) {
    this.bytes = bytes;
  }

  contains(index: number): boolean {
    if (!Number.isInteger(index) || index < 0) return false;
    const byte = index >> 3;
    return byte < this.bytes.length && (this.bytes[byte] & (1 << (index & 7))) !== 0;
  }

  insert(index: number): void {
    if (!Number.isInteger(index) || index < 0) return;
    const byte = index >> 3;
    if (byte >= this.bytes.length) {
      const grown = new Uint8Array(byte + 1);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[byte] |= 1 << (index & 7);
  }

  clear(): void {
    this.bytes = new Uint8Array(0);
  }

  /** Forgets indices at or beyond `count`, which no longer name a position. */
  truncate(count: number): void {
    const keep = Math.ceil(Math.max(0, count) / 8);
    if (this.bytes.length > keep) this.bytes = this.bytes.slice(0, keep);
    const remainder = count % 8;
    if (remainder > 0 && keep > 0 && keep <= this.bytes.length) {
      this.bytes[keep - 1] &= (1 << remainder) - 1;
    }
  }

  /** True once every index in `0..count-1` is answered: the feed then starts a new round. */
  isComplete(count: number): boolean {
    if (count <= 0) return false;
    const full = count >> 3;
    const remainder = count & 7;
    if (this.bytes.length < full + (remainder > 0 ? 1 : 0)) return false;
    for (let i = 0; i < full; i++) if (this.bytes[i] !== 0xff) return false;
    if (remainder > 0) {
      const mask = (1 << remainder) - 1;
      if ((this.bytes[full] & mask) !== mask) return false;
    }
    return true;
  }

  toBase64(): string {
    let binary = '';
    for (const b of this.bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  static fromBase64(text: string | null): AnsweredSet {
    if (!text) return new AnsweredSet();
    try {
      const binary = atob(text);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new AnsweredSet(bytes);
    } catch {
      return new AnsweredSet();
    }
  }
}
