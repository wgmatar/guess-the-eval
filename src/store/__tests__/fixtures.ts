import { PositionSource, type Dataset } from '../../core/positions';
import { mulberry32 } from '../../core/sequencer';
import { AnswerStore } from '../answerStore';
import { FeedModel } from '../feedModel';
import { StatsStore } from '../statsStore';
import type { KeyValueStore } from '../storage';

export const GAME_URL = 'https://lichess.org/broadcast/tour/round-1/abcdefgh/ijklmnop';

export function makeDataset(
  count: number,
  name = 'test',
  evalFor = (i: number): unknown => (i % 7) / 4 - 0.75,
): Dataset {
  return {
    schema: 1,
    dataset: name,
    games: [{ w: 'A, B', b: 'C, D', we: 2600, be: 2600, y: 2024, url: GAME_URL }],
    positions: Array.from({ length: count }, (_, i) => [
      0,
      `8/8/8/8/8/8/8/8 w - - 0 ${i + 1}`,
      evalFor(i),
    ]),
  };
}

export function launch(
  store: KeyValueStore,
  source: PositionSource,
  seed = 1,
  onExact?: () => void,
) {
  const answers = new AnswerStore(store, source.datasetName, source.count);
  return new FeedModel(source, answers, new StatsStore(store), mulberry32(seed), onExact);
}

export const sourceOf = (count: number, name?: string) =>
  new PositionSource(makeDataset(count, name));

/** Plays `n` positions, returning the position index served on each. */
export function play(model: FeedModel, n: number): number[] {
  const served: number[] = [];
  for (let i = 0; i < n; i++) {
    const page = model.page(model.lastPage);
    if (!page) throw new Error(`the feed ran out after ${i}`);
    served.push(page.position.index);
    model.submit();
  }
  return served;
}
