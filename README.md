# speedkeno-c

# SpeedKeno (스피드키노) — 기본 템플릿 / 체크리스트

스피드키노 추천기(정적 웹 + GitHub Actions 자동 업데이트 + Issue 댓글 추천 + Pages 배포) 기본 템플릿입니다.

- ✅ 무작위(Math.random/crypto) **0%**
- ✅ 결정론 추천: **데이터 + cycle + 기기 seed + 사용자 seed + 밴드 분산 + 최근가중**
- ✅ 2가지 게임 룰 반영
  - **넘버스(숫자선택) 게임**: 1~70 중 2~10개(기본 10개) 선택 → 추첨 22개와 **일치 개수**로 등수
  - **숫자합(구간) 게임**: 추첨 22개 합(sum)이 **9구간** 중 어디인지 선택  
    `253-486 / 487-512 / 513-568 / 569-594 / 595-663 / 664-700 / 701-740 / 741-803 / 804-1309`
    - ⚠️ **253-486, 487-512 구간은 1회 1매 제한**(추천 로직도 제한 준수)
- ✅ PC/모바일 반응형 UI
- ✅ BGM 표준: `assets/bgm/trackN.*` 자동 스캔 + ON/OFF + 볼륨 저장 + 재생/정지
- ✅ Pages 배포 시 **경로 자동 탐지**로 `cp: cannot stat` 재발 방지

---

## 1) 최종 레포 구조 (그대로 생성)

/
.github/
workflows/
update-speedkeno.yml
update-speedkeno-issue.yml
deploy-pages.yml

scripts/
update_speedkeno.mjs

data/
speedkeno_draws.json
speedkeno_freq.json

speedkeno-c/
index.html
assets/
bgm/
track1.mp3
track2.mp4
track3.m4a
... (trackN.(mp3|mp4|m4a|ogg|wav))



---

## 2) 파일 역할 요약

### `.github/workflows/update-speedkeno.yml`
- 스케줄/수동 실행으로 `scripts/update_speedkeno.mjs` 실행
- `data/speedkeno_draws.json`, `data/speedkeno_freq.json` 갱신 후 커밋/푸시

### `.github/workflows/update-speedkeno-issue.yml`
- 이슈 댓글에 `/speedkeno ...`가 올라오면 추천 결과를 자동 댓글로 작성

### `.github/workflows/deploy-pages.yml`
- `speedkeno-c/index.html` + `data/` + `speedkeno-c/assets/`를 `dist/`에 모아서 Pages 배포
- **index/data/assets 경로 자동탐지**로 `cp: cannot stat` 방지

### `scripts/update_speedkeno.mjs`
- 데이터 수집/검증/누적/빈도 생성(업데이트 모드)
- 이슈 댓글 파싱 후 추천 마크다운 출력(추천 모드)

### `data/*.json`
- Actions가 생성/갱신
- 웹 UI와 Issue 추천이 이 파일을 읽음

### `speedkeno-c/index.html`
- 추천 UI(넘버스/숫자합 탭, 최근 10/20/30, 최근가중, 밴드분산, cycle, seed 공유, lastCnt 재생성)
- BGM 자동탐색(assets/bgm/trackN.*)

---

## 3) 추천 UI 규칙(반복 줄이기 설계)

- **무작위 금지**: Math.random/crypto 사용 X
- 추천 값은 결정론:
  - `seed(사용자)` + `deviceSeed(기기)` + `cycle` + `viewOffset` + `recentN` + `w` + `spread`
- 버튼 클릭 시:
  - `cycle` 자동 증가(반복 느려짐)
- “같은 cycle 재생성”:
  - `viewOffset` 증가 + `lastCnt(마지막 추천 개수)` 기억 → 동일 개수로 재생성

### 사용자 겹침 줄이기 팁(운영)
- seed 입력칸에 **사람/팀별 고유값** 권장
  - 예: `TEAM-A`, `닉네임`, `2026-03-01-1`
- `+50/+100/+500` cycle 점프 후 추천 → 큰 폭으로 순환 이동

---

## 4) 숫자합(구간) 게임 처리 원칙

- `sum(22개 합)`을 아래 9구간으로 bin 처리
  1) 253-486  
  2) 487-512  
  3) 513-568  
  4) 569-594  
  5) 595-663  
  6) 664-700  
  7) 701-740  
  8) 741-803  
  9) 804-1309
- 추천은 빈도(전체/최근) 기반 + 결정론 seed/cycle로 선택
- **b1, b2는 1회 1매 제한** → 한 번 추천된 뒤에는 같은 추천 묶음(5개/10개) 안에서 중복 방지

---

## 5) BGM 표준(기본 포함)

- 폴더: `speedkeno-c/assets/bgm/`
- 파일명: `track1~track50.(mp3|mp4|m4a|ogg|wav)`
- 동작:
  - 자동 탐색 → 드롭다운 목록 구성
  - ON/OFF, 재생/정지
  - 볼륨/트랙 선택 localStorage 저장

---

## 6) 초기 셋업 체크리스트(필수)

### 레포 생성/푸시 후 1회 점검
- [ ] GitHub → **Settings → Pages → Source: GitHub Actions** 로 설정
- [ ] Actions → `Update SpeedKeno Data` **수동 1회 실행**
- [ ] Actions → `Deploy GitHub Pages` 정상 배포 확인
- [ ] Pages URL 접속 시 “데이터 0건”이 아닌지 확인(최소 30건부터 누적)
- [ ] `/speedkeno` 이슈 댓글 테스트 후 봇 댓글 생성 확인

### 배포 경로 문제(cp 오류) 방지
- [ ] `speedkeno-c/index.html` 존재
- [ ] `data/` 폴더 존재
- [ ] `speedkeno-c/assets/` 있으면 dist/assets 로 복사되는지 확인

---

## 7) Issue 댓글 명령 사용법

기본:
- `/speedkeno`

옵션(예시):
- `/speedkeno 10 seed=TEAM-A cycle=123 recent=30 w=60 spread=80 pick=10 preset=balanced mode=both`
- `/speedkeno 10 seed=TEAM-A mode=sum`
- `/speedkeno 10 seed=TEAM-A mode=numbers pick=8`

옵션 의미:
- `N` : 세트 개수(1~20)
- `seed` : 사용자 seed
- `cycle` : 순환 시작값
- `recent` : 최근 윈도우(10/20/30)
- `w` : 최근 가중(0~100)
- `spread` : 밴드 분산(0~100)
- `pick` : 넘버스 선택 개수(2~10)
- `preset` : balanced/high/spread/low
- `mode` : numbers/sum/both

---

## 8) 유지보수 체크(문제 재발 방지)

- [ ] 데이터 소스가 막히면(HTML 내려옴/JSON 파싱 실패) → 소스 후보 추가/교차검증 강화
- [ ] Pages 배포 오류 `cp: cannot stat` → deploy-pages.yml의 자동 탐지 로직 유지
- [ ] “데이터 없음” 화면이 뜨면 → update workflow가 data를 커밋했는지 확인
- [ ] 추천이 너무 빨리 반복되면 → seed 변경, cycle 점프 사용, spread 상향(분산↑)

---

## 9) 빠른 FAQ

### Q1. “숫자합 게임도 번호를 뽑는 건가?”
아니요. 숫자합 게임은 **22개 추첨번호의 합(sum)이 어떤 구간인지**를 맞추는 게임입니다.

### Q2. 여러 명이 누르면 같은 결과가 너무 많이 나와요.
- seed를 서로 다르게 입력(닉네임/팀코드/날짜 등)
- cycle 점프(+50/+100/+500) 사용
- 같은 cycle 재생성(뷰 오프셋) 사용

---

끝.














## ✅ 1분 세팅 (GitHub UI 클릭 순서, 스샷 없이)

& 목표: **Push → Actions로 데이터 채우기 → Pages 배포 → 링크 실행**  
& (처음 1번만 하면 이후엔 자동 업데이트/자동 배포)

### 0) 레포에 파일 올리기
1. GitHub에서 새 레포 생성 (Public 권장)
2. 로컬에서 폴더/파일을 위 “최종 레포 구조” 그대로 만든 뒤 `git push`  
   - 또는 GitHub 웹에서 **Add file → Upload files**로 업로드 후 Commit

### 1) Pages 설정 (딱 2번 클릭)
1. 레포 상단 **Settings**
2. 좌측 메뉴 **Pages**
3. **Build and deployment**
   - Source를 **GitHub Actions**로 선택

### 2) 데이터 먼저 채우기 (Actions 수동 1회 실행)
1. 레포 상단 **Actions**
2. 좌측 워크플로 목록에서 **Update SpeedKeno Data**
3. 우측 **Run workflow** 버튼 → **Run workflow**(확인 실행)
4. 실행이 끝나면 레포에 아래 2개 파일이 자동 커밋되어 있어야 함
   - `data/speedkeno_draws.json`
   - `data/speedkeno_freq.json`

### 3) Pages 배포 (배포 워크플로 1회 실행)
1. 다시 **Actions**
2. **Deploy GitHub Pages** 선택
3. **Run workflow** → Run
4. 완료되면 **Settings → Pages**에 사이트 주소가 표시됨  
   - 예: `https://&username&.github.io/&repo&/`

### 4) 실행 확인 (웹에서 바로)
1. Pages 주소 접속
2. 상단에 `OK · 데이터 N건 · 최신 ...` 뜨면 정상
3. `1개/5개/10개 추천` 버튼 동작 확인

### 5) Issue 댓글 자동 추천 테스트(선택)
1. 레포 상단 **Issues → New issue** 생성
2. 이슈 댓글에 아래 입력 후 등록
   - `/speedkeno`
3. 잠시 후 봇이 추천 결과를 댓글로 달면 정상
