'use client';

import {useEffect, useState} from 'react';
import dynamic from 'next/dynamic';
import {useTranslations} from 'next-intl';
import {logClientError} from '@/lib/log';
import {useRunMutation} from '@/lib/use-run-mutation';
import {useNow} from '@/lib/now';
import {ModalSkeleton} from './ModalSkeleton';
import {listApiKeys, revokeApiKey} from '@/app/actions/api-keys';
import {unwrapServerActionResult as unwrap} from '@/lib/server-action';
import type {ApiKeyMeta, ApiKeyCreated} from '@/app/actions/api-keys';

const ApiKeyCreateModal = dynamic(
  () => import('./ApiKeyCreateModal').then(m => m.ApiKeyCreateModal),
  {ssr: false, loading: ModalSkeleton}
);

/**
 * PLAN1-TASKS-FEATURE-20260509 (S6) — API key 관리 UI.
 * list + create modal + revoke + rotate (24h grace · CreateModal mode='rotate').
 */

export function ApiKeyManager() {
  const t = useTranslations();
  const runMutation = useRunMutation();
  const now = useNow();

  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [rotateOldId, setRotateOldId] = useState<string | null>(null);
  const [rotateOldName, setRotateOldName] = useState<string>('');
  const [recentlyCreated, setRecentlyCreated] = useState<ApiKeyCreated | null>(null);
  const [revokeArmedId, setRevokeArmedId] = useState<string | null>(null);

  useEffect(() => {
    listApiKeys()
      .then(r => {
        setKeys(unwrap(r));
        setLoaded(true);
      })
      .catch(err => {
        logClientError('[ApiKeyManager listApiKeys]', err);
        setLoaded(true);
      });
  }, []);

  const handleCreated = (created: ApiKeyCreated, updatedList: ApiKeyMeta[]) => {
    // M3 정합: 발급 직후 modal 을 닫지 않는다 — plain key 1회 노출 + "I have saved"
    // checkbox + 복사 단계를 거쳐 사용자가 close 버튼으로 직접 닫는다 (onClose 에서 정리).
    // (이전 setCreateOpen(false) 가 modal 을 즉시 unmount 해 plain key 가 노출되지 않던 결함 수정)
    setRecentlyCreated(created);
    setKeys(updatedList);
  };

  const handleRevoke = async (id: string) => {
    const action = revokeApiKey(id);
    runMutation(action, 'revokeApiKey');
    const next = unwrap(await action);
    setKeys(next);
    setRevokeArmedId(null);
  };

  const formatTs = (ms: number | null): string => {
    if (ms === null) return '—';
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const statusOf = (k: ApiKeyMeta): 'revoked' | 'expired' | 'active' => {
    if (k.revokedAt !== null && k.revokedAt <= now) return 'revoked';
    if (k.expiresAt !== null && k.expiresAt < now) return 'expired';
    return 'active';
  };

  return (
    <div className="font-mono text-txt">
      <h1 className="mb-6 text-base font-medium text-ink">{t('settings.heading')}</h1>
      <section className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm text-ink">{t('settings.apiKeysSection')}</h2>
          <button
            type="button"
            onClick={() => {
              setRotateOldId(null);
              setRotateOldName('');
              setCreateOpen(true);
            }}
            className="rounded-none border border-ink bg-ink px-3 py-1 text-xs text-bg hover:opacity-90"
          >
            {t('apiKey.create')}
          </button>
        </div>
        {!loaded && <p className="text-xs text-muted">{t('loading')}</p>}
        {loaded && keys.length === 0 && (
          <p className="text-xs text-muted">{t('apiKey.empty')}</p>
        )}
        {loaded && keys.length > 0 && (
          <table className="w-full border-collapse border border-line text-xs">
            <thead>
              <tr className="bg-bg text-muted">
                <th className="border border-line px-2 py-1 text-left">{t('apiKey.tableName')}</th>
                <th className="border border-line px-2 py-1 text-left">{t('apiKey.tablePrefix')}</th>
                <th className="border border-line px-2 py-1 text-left">{t('apiKey.tableCreated')}</th>
                <th className="border border-line px-2 py-1 text-left">{t('apiKey.tableLastUsed')}</th>
                <th className="border border-line px-2 py-1 text-left">{t('apiKey.tableExpires')}</th>
                <th className="border border-line px-2 py-1 text-left">{t('apiKey.tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map(k => {
                const status = statusOf(k);
                const armed = revokeArmedId === k.id;
                return (
                  <tr key={k.id}>
                    <td className="border border-line px-2 py-1">
                      {k.name}
                      <span className={`ml-2 text-[10px] ${
                        status === 'active' ? 'text-success' : 'text-danger'
                      }`}>
                        {status === 'revoked' && t('apiKey.statusRevoked')}
                        {status === 'expired' && t('apiKey.statusExpired')}
                        {status === 'active' && t('apiKey.statusActive')}
                      </span>
                    </td>
                    <td className="border border-line px-2 py-1 text-muted">…{k.keyPrefix}</td>
                    <td className="border border-line px-2 py-1 text-muted">{formatTs(k.createdAt)}</td>
                    <td className="border border-line px-2 py-1 text-muted">{formatTs(k.lastUsedAt)}</td>
                    <td className="border border-line px-2 py-1 text-muted">{formatTs(k.expiresAt)}</td>
                    <td className="border border-line px-2 py-1">
                      {status === 'active' && !armed && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setRotateOldId(k.id);
                              setRotateOldName(k.name);
                              setCreateOpen(true);
                            }}
                            className="rounded-none border border-line bg-panel px-2 py-0.5 text-[10px] hover:bg-bg"
                          >
                            {t('apiKey.actionRotate')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRevokeArmedId(k.id)}
                            className="rounded-none border border-line bg-panel px-2 py-0.5 text-[10px] text-danger hover:bg-bg"
                          >
                            {t('apiKey.actionRevoke')}
                          </button>
                        </div>
                      )}
                      {armed && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleRevoke(k.id)}
                            className="rounded-none border border-danger bg-danger px-2 py-0.5 text-[10px] text-bg hover:opacity-90"
                          >
                            {t('apiKey.actionRevoke')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRevokeArmedId(null)}
                            className="rounded-none border border-line bg-panel px-2 py-0.5 text-[10px] hover:bg-bg"
                          >
                            {t('apiKey.actionCancel')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {createOpen && (
        <ApiKeyCreateModal
          rotateOldId={rotateOldId}
          rotateOldName={rotateOldName}
          recentlyCreated={recentlyCreated}
          onClose={() => {
            setCreateOpen(false);
            setRecentlyCreated(null);
            setRotateOldId(null);
            setRotateOldName('');
          }}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}