import { type FocusEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { saveShortcut, storingImages } from '../lib/actions';
import { canLookUp, findSiteIcon, hasSiteAccess, requestSiteAccess } from '../lib/favicon';
import { t } from '../lib/i18n';
import { MAX_TILE_IMAGE_BYTES, isAllowedImage, saveImage } from '../lib/images';
import { LETTER_COLORS, type Shortcut, type Tile, lettersFor, pickColor } from '../lib/model';
import { completeUrl } from '../lib/normalize';
import { newId, update, useAppState } from '../lib/store';
import { TileFace } from './Tile';
import { Field, Slider, useFeedback } from './ui';

/** How long Save waits for an image still on its way, before saving without it. */
const LOOKUP_WAIT_MS = 3000;

/** The browser holds this, so it's asked rather than copied into settings. */
export function useSiteAccess() {
  const [access, setAccess] = useState<boolean | null>(null);
  useEffect(() => {
    void hasSiteAccess()
      .then(setAccess)
      .catch(() => setAccess(false));
  }, []);
  return [access, setAccess] as const;
}

export interface Draft {
  url: string;
  title: string;
  note: string;
  groupId: string;
}

interface Props {
  shortcut?: Shortcut;
  groupId: string;
  showGroupPicker?: boolean;
  popup?: boolean;
  initial?: { url: string; title: string; note?: string };
  /** Set where a file dialog would close the form, so it moves somewhere safe first. */
  onNeedWindow?: (draft: Draft) => void;
  onDone: (saved: boolean) => void;
}

interface PickedImage {
  blob: Blob;
  source: 'file' | 'website';
}

export function ShortcutForm({ shortcut, groupId, showGroupPicker, popup = false, initial, onNeedWindow, onDone }: Props) {
  const { dashboard, settings } = useAppState();
  const { toast } = useFeedback();
  const [access, setAccess] = useSiteAccess();
  const lookupsAllowed = settings.grid.websiteImages && access === true;
  const [url, setUrl] = useState(shortcut?.url ?? initial?.url ?? '');
  const [title, setTitle] = useState(shortcut?.title ?? initial?.title ?? '');
  const [note, setNote] = useState(shortcut?.note ?? initial?.note ?? '');
  const [letters, setLetters] = useState(shortcut?.tile.kind === 'letter' ? shortcut.tile.text : '');
  const [color, setColor] = useState(shortcut?.color ?? '');
  const [targetGroup, setTargetGroup] = useState(groupId);
  const [kind, setKind] = useState<Tile['kind']>(shortcut?.tile.kind ?? 'letter');
  const [scale, setScale] = useState(shortcut?.tile.kind === 'image' ? shortcut.tile.scale : 100);
  // A newly chosen image stays in memory until Save, so cancelling leaves nothing behind.
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lookup = useRef<{ url: string; result: Promise<Blob | null> } | null>(null);
  const lettersChosen = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const closed = useRef(false);

  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  const pickedBlob = picked?.blob ?? null;
  useEffect(() => {
    if (!pickedBlob) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(pickedBlob);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [pickedBlob]);

  const existingImageId = shortcut?.tile.kind === 'image' ? shortcut.tile.imageId : null;
  const hasImage = picked !== null || existingImageId !== null;
  const showingImage = kind === 'image' && hasImage;
  const shownColor = color || (showingImage ? '#ffffff' : pickColor(title || url));
  const previewTile: Tile = showingImage
    ? { kind: 'image', imageId: existingImageId ?? '', scale }
    : { kind: 'letter', text: letters || lettersFor(title) };
  // Editing never looks anything up by itself, so "Use image" is how a letter tile asks.
  const canUseImage = !showingImage && (hasImage || (shortcut !== undefined && settings.grid.websiteImages && !notFound));

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    if (!isAllowedImage(file)) toast(t('imageTypeUnsupported'));
    else if (file.size > MAX_TILE_IMAGE_BYTES) toast(t('imageTooLarge', '2 MB'));
    else {
      setPicked({ blob: file, source: 'file' });
      setKind('image');
    }
  };

  /** An image someone set themselves is never replaced. Each address is looked up once. */
  const findImage = (target: string | null): Promise<Blob | null> => {
    if (!target || !canLookUp(target) || picked?.source === 'file' || existingImageId) return Promise.resolve(null);
    if (lookup.current?.url === target) return lookup.current.result;
    setFinding(true);
    setNotFound(false);
    const entry = { url: target, result: Promise.resolve<Blob | null>(null) };
    entry.result = findSiteIcon(target)
      .catch(() => null)
      .then((blob) => {
        if (lookup.current !== entry) return null; // The address changed while this ran.
        setFinding(false);
        setNotFound(blob === null);
        if (blob) {
          setPicked((current) => (current?.source === 'file' ? current : { blob, source: 'website' }));
          if (!lettersChosen.current) setKind('image');
        }
        return blob;
      });
    lookup.current = entry;
    return entry.result;
  };

  // The popup already knows the address, so nobody has to leave a field.
  useEffect(() => {
    if (initial && lookupsAllowed) void findImage(initial.url);
  }, [lookupsAllowed]);

  const changeUrl = (value: string) => {
    setUrl(value);
    setError('');
    lookup.current = null;
    setFinding(false);
    setNotFound(false);
    if (picked?.source === 'website') {
      setPicked(null);
      setKind('letter');
    }
  };

  const leaveUrlField = (e: FocusEvent<HTMLInputElement>) => {
    // Pressing Cancel or the X moves focus here too, and shouldn't contact the site.
    const next = e.relatedTarget;
    const closing = next === cancelButton.current || (next instanceof Element && next.matches('.modal-close'));
    if (shortcut || !lookupsAllowed || closing) return;
    void findImage(completeUrl(url));
  };

  const chooseLetters = () => {
    lettersChosen.current = true;
    setKind('letter');
  };

  const chooseImage = () => {
    lettersChosen.current = false;
    setKind('image');
    if (lookupsAllowed) void findImage(completeUrl(url));
  };

  const allowLookups = () => {
    // The permission prompt has to open directly from this click.
    void requestSiteAccess()
      .then((granted) => {
        setAccess(granted);
        if (granted) void findImage(completeUrl(url));
        else update('settings', (s) => void (s.grid.websiteImages = false));
      })
      .catch(() => setAccess(false));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const finalUrl = completeUrl(url);
    if (!finalUrl) {
      setError(t('urlInvalid'));
      return;
    }
    setSaving(true);
    // Save can arrive before the image does, or without the field ever losing focus.
    const wantsLookup = lookupsAllowed && (shortcut ? kind === 'image' : !lettersChosen.current);
    const giveUp = new Promise<null>((resolve) => setTimeout(resolve, LOOKUP_WAIT_MS, null));
    const found = wantsLookup ? await Promise.race([findImage(finalUrl), giveUp]) : null;
    if (closed.current) return; // Closing the form during that wait cancels the save.
    const blob = pickedBlob ?? found;

    const finalTitle = title.trim() || new URL(finalUrl).hostname.replace(/^www\./, '');
    const useImage = (kind === 'image' || (found && !lettersChosen.current)) && (blob || existingImageId);
    const imageId = useImage ? (blob ? newId() : existingImageId) : null;
    const tile: Tile = imageId ? { kind: 'image', imageId, scale } : { kind: 'letter', text: letters.trim() || lettersFor(finalTitle) };
    const fallbackColor = tile.kind === 'image' ? '#ffffff' : pickColor(finalTitle);
    try {
      await storingImages(async () => {
        if (blob && imageId) await saveImage(imageId, blob);
        saveShortcut({ id: shortcut?.id ?? newId(), title: finalTitle, url: finalUrl, note: note.trim(), tile, color: color || fallbackColor }, targetGroup);
      });
    } catch {
      toast(t('imageSaveFailed'));
      setSaving(false);
      return;
    }
    onDone(true);
  };

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <div className="form-top">
        <div className="tile-preview">
          <TileFace tile={previewTile} color={shownColor} previewUrl={showingImage ? previewUrl : null} fallbackLetters={lettersFor(title)} />
        </div>
        <div className="form-top-fields">
          <Field label={t('fieldUrl')}>
            <input
              value={url}
              required
              autoFocus
              inputMode="url"
              spellCheck={false}
              placeholder="example.com"
              onChange={(e) => changeUrl(e.target.value)}
              onBlur={leaveUrlField}
            />
          </Field>
          {error && <p className="error">{error}</p>}
          {finding && <p className="hint">{t('finding')}</p>}
          {settings.grid.websiteImages && access === false && (!shortcut || kind === 'image') &&
            // A permission prompt closes the popup, so the question is asked on the new tab page.
            (popup ? (
              <p className="hint">{t('websiteImagesInSettings')}</p>
            ) : (
              <div className="notice">
                <p className="hint">{t('websiteImagesAllow')}</p>
                <button type="button" onClick={allowLookups}>
                  {t('allow')}
                </button>
              </div>
            ))}
          <Field label={t('fieldName')}>
            <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
      </div>
      <Field label={t('fieldNote')}>
        <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {showGroupPicker && (
        <Field label={t('fieldGroup')}>
          <select value={targetGroup} onChange={(e) => setTargetGroup(e.target.value)}>
            {dashboard.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.symbol} {g.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="actions start" role="group" aria-label={t('fieldIcon')}>
        {onNeedWindow ? (
          <button type="button" onClick={() => onNeedWindow({ url, title, note, groupId: targetGroup })}>
            {t('chooseFile')}
          </button>
        ) : (
          <label className="button">
            {t('chooseFile')}
            <input
              type="file"
              className="visually-hidden"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon"
              onChange={(e) => {
                chooseFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        )}
        {showingImage && (
          <button type="button" onClick={chooseLetters}>
            {t('useLetters')}
          </button>
        )}
        {canUseImage && (
          <button type="button" onClick={chooseImage}>
            {t('useImage')}
          </button>
        )}
      </div>
      {notFound && !hasImage && <p className="hint">{t('websiteImageNotFound')}</p>}

      {showingImage ? (
        <Slider label={t('iconScale')} value={scale} min={20} max={150} unit="%" onChange={setScale} />
      ) : (
        <Field label={t('fieldIconText')}>
          <input value={letters} maxLength={3} placeholder={lettersFor(title)} onChange={(e) => setLetters(e.target.value)} />
        </Field>
      )}

      <div className="swatches" role="group" aria-label={t('fieldColor')}>
        {['#ffffff', ...LETTER_COLORS].map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            aria-label={c}
            aria-pressed={shownColor === c}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
          />
        ))}
        <input type="color" aria-label={t('fieldColor')} value={shownColor} onChange={(e) => setColor(e.target.value)} />
      </div>

      <div className="actions">
        <button
          type="button"
          ref={cancelButton}
          onClick={() => {
            closed.current = true;
            onDone(false);
          }}
        >
          {t('cancel')}
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {t('save')}
        </button>
      </div>
    </form>
  );
}
