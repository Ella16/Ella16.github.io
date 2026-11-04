# 오늘 메뉴 게시판 API (Vercel)

`buffet/` 화면이 쓰는 서버. Vercel 함수 + Vercel Blob 저장소. 데이터베이스는 따로 없다.

- 역(`lib/stations.js`) → 그 역 근처 뷔페 → 날짜별 메뉴 글 구조
- 뷔페를 등록할 때 주소로 위치를 찾고(`lib/geo.js`), 역에서 걷는 거리를 OSM 도보 길찾기로 재서 분당 67m 로 도보 시간을 낸다.
  주소를 못 찾거나 역에서 2.5km 넘게 떨어진 곳이 나오면 사용자가 도보 시간을 직접 적는다.
  Vercel 환경 변수 `KAKAO_REST_KEY` 를 넣으면 카카오 주소 검색을 먼저 써서 더 정확해진다(없으면 OpenStreetMap Nominatim).
- 지난 메뉴는 7일까지만 보이고, 매일 01:20(한국 시간) Vercel Cron 이 `/api/cleanup` 으로 그보다 오래된 글·사진을 지운다(`CRON_SECRET` 필요). 뷔페는 지우지 않는다.

- `api/*.js` — Vercel 함수 입구 (stations, days, day, buffet, reportBuffet, post, comment, like, report, admin, cleanup)
- `lib/app.js` — 실제 처리. 저장 경로 규칙은 파일 맨 위 주석에 있다
- `lib/store-blob.js` — Vercel Blob, `lib/store-fs.js` — 시험용 로컬 폴더

## 시험

```bash
npm ci && npm test                 # API 단위 시험
FAKE_GEO=1 node test/dev-server.js /tmp/blob  # http://localhost:8787/buffet/ (config.js 의 apiBase 를 http://localhost:8788 로 바꿔서 확인)
```

실제 Blob 으로 시험: `vercel env pull` 후 `set -a; . ./.env.local; set +a; NODE_USE_ENV_PROXY=1 STORE=blob node test/dev-server.js`

## 배포 (2026-11-04 완료)

Vercel 개인 팀 `zalakabula-6485s-projects` 의 프로젝트 `buffet-api` → https://buffet-api.vercel.app (서울 icn1).
Blob 스토어 `buffet-menu` (public, icn1). 관리자 비밀번호는 Vercel 환경 변수 `BUFFET_ADMIN_PASSWORD`.

### 처음 배포할 때 했던 순서

필요한 접속: api.vercel.com, vercel.com, *.vercel-storage.com. 토큰은 환경 변수 `VERCEL_TOKEN`.

1. `cd buffet-api && npx vercel@65.11.0 deploy --prod --yes --token "$VERCEL_TOKEN"` — 프로젝트 `buffet-api` 생성
2. Blob 스토어를 만들어 이 프로젝트에 연결 → `BLOB_READ_WRITE_TOKEN` 이 자동으로 들어간다
3. 환경 변수: `BUFFET_ADMIN_PASSWORD`(관리자 비밀번호), `BUFFET_SALT`(아무 긴 난수), 필요하면 `ALLOWED_ORIGINS`(기본 `https://ella16.github.io`)
4. 다시 배포한 뒤 `buffet/config.js` 의 `apiBase` 에 배포 주소를 넣는다
5. 실제 Blob 으로 글·사진·댓글·신고·관리자 삭제를 확인하고 시험 글을 지운 뒤 main 에 합친다

## 알아 둘 점

- 로그인이 없어 별명은 흉내 낼 수 있다. 부적절한 사진은 신고 3건 전까지 보인다
- 도배 방지(1분에 글 3개, 댓글 6개)는 브라우저 식별값과 IP 로 거는 약한 방어다
- Vercel Blob 무료 한도(저장 용량·월 작업 수)가 있다. 읽기 응답은 CDN 에 10초 캐시해서 작업 수를 줄인다
