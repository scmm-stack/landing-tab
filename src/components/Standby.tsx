import { useEffect, useState } from 'react';
import type { Settings } from '../lib/model';
import { t } from '../lib/i18n';
import { Clock } from './Clock';

/** A full-screen clock that opens on a new tab, after inactivity, or both. */
export function useStandby(settings: Settings['standby'], paused: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(settings.enabled && settings.showOnNewTab);

  useEffect(() => {
    if (!settings.enabled) {
      setOpen(false);
      return;
    }
    if (paused || open) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setOpen(true), settings.inactivitySeconds * 1000);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    arm();
    for (const name of events) window.addEventListener(name, arm, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, arm);
    };
  }, [settings.enabled, settings.inactivitySeconds, paused, open]);

  return [open, () => setOpen(false)];
}

export function Standby({ settings, hour24, onDismiss }: { settings: Settings['standby']; hour24: boolean; onDismiss: () => void }) {
  useEffect(() => {
    const dismiss = () => onDismiss();
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [onDismiss]);

  return (
    <button
      type="button"
      className="standby"
      aria-label={t('standbyDismiss')}
      style={{ backdropFilter: `blur(${settings.blur}px)` }}
      onClick={onDismiss}
    >
      {settings.showClock && <Clock hour24={hour24} large />}
    </button>
  );
}
