# Password Manager 프로젝트 규칙

## 프로젝트 개요
- 마스터 비밀번호 기반 암호화 저장소(Vault) 웹 애플리케이션
- 백엔드: Express.js + MySQL + Sequelize
- 프론트엔드: Vanilla HTML/CSS/JS (PWA)
- 배포: AWS Lightsail (백엔드), GitHub Pages (프론트엔드)

## 보안 불변 규칙 (절대 위반 금지)

- `frontend/js/crypto.js` 수정 시 → 기존 암호화 방식(AES-256-GCM, PBKDF2 100k반복) 변경 금지. 변경하면 기존 저장 데이터 복호화 불가
- API 엔드포인트 추가 시 → `auth` 미들웨어 적용 여부를 반드시 명시할 것
- `.env` 파일은 절대 커밋 금지. 예시는 `.env.example`에만 작성
- JWT 시크릿 키, DB 비밀번호 등 민감값 하드코딩 금지
- 인증 엔드포인트 Rate Limiting은 15분/10회 이하 유지
- 에러 응답에 내부 에러 메시지 노출 금지. 서버 로그에만 상세 기록
- 응답 본문에 평문 비밀번호나 해시 포함 금지

## 아키텍처 경계 규칙

- 프론트엔드에 프레임워크(React, Vue 등) 도입 금지. Vanilla JS 유지
- CSS 프레임워크 도입 금지. `style.css` 단일 파일 유지
- 프론트엔드 상태 관리는 `App` 클래스 단일 패턴 유지. 별도 상태 라이브러리 도입 금지
- 새 API 라우트는 `backend/src/routes/`에 파일 분리. `index.js`에 직접 라우트 작성 금지
- 새 모델 추가 시 `backend/src/models/index.js`에 관계 정의 반드시 추가
- DB 스키마 변경 시 `backend/sql/schema.sql`도 함께 업데이트할 것

## 작업 흐름 규칙

- 기능 추가 시 → 백엔드 API 먼저 → 프론트엔드 UI 순서로 구현
- 백엔드/프론트엔드 동시 수정 필요 시 → 각각 별도 서브에이전트로 병렬 처리
- 버그 수정 시 → 재현 경로 먼저 확인 후 수정
- 리팩토링 시 → 기존 API 계약(엔드포인트, 요청/응답 형식) 변경 금지

## 배포/인프라 규칙

- Dockerfile 수정 시 → 멀티스테이지 빌드 유지, 비root 사용자 실행 유지
- CI/CD 워크플로우에서 health check 단계 제거 금지
- 새 npm 의존성 추가 시 → `npm audit` 결과 확인 언급할 것
