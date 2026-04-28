/**
 * i18n catalog drift 가드 (Stage 8.G follow-up · 2026-04-28).
 *
 * 목적: 11 언어 messages JSON 이 동일한 key set 을 갖는지 보장.
 * 새 키 추가 후 일부 언어 누락 시 production 에서 next-intl `t(key)` 가 key 자체를 출력 →
 * 사용자에게 영문 placeholder 또는 raw key 노출. 이 테스트가 CI 에서 catch.
 *
 * 정책:
 * - en.json 이 source of truth (마스터)
 * - 다른 10 언어 모두 동일 key set 보유 필수
 * - 값(번역문)은 검증 안 함 (자동번역 워크플로우 책임)
 */

import {describe, expect, it} from 'vitest';
import en from '../messages/en.json';
import ko from '../messages/ko.json';
import es from '../messages/es.json';
import pt from '../messages/pt.json';
import fr from '../messages/fr.json';
import de from '../messages/de.json';
import ja from '../messages/ja.json';
import ru from '../messages/ru.json';
import ar from '../messages/ar.json';
import hi from '../messages/hi.json';
import zhCN from '../messages/zh-CN.json';

type Catalog = Record<string, unknown>;

function flattenKeys(obj: Catalog, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenKeys(v as Catalog, path));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

const SOURCE = en as Catalog;
const TARGETS: Array<[string, Catalog]> = [
  ['ko', ko as Catalog],
  ['es', es as Catalog],
  ['pt', pt as Catalog],
  ['fr', fr as Catalog],
  ['de', de as Catalog],
  ['ja', ja as Catalog],
  ['ru', ru as Catalog],
  ['ar', ar as Catalog],
  ['hi', hi as Catalog],
  ['zh-CN', zhCN as Catalog]
];

describe('i18n catalog drift', () => {
  const sourceKeys = flattenKeys(SOURCE);

  it('en.json 은 source of truth — 1 키 이상 보유', () => {
    expect(sourceKeys.length).toBeGreaterThan(0);
  });

  for (const [locale, catalog] of TARGETS) {
    it(`${locale}.json 은 en.json 과 동일한 key set 보유`, () => {
      const targetKeys = flattenKeys(catalog);
      const missing = sourceKeys.filter(k => !targetKeys.includes(k));
      const extra = targetKeys.filter(k => !sourceKeys.includes(k));
      expect(
        {missing, extra},
        `${locale}: missing=${missing.length} extra=${extra.length}`
      ).toEqual({missing: [], extra: []});
    });
  }
});
