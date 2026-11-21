# 제작 진행률 대시보드

LG U+ 영상 제작을 위한 간단한 작업 관리 인터페이스.

## 구현 기능
- 작업명 직접 수정
- 담당자 자유 입력
- 상태 선택 (예정 / 진행 중 / 검수 중 / 완료)
- 1% 단위 진행률 슬라이더와 ±1% 버튼
- 작업 추가 / 삭제
- 전체 평균 진행률
- 브라우저 자동 저장 (localStorage)
- JSON 백업 / 불러오기
- 모바일 대응 화면

## 배포: GitHub Pages
이 저장소에는 GitHub Actions 배포 워크플로가 포함되어 있습니다.

1. GitHub 저장소 → **Settings** → **Pages**
2. **Build and deployment → Source**를 **GitHub Actions**로 변경
3. **Actions** 탭에서 배포 완료를 확인
4. 배포 URL: https://atistreiss-creator.github.io/notion/
5. Notion 페이지에서 **/embed** 입력 후 배포 URL 붙여넣기

## 저장과 보안: 매우 중요

이 버전은 **프런트엔드 UI 검증용**입니다. 같은 브라우저의 localStorage에만 자동 저장됩니다.
노션 데이터베이스에 직접 저장하지 않으며 두 사람 사이에서 자동 동기화되지 않습니다.

- 데이터 손실 방지를 위해 **백업 내보내기**를 사용하세요.
- GitHub Pages는 정적 호스팅이므로 노션 API 비밀키를 소스 코드나 환경변수로 직접 공개하면 안 됩니다.
- 실제 노션 동기화는 인증된 별도 백엔드/서버리스 API가 필요합니다.
- 노션에 임베드했을 때는 노션 내 브라우저와 독립 탭의 저장 영역이 다를 수 있으므로 동일 데이터 공유를 기대하면 안 됩니다.
- 현재 저장소가 Public이므로 여기에는 내부 영상자료, 개인 정보, 비밀키를 커밋하지 마세요.

## 노션 연동 다음 단계
1. 안전한 백엔드 호스팅 환경 마련
2. 노션 integration 또는 OAuth 연결: 기존 작업분담 데이터베이스에만 필요한 최소 권한
3. 인증/접근 제어와 사용자별 권한 설정
4. UI의 읽기/쓰기/삭제를 해당 API로 연결
5. 임베드에서 저장·공유 동작 테스트

## 개발
별도의 빌드 도구가 필요하지 않습니다. `index.html`, `styles.css`, `app.js`를 함께 사용합니다.


## Supabase 자동 동기화 설정 (프로젝트 `zhoggxeyhowzdrejiazd`)

**사전 작업:** [Supabase SQL Editor](https://supabase.com/dashboard/project/zhoggxeyhowzdrejiazd/sql/new)에서 [supabase/setup.sql](./supabase/setup.sql)의 내용을 실행합니다. 이 SQL은 담당자/작업 테이블, 승인된 멤버에 한정하는 RLS, 실시간 변경 수신을 설정합니다.

1. Supabase → **Authentication → URL Configuration**에서 Site URL을 `https://atistreiss-creator.github.io/notion/`로 설정하고 같은 URL을 Redirect URLs에 등록합니다.
2. Supabase → **Authentication → Users**에서 공동 작업자 이메일을 **Invite user**로 초대합니다. 이메일 주소를 GitHub 소스에 커밋하지 마세요.
3. Supabase **SQL Editor**에서 실제 초대한 이메일 주소로 다음 쿼리를 실행해 작업 권한을 승인합니다.

   ```sql
   insert into public.progress_members(user_id, role)
   select id, 'editor' from auth.users
   where lower(email) in (lower('첫번째_초대_이메일'), lower('두번째_초대_이메일'))
   on conflict (user_id) do nothing;
   ```

4. **Project Settings → API Keys**의 **Publishable key (`sb_publishable_...`)**만 복사해서 배포된 웹앱의 공유 데이터 연결 칸에 붙여넣습니다. **Secret, service_role 키는 절대 입력하거나 GitHub에 커밋하지 마세요.**
5. 웹앱에서 초대받은 이메일로 로그인 링크를 받아 로그인합니다. 처음에는 공유 작업표가 비어 있으므로 **브라우저 작업을 공유 데이터로 업로드**를 눌러 기존 작업 내용을 옮깁니다.

### 주의

- 이 사이트는 GitHub Pages의 **공개 웹 페이지**이지만 데이터베이스의 읽기/쓰기는 RLS로 승인된 Supabase Auth 계정에 제한됩니다.
- `Publishable key`와 `anon` 키는 공개용입니다. `service_role` 또는 비밀 키는 공개용이 아닙니다.
- 팀원 둘이 동일한 프로젝트를 연결하고 로그인하면 Supabase Realtime과 주기적 새로고침으로 업데이트를 받습니다. 같은 **작업을 동시에 수정하면 마지막 저장이 우선**할 수 있습니다.
- 연결 전에는 기존 방식대로 브라우저 로컬 저장을 사용합니다. 데이터 손실 방지를 위해 먼저 백업 내보내기를 해두세요.
- **Notion 데이터베이스와 양방향 동기화는 이 단계에 포함되지 않습니다.** Supabase와 웹앱 사이의 공유 저장부터 검증한 다음 별도로 연결해야 합니다.
