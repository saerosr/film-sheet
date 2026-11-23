"""영상 -> 필름 시트 웹앱 (Flask). 실행: python app.py  ->  http://127.0.0.1:5000"""
import os
import tempfile
import uuid

from flask import Flask, render_template_string, request, send_from_directory

from filmsheet import PRESETS, render_sheet

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024  # 업로드 최대 1GB
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "outputs")
os.makedirs(OUT_DIR, exist_ok=True)

PAGE = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Film Sheet</title>
<style>
 body{font-family:-apple-system,Helvetica,Arial,sans-serif;background:#fff;color:#222;margin:0;padding:40px 20px}
 main{max-width:560px;margin:auto}
 h1{font-weight:500;letter-spacing:.02em}
 form{display:grid;gap:14px;background:#fff;padding:22px;border:1px solid #e4e4e0;border-radius:12px}
 label{display:grid;gap:6px;font-size:14px;color:#555}
 input,select,button{font:inherit;padding:9px;border:1px solid #ccc;border-radius:8px;background:#fff}
 .row{display:flex;gap:18px;align-items:center;font-size:14px}.row input{padding:0}
 button{background:#222;color:#fff;border:0;cursor:pointer;padding:12px}
 .err{color:#b00020;margin:14px 0}
 img{width:100%;max-width:360px;display:block;margin:24px auto 10px;border:1px solid #ddd}
 a.dl{display:block;text-align:center}
</style></head><body><main>
<h1>🎞 Film Sheet</h1>
<form method="post" action="/" enctype="multipart/form-data" onsubmit="b.disabled=true;b.textContent='만드는 중…'">
 <label>영상 파일<input type="file" name="video" accept="video/*" required></label>
 <label>기기 사이즈
  <select name="preset">{% for k,(w,h) in presets.items() %}
   <option value="{{k}}" {{'selected' if k=='15promax'}}>{{k}} ({{w}}×{{h}})</option>{% endfor %}
  </select></label>
 <label>필름 줄 수 (1~6)<input type="number" name="rows" value="5" min="1" max="6"></label>
 <label>프레임 간격(초) — 비우면 영상 길이에 맞춰 자동<input type="number" name="interval" step="0.1" min="0.1" placeholder="자동"></label>
 <label>랜덤 시드 (배치/먼지 모양)<input type="number" name="seed" value="7"></label>
 <div class="row">
  <label class="row"><input type="checkbox" name="invert" checked> 네거티브(반전)</label>
  <label class="row"><input type="checkbox" name="gray" checked> 흑백</label>
 </div>
 <button name="b">시트 만들기</button>
</form>
{% if error %}<p class="err">{{error}}</p>{% endif %}
{% if result %}
 <p style="text-align:center;font-size:14px;color:#666">{{msg}}</p>
 <img src="/outputs/{{result}}" alt="film sheet">
 <a class="dl" href="/outputs/{{result}}" download="film_sheet.png">PNG 다운로드</a>
{% endif %}
</main></body></html>"""


@app.route("/", methods=["GET", "POST"])
def index():
    result = error = msg = None
    if request.method == "POST":
        f = request.files.get("video")
        if not f or not f.filename:
            error = "영상을 선택해 주세요."
        else:
            suffix = os.path.splitext(f.filename)[1] or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                f.save(tmp.name)
            try:
                preset = request.form.get("preset", "15promax")
                iv = request.form.get("interval", "").strip()
                img, info = render_sheet(
                    tmp.name,
                    PRESETS.get(preset, PRESETS["15promax"]),
                    rows=max(1, min(6, int(request.form.get("rows", 5)))),
                    invert=bool(request.form.get("invert")),
                    grayscale=bool(request.form.get("gray")),
                    seed=int(request.form.get("seed", 7)),
                    interval=float(iv) if iv else None,
                )
                result = f"{uuid.uuid4().hex}.png"
                img.save(os.path.join(OUT_DIR, result))
                msg = f"영상 {info['duration']:.1f}초 · {info['frames']}장 · 간격 {info['interval']:.2f}초 {info['note']}"
            except Exception as e:  # 사용자에게 사유 표시
                error = str(e)
            finally:
                os.unlink(tmp.name)
    return render_template_string(PAGE, presets=PRESETS, result=result, error=error, msg=msg)


@app.route("/outputs/<name>")
def outputs(name):
    return send_from_directory(OUT_DIR, name)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
