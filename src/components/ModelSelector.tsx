import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ElaraSettings } from '../types';
import { AVAILABLE_MODELS } from '../types';

interface ModelSelectorProps {
  settings: ElaraSettings;
  onUpdateSettings?: (patch: Partial<ElaraSettings>) => void;
  disabled?: boolean;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ settings, onUpdateSettings, disabled = false }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        const trigger = rootRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
        trigger?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const options = useMemo(() => {
    const ids = [settings.model, ...(settings.reliabilitySettings?.fallbackModels || [])]
      .map((model) => model.trim())
      .filter(Boolean)
      .filter((model, index, list) => list.findIndex((item) => item.toLowerCase() === model.toLowerCase()) === index);
    return ids;
  }, [settings.model, settings.reliabilitySettings?.fallbackModels]);

  const currentMeta = AVAILABLE_MODELS.find((model) => model.id.toLowerCase() === settings.model.trim().toLowerCase());
  const currentLabel = currentMeta?.name || `${settings.model} (unavailable)`;

  const selectModel = (model: string) => {
    if (!onUpdateSettings || disabled) return;
    onUpdateSettings({ model });
    setOpen(false);
  };

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Selected model: ${currentLabel}`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-9 max-w-[12rem] items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950/90 px-2.5 text-[11px] font-semibold text-zinc-200 shadow-lg backdrop-blur-sm transition hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-[14rem]"
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="listbox" aria-label="Preferred models" className="absolute bottom-full left-0 z-[60] mb-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950/98 p-1.5 shadow-2xl backdrop-blur-xl">
          <div className="px-2.5 py-1.5 text-[9px] uppercase tracking-[0.16em] text-zinc-600">Preferred order</div>
          {options.map((model, index) => {
            const meta = AVAILABLE_MODELS.find((item) => item.id.toLowerCase() === model.toLowerCase());
            const selected = model.toLowerCase() === settings.model.trim().toLowerCase();
            return (
              <button
                key={model}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectModel(model)}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${selected ? 'bg-sky-950/40 text-sky-200' : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[9px] text-zinc-500">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium">{meta?.name || `${model} (unavailable)`}</span>
                  {!meta && <span className="block text-[9px] text-amber-500/80">Still configured; not present in the current catalogue.</span>}
                </span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-sky-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
