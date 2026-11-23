# 🎞 Film Sheet

영상을 넣으면 **필름 컨택트 시트**(네거티브 흑백, 스프로킷, 프레임 번호, SAFETY FILM)가 만들어지고,
위아래에 흰 여백을 채워 **아이폰/갤럭시 배경화면 사이즈**로 저장해 주는 도구예요.
AI/API 없이 동작하고, 두 가지 버전이 들어 있어요.

| 버전 | 위치 | 특징 |
|---|---|---|
| **웹(JavaScript)** | `docs/` | 브라우저에서 직접 처리. **GitHub Pages로 무료 공개 배포 가능**, 서버 없음, 영상이 업로드되지 않음 |
| Python | `filmsheet.py`, `app.py` | 로컬 실행용 (CLI / Flask). 모든 코덱 지원 |

## 🌐 GitHub Pages로 배포하기 (JS 버전)

1. 이 폴더를 GitHub 저장소로 올려요 (`git init` → `git add .` → `git commit` → `git push`).
2. 저장소의 **Settings → Pages → Build and deployment** 에서
   Source: *Deploy from a branch*, Branch: `main`, Folder: **`/docs`** 선택 후 Save.
3. 1~2분 뒤 `https://<내 아이디>.github.io/<저장소 이름>/` 에서 바로 사용할 수 있어요.

로컬에서 확인하려면 `docs/index.html` 을 브라우저로 열거나 `python -m http.server -d docs` 후 http://localhost:8000 에 접속하세요.

**주의**: 영상 재생은 접속자의 브라우저 코덱에 따라요. 아이폰 화면 기록(.mov, HEVC)은 Safari에서는 잘 열리지만
Chrome/Edge는 환경에 따라 안 열릴 수 있어요. 그럴 땐 안내 문구가 뜨며, mp4(H.264)로 변환하거나 Python 버전을 쓰면 돼요.

## 🐍 Python 버전

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py            # 웹: http://127.0.0.1:5000
python filmsheet.py my_video.mp4 -o sheet.png --preset 15promax --rows 5   # CLI
```

| 옵션 | 설명 |
|---|---|
| `--preset` | 아이폰 `15promax`(기본) `16promax` `16pro` `15` `13` `se` / 갤럭시 `galaxy_s`(1080×2340) `galaxy_ultra`(1440×3120) `galaxy_a`(1080×2400) `galaxy_fold` `galaxy_flip` |
| `--rows` | 필름 줄 수 (기본 5) |
| `--interval` | 프레임 간격(초). 생략하면 영상 길이 ÷ 장수로 자동 계산 |
| `--seed` | 배치·먼지 모양을 바꾸는 시드 |
| `--positive` | 네거티브 반전 끄기 |
| `--color` | 흑백 대신 컬러 |

## 커스터마이징

`filmsheet.py` 상단의 `PRESETS`(해상도), `BG`/`BASE`(배경·필름 색), `FRAME_W`·`PITCH`·`STRIP_H`(프레임 크기·간격)를 바꾸면 돼요.

## 참고

- Python 버전은 GitHub Pages에서 실행되지 않아요. 공개 배포는 JS 버전(`docs/`)을 쓰세요.
- 업로드한 영상은 처리 후 바로 삭제되고, 결과 PNG만 `outputs/`에 저장돼요.
