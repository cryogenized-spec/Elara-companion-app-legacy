import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ElaraSettings } from '../types';
import { getDbSettings, setDbSettings } from '../lib/db';
import { ModelSelector } from './ModelSelector';
import { GeminiConnectionTester } from './GeminiConnectionTester';

/**
 * Mounts the canonical model selector and Gemini connection tester beside the
 * chat composer. The host is deterministic and fixed to the composer edge;
 * it does not depend on a fragile textarea/footer DOM selector.
 */
export const ComposerModelSelectorBridge: React.FC = () => {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState<ElaraSettings | null>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const mount = document.createElement('div');
    mount.className = 'fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-3 z-[170] sm:right-6';
    mount.dataset.elaraComposerControls = 'true';
    document.body.appendChild(mount);
    setTarget(mount);

    const refresh = () => {
      if (!cancelled) setStreaming(Boolean(document.querySelector('button[title="Stop generation"]')));
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'disabled'] });

    getDbSettings()
      .then((loaded) => { if (!cancelled) setSettings(loaded); })
      .catch((error) => console.warn('Composer model controls settings load deferred:', error));

    return () => {
      cancelled = true;
      observer.disconnect();
      if (mount.parentNode) mount.parentNode.removeChild(mount);
      setTarget(null);
    };
  }, []);

  if (!target || !settings) return null;

  return createPortal(
    <div className="flex items-center gap-1.5 rounded-2xl border border-zinc-800/90 bg-[#0a0a0a]/90 p-1 shadow-2xl backdrop-blur-xl">
      <ModelSelector
        settings={settings}
        disabled={streaming}
        onUpdateSettings={(patch) => {
          if (streaming) return;
          const next = { ...settings, ...patch };
          setSettings(next);
          void setDbSettings(next).then(() => window.location.reload());
        }}
      />
      <GeminiConnectionTester settings={settings} disabled={streaming} />
    </div>,
    target,
  );
};
