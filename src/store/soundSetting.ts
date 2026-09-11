import { KEYS, type KeyValueStore } from './storage';

/** Whether the reveal plays a sound. On unless the player turned it off. */
export class SoundSetting {
  private value: boolean;

  constructor(private readonly store: KeyValueStore) {
    this.value = store.get(KEYS.sound) !== 'off';
  }

  get on(): boolean {
    return this.value;
  }

  set(on: boolean): void {
    this.value = on;
    this.store.set(KEYS.sound, on ? 'on' : 'off');
  }
}
