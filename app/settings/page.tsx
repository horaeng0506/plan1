/**
 * PLAN1-TASKS-FEATURE-20260509 (S6) — settings page (server component).
 *
 * 미인증 = SignInPrompt 분기 (page.tsx 영역 SSR cookie 검증 정합 — sub-project SSO chain S1).
 * 인증 = ApiKeyManager (client) 박음.
 */

import {getCurrentSessionUser} from '@/lib/auth-helpers';
import {SignInPrompt} from '@/components/SignInPrompt';
import {ApiKeyManager} from '@/components/ApiKeyManager';

export default async function SettingsPage() {
  const user = await getCurrentSessionUser();
  if (!user) return <SignInPrompt />;
  return (
    <main className="min-h-screen bg-bg text-txt">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <ApiKeyManager />
      </div>
    </main>
  );
}
