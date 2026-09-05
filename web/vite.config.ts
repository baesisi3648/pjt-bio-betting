/**
 * vite.config.ts — 화면 번들만 만든다. Worker 는 wrangler 가 따로 번들한다.
 *
 * ⚠️ 외부 자원(CDN·외부 글꼴·외부 이미지)을 쓰지 않는다. 학교망에서 하나라도 막히면
 *    수업이 멈춘다 (MIGRATION §11-1). 라이브러리가 필요하면 npm 으로 받아 **이 번들에**
 *    들어가야 한다. `npm run build` 뒤에 dist/client 안에 https:// 로 시작하는
 *    script/link 가 없는지 확인하는 것이 이 규칙을 지키는 방법이다.
 *
 * ⚠️ 이 파일은 어느 tsconfig 의 include 에도 없다. Vite 가 esbuild 로 직접 읽기 때문이고,
 *    여기에 node 타입을 끌어들이면 tsconfig.client.json 의 `types: []` 가 무너진다.
 *    그래서 node:path 대신 import.meta.url 을 쓴다.
 */

import { defineConfig } from 'vite';

const at = (p: string) => new URL(p, import.meta.url).pathname;

export default defineConfig({
  root: 'src/client',
  // Worker 가 origin 루트에서 서빙한다 (/, /teacher). 상대 경로로 만들면
  // /teacher 에서 ./assets/... 가 /teacher/assets/... 로 잘못 잡힌다
  base: '/',
  build: {
    outDir: at('./dist/client'),
    emptyOutDir: true,
    target: 'es2022',
    // 교실 TV·학생 폰 모두 로컬 네트워크로 받는다. 파일 수를 줄이는 쪽이 이득이라
    // 작은 자산은 인라인한다 (기본값 유지, 명시만)
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: {
        index: at('./src/client/index.html'),      // 학생 (S4~S6)
        teacher: at('./src/client/teacher.html'),  // 교사 (S1~S3)
        // ⚠️ 문제은행 관리는 **별도 진입점**이다. 수업용 교사 번들에 관리 코드가 실리지
        //    않게 하려고 그렇게 뒀다 — teacher.html 에서 admin/main.ts 를 import 하지 마세요.
        //    `npm run build` 뒤 `grep -l "api/admin/questions" dist/client/assets/*.js` 가
        //    admin 청크만 내놓아야 한다 (PixiJS 를 학생 번들에서 떼어 둔 것과 같은 규칙)
        admin: at('./src/client/admin.html')       // 문제은행 관리 (5단계)
      }
    }
  }
});
