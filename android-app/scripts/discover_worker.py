import os
import re
import json
import shutil
import urllib.request

def main():
    urls = [
        "https://storm.max-yu.workers.dev",
        "https://storm.max-yu.workers.dev/api/storms",
        "https://storm.max-yu.workers.dev/storms"
    ]
    for fname in ["index.html", "backend/worker.js"]:
        if os.path.exists(fname):
            with open(fname, "r", encoding="utf-8", errors="ignore") as f:
                txt = f.read()
            found = re.findall(r"https://[a-zA-Z0-9._-]+\.workers\.dev/[a-zA-Z0-9._/-]*", txt)
            for u in found:
                u_clean = u.rstrip(".,;)")
                if u_clean not in urls:
                    urls.insert(0, u_clean)

    live_payload = None
    for u in urls:
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "StormTrackUltra/2.2"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if data:
                        live_payload = data
                        print("Successfully fetched live payload from:", u)
                        break
        except Exception as e:
            print("Probe note for", u, ":", e)

    bridge_path = os.path.join("android-app", "src", "js", "live_bridge.js")
    os.makedirs(os.path.dirname(bridge_path), exist_ok=True)
    with open(bridge_path, "w", encoding="utf-8") as out:
        out.write("window.DISCOVERED_WORKER_URLS = " + json.dumps(urls, ensure_ascii=False) + ";\n")
        out.write("window.STORM_TRACK_INITIAL_LIVE_PAYLOAD = " + json.dumps(live_payload, ensure_ascii=False) + ";\n")
    print("Wrote live_bridge.js with URLs:", urls)

    # Sync shared directories from root repo if present
    for src_dir, dst_sub in [
        ("historical/cases", "android-app/src/shared/historical/cases"),
        ("analysis", "android-app/src/shared/analysis"),
        ("icons", "android-app/src/icons")
    ]:
        if os.path.isdir(src_dir):
            os.makedirs(dst_sub, exist_ok=True)
            for item in os.listdir(src_dir):
                s_item = os.path.join(src_dir, item)
                d_item = os.path.join(dst_sub, item)
                if os.path.isfile(s_item):
                    shutil.copy2(s_item, d_item)

if __name__ == "__main__":
    main()
