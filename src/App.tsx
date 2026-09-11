import { useEffect, useState } from 'react';
import { loadModel } from './boot';
import type { FeedModel } from './store/feedModel';
import { Game } from './ui/Game';

type Boot =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly model: FeedModel };

export function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadModel().then(
      (model) => {
        if (!cancelled) setBoot({ status: 'ready', model });
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

  if (boot.status === 'ready') return <Game model={boot.model} />;

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
