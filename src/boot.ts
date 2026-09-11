import { parseDataset, PositionSource } from './core/positions';
import { mulberry32, randomSeed } from './core/sequencer';
import { AnswerStore } from './store/answerStore';
import { FeedModel } from './store/feedModel';
import { SoundSetting } from './store/soundSetting';
import { StatsStore } from './store/statsStore';
import { browserStore, clearAll } from './store/storage';

/**
 * Builds the app's model. `?reset` forgets stored progress, `?seed=N` makes the deal
 * reproducible, and the dataset is fetched once (GitHub Pages serves it compressed).
 */
export async function loadModel(): Promise<{ model: FeedModel; sound: SoundSetting }> {
  const url = new URL(window.location.href);
  const store = browserStore();
  if (url.searchParams.has('reset')) {
    clearAll(store);
    url.searchParams.delete('reset');
    window.history.replaceState(null, '', url);
  }
  const response = await fetch(`${import.meta.env.BASE_URL}positions.json`);
  if (!response.ok) throw new Error(`positions.json: HTTP ${response.status}`);
  const source = new PositionSource(parseDataset(await response.json()));
  const seedParam = url.searchParams.get('seed');
  const seed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) : randomSeed();
  const answers = new AnswerStore(store, source.datasetName, source.count);
  // One short buzz on gold, where the platform allows it (Android); iOS Safari has no vibrate.
  const buzz = () => void navigator.vibrate?.(30);
  const model = new FeedModel(source, answers, new StatsStore(store), mulberry32(seed), buzz);
  return { model, sound: new SoundSetting(store) };
}
