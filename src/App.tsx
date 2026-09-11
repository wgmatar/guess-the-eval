import { useEffect, useState } from 'react';
import { loadModel } from './boot';
import type { FeedModel } from './store/feedModel';
import type { SoundSetting } from './store/soundSetting';
import { Game } from './ui/Game';

type Boot =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly model: FeedModel; readonly sound: SoundSetting };

export function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadModel().then(
      ({ model, sound }) => {
        if (!cancelled) setBoot({ status: 'ready', model, sound });
      },
      (error: unknown) => {
        if (!cancelled) {
          setBoot({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (boot.status === 'ready') return <Game model={boot.model} sound={boot.sound} />;

  return (
    <div className="app">
      {boot.status === 'loading' ? (
        <div className="boot" role="status">
          <p>Loading positions…</p>
        </div>
      ) : (
        <div className="boot" role="alert">
          <p>Could not load the positions.</p>
          <p className="detail">{boot.message}</p>
          <button type="button" className="capsule retry" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
