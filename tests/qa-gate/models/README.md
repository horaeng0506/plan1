# PICT Models — plan1 테스트 케이스 환원

## 이 폴더가 왜 있는가
이 폴더의 `*.txt` 파일은 [Microsoft PICT](https://github.com/microsoft/pict) 입력 형식이다. plan1 의 사용자 액션마다 입력 도메인을 분할 (Equivalence Partitioning + Boundary Value Analysis) 한 결과 + 조합 환원 (pairwise 또는 3-way) 모델을 정의한다. PICT 가 이 모델을 받아 최소 케이스 셋 CSV 를 출력 → Claude 가 Playwright spec.ts 자동 변환.

전체 원칙·근거: [`wiki/shared/test-case-design-principles.md`](../../../../../wiki-root/wiki/shared/test-case-design-principles.md)
RPN 매트릭스: [`wiki/projects/plan1/risk-matrix.md`](../../../../../wiki-root/wiki/projects/plan1/risk-matrix.md)

## 모델 → 액션 매핑 (RPN 강도순)
| Model | 액션 | RPN | t-way | 예상 케이스 |
|---|---|---|---|---|
| `cascade-bump.txt` | A9 타이머 bump+cascade | **80 Critical** | **3-way** | ~30 |
| `instant-complete.txt` | A10 즉시 완료+cascade | 64 High | 2-way | ~14 |
| `new-schedule.txt` | A3 새 스케줄 추가 | 60 High | 2-way | ~42 |
| `login.txt` | A1 로그인 (Better Auth → portal SSO) | 60 High | 2-way | ~12 |
| `edit-schedule.txt` | A4 스케줄 편집 | 48 Medium | 2-way | ~16 |
| `working-hours.txt` | A11 working hours+split | 40 Medium | 2-way | ~12 |
| `category-delete.txt` | A7 카테고리 삭제+cascade | 32 Medium | 2-way | ~9 |

## 사용법
```bash
# pairwise (2-way) 환원 — default
pict tests/qa-gate/models/new-schedule.txt > tests/qa-gate/cases/new-schedule.csv

# 3-way 환원 (Critical 영역)
pict tests/qa-gate/models/cascade-bump.txt /o:3 > tests/qa-gate/cases/cascade-bump.csv

# constraint·sub-model 검증
pict tests/qa-gate/models/<name>.txt /s
```

## 갱신 트리거
- 신규 입력 변수 추가 (PRD 변경)
- 동치 클래스 변경 (예: durationMin 최대 1440 → 4320)
- 신규 constraint 발견 (사고 후 회귀)
- RPN 점수 변화 → t-way 임계값 변경

갱신 시 `~/wiki-root/wiki/projects/plan1/risk-matrix.md` § 5 매핑 표 동시 갱신.
