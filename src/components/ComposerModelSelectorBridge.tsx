import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ElaraSettings } from '../types';
import { getDbSettings, setDbSettings } from '../lib/db';
import { ModelSelector } from './ModelSelector';

/**
 * Pass 21 bridge: mounts the canonical model selector into the existing
 * composer footer without duplicating model/reliability state.
 *
 * The selected model is persisted before the app reloads so the existing
 * App state hydrates from the canonical settings store and the next request
 * uses the newly selected model immediately.
 */
export const ComposerModelSelectorBridge: React.FC = () => {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState<ElaraSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    let retryTimer: number | undefined;

    const attach = () => {
      if (cancelled) return;
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Message Elara..."]');
      const footer = textarea?.closest('footer');
      if (!footer) {
        retryTimer = window.setTimeout(attach, 250);
        return;
      }

      const mount = document.createElement('div');
      mount.className = 'absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-[7.75rem] z-20 sm:right-[9.5rem]';
      mount.dataset.elaraModelSelectorMount = 'true';
      footer.appendChild(mount);
      setTarget(mount);

      observer = new MutationObserver(() => {
        if (!document.body.contains(footer)) {
          observer?.disconnect();
          observer = null;
          setTarget(null);
          retryTimer = window.setTimeout(attach, 250);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };

    attach();

    getDbSettings().then((loaded) => {
      if (!cancelled) setSettings(loaded);
    }).catch((error) => {
      console.warn('Model selector settings load deferred:', error);
    });

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      observer?.disconnect();
      setTarget(null);
    };
  }, []);

  if (!target || !settings) return null;

  return createPortal(
    <div className="w-[10rem] sm:w-[12rem]">
      <ModelSelector
        settings={settings}
        disabled={false}
        onUpdateSettings={(patch) => {
          const next = { ...settings, ...patch };
          setSettings(next);
          void setDbSettings(next).then(() => {
            // App owns the live runtime settings state. Reload after persistence
            // so its canonical state and the runtime model are updated together.
            window.location.reload();
          });
        }}
      />
    </div>,
    target,
  );
};
