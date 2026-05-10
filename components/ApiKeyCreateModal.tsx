'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {useRunMutation} from '@/lib/use-run-mutation';
import {useEscapeKey} from '@/lib/use-escape-key';
import {createApiKey, rotateApiKey, listApiKeys} from '@/app/actions/api-keys';
import {unwrapServerActionResult as unwrap} from '@/lib/server-action';
import type {ApiKeyMeta, ApiKeyCreated} from '@/app/actions/api-keys';

/**
 * PLAN1-TASKS-FEATURE-20260509 (S6 · M3 정합) — API key 발급 modal.
 *
 * 모드 분기:
 *   - rotateOldId === null → 'create' 모드 (신규 발급)
 *   - rotateOldId !== null → 'rotate' 모드 (24h grace warning + 옛 key 표시 + 새 key 발급)
 *
 * M3 정합: 발급 후 plain key 1회 노출 + 복사 버튼 + "복사 완료" checkbox 의무
 *   → checkbox 영영 close 버튼 enable trigger
 */

interface ApiKeyCreateModalProps {
  rotateOldId: string | null;
  rotateOldName: string;
  recentlyCreated: ApiKeyCreated | null;
  onClose: () => void;
  onCreated: (created: ApiKeyCreated, updatedList: ApiKeyMeta[]) => void;
}

export function ApiKeyCreateModal({
  rotateOldId,
  rotateOldName,
  recentlyCreated,
  onClose,
  onCreated
}: ApiKeyCreateModalProps) {
  const t = useTranslations();
  const runMutation = useRunMutation();

  const isRotate = rotateOldId !== null;
  const [name, setName] = useState<string>(isRotate ? rotateOldName : '');
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // recentlyCreated 박힘 영영 close 영영 confirmedSaved checkbox enable trigger.
  // recentlyCreated 박지 X 영영 (create 진행 영영) close 영영 자유.
  useEscapeKey(onClose, !busy && (recentlyCreated === null || confirmedSaved));

  const canCreate = name.trim().length > 0 && !busy;

  const handleCreate = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const action = isRotate
        ? rotateApiKey({oldId: rotateOldId, name: name.trim(), expiresInDays})
        : createApiKey({name: name.trim(), expiresInDays});
      runMutation(action, isRotate ? 'rotateApiKey' : 'createApiKey');
      const created = unwrap(await action);
      const updatedList = unwrap(await listApiKeys());
      onCreated(created, updatedList);
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!recentlyCreated) return;
    try {
      await navigator.clipboard.writeText(recentlyCreated.rawKey);
      setCopyState('copied');
    } catch {
      setCopyState('idle');
    }
  };

  const handleCloseClick = () => {
    if (recentlyCreated !== null && !confirmedSaved) return;
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-none border border-line bg-panel p-6 font-mono">
        <h2 className="mb-4 text-sm font-medium text-ink">
          {isRotate ? t('apiKey.modalRotateHeading') : t('apiKey.modalCreateHeading')}
        </h2>

        {recentlyCreated === null && (
          <>
            {isRotate && (
              <p className="mb-3 border border-danger bg-[rgba(224,108,117,0.1)] px-3 py-2 text-xs text-danger">
                {t('apiKey.rotateGraceWarning')}
              </p>
            )}
            <div className="mb-3">
              <label className="mb-1 block text-xs text-muted" htmlFor="apikey-name">
                {t('apiKey.fieldName')}
              </label>
              <input
                id="apikey-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={busy}
                className="w-full rounded-none border border-line bg-bg px-2 py-1 text-sm text-txt focus:border-ink focus:outline-none"
              />
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-xs text-muted" htmlFor="apikey-expires">
                {t('apiKey.fieldExpires')}
              </label>
              <select
                id="apikey-expires"
                value={expiresInDays === null ? 'never' : String(expiresInDays)}
                onChange={e => {
                  const v = e.target.value;
                  setExpiresInDays(v === 'never' ? null : Number(v));
                }}
                disabled={busy}
                className="w-full rounded-none border border-line bg-bg px-2 py-1 text-sm text-txt focus:border-ink focus:outline-none"
              >
                <option value="never">{t('apiKey.expiresNever')}</option>
                <option value="30">{t('apiKey.expires30')}</option>
                <option value="90">{t('apiKey.expires90')}</option>
                <option value="365">{t('apiKey.expires365')}</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-none border border-line bg-panel px-3 py-1 text-xs text-txt hover:bg-bg disabled:opacity-50"
              >
                {t('apiKey.actionCancel')}
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!canCreate}
                className="rounded-none border border-ink bg-ink px-3 py-1 text-xs text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRotate ? t('apiKey.actionRotate') : t('apiKey.actionCreate')}
              </button>
            </div>
          </>
        )}

        {recentlyCreated !== null && (
          <>
            <p className="mb-3 border border-warning bg-[rgba(229,192,123,0.1)] px-3 py-2 text-xs text-warning">
              {t('apiKey.warningOneTime')}
            </p>
            <div className="mb-3">
              <pre className="overflow-x-auto rounded-none border border-line bg-bg px-2 py-2 text-xs text-txt">
                {recentlyCreated.rawKey}
              </pre>
            </div>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-none border border-ink bg-ink px-3 py-1 text-xs text-bg hover:opacity-90"
              >
                {copyState === 'copied' ? '✓' : t('apiKey.copyButton')}
              </button>
            </div>
            <label className="mb-4 flex items-center gap-2 text-xs text-txt">
              <input
                type="checkbox"
                checked={confirmedSaved}
                onChange={e => setConfirmedSaved(e.target.checked)}
              />
              {t('apiKey.copiedConfirm')}
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCloseClick}
                disabled={!confirmedSaved}
                className="rounded-none border border-ink bg-ink px-3 py-1 text-xs text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('apiKey.actionClose')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}