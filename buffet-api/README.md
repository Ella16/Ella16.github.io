# 오늘 메뉴 게시판 API (Vercel)

`buffet/` 화면이 쓰는 서버. Vercel 함수 + Vercel Blob 저장소. 데이터베이스는 따로 없다.

- `api/*.js` — Vercel 함수 입구 (days, day, post, comment, like, report, admin)
- `lib/app.js` — 실제 처리. 저장 경로 규칙은 파일 맨 위 주석에 있다
- `lib/store-blob.js` — Vercel Blob, `lib/store-fs.js` — 시험용 로컬 폴더

## 시험

```bash
npm ci && npm test                 # API 단위 시험
node test/dev-server.js /tmp/blob  # http://localhost:8787/buffet/ (config.js 의 apiBase 를 http://localhost:8788 로 바꿔서 확인)
```

## 처음 배포 (아직 안 함)

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
