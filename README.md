# speedkeno-c
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
