import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ElaraSettings } from '../types';
import { getDbSettings, setDbSettings } from '../lib/db';
import { ModelSelector } from './ModelSelector';

/**
 * Pass 21 bridge: mounts the canonical model selector into the existing
 * composer footer without duplicating model or reliability state.
 */
export const ComposerModelSelectorBridge: React.FC = () => {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState<ElaraSettings | null>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let observer: MutationObserver | null = null;
    let mount: HTMLDivElement | null = null;

    const attach = () => {
      if (cancelled) return;
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Message Elara..."]');
      const footer = textarea?.closest('footer');
      if (!footer) {
        retryTimer = window.setTimeout(attach, 250);
        return;
      }

      mount = document.createElement('div');
      mount.className = 'absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-[7.75rem] z-20 sm:right-[9.5rem]';
      mount.dataset.elaraModelSelectorMount = 'true';
      footer.appendChild(mount);
      setTarget(mount);

      const refreshStreamingState = () => {
        if (cancelled) return;
        setStreaming(Boolean(footer.querySelector('button[title="Stop generation"]')));
      };
      refreshStreamingState();

      observer = new MutationObserver(refreshStreamingState);
      observer.observe(footer, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'disabled'] });
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
      observer = null;
      if (mount?.parentNode) mount.parentNode.removeChild(mount);
      mount = null;
      setTarget(null);
    };
  }, []);

  if (!target || !settings) return null;

  return createPortal(
    <div className="w-[10rem] sm:w-[12rem]">
      <ModelSelector
        settings={settings}
        disabled={streaming}
        onUpdateSettings={(patch) => {
          if (streaming) return;
          const next = { ...settings, ...patch };
          setSettings(next);
          void setDbSettings(next).then(() => {
            // App owns the live runtime settings state. Reload after persistence
            // so its canonical state and runtime model are updated together.
            window.location.reload();
          });
        }}
      />
    </div>,
    target,
  );
};
