import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track 1.5 재발 방지 가드 (2026-04-29):
// drizzle-orm/neon-http 는 interactive transaction 미지원 (issue #4747 — Better Auth user creation 깨짐).
// Better Auth 경로(auth.ts·auth-helpers.ts) 에서 import 시 ESLint fail 로 차단.
// plan1 은 Better Auth 사용 안 하므로 server actions 에서는 neon-http 권장.
// auth-helpers.ts 자체는 jose verify 만 사용 (Better Auth client 없음) — neon-http 사용 안 함이 정상.
// 향후 누군가 auth-helpers 에 db 호출 추가하다 neon-http import 하면 fail.
export default defineConfig([
  {
    extends: [...nextCoreWebVitals],
  },
  {
    files: ["**/auth.ts", "**/auth-helpers.ts", "**/auth.config.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "drizzle-orm/neon-http",
              message:
                "Better Auth 경로에서 neon-http import 금지 (issue #4747 — interactive transaction 미지원으로 user creation 깨짐). drizzle-orm/neon-serverless Pool 사용",
            },
          ],
        },
      ],
    },
  },
]);