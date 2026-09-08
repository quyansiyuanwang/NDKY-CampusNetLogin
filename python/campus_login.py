#!/usr/bin/env python3
"""Campus portal monitor implemented with the Python standard library."""
import argparse, json, re, sys, time, urllib.parse, urllib.request, urllib.error
from pathlib import Path

DEFAULT_TEST = "http://www.msftconnecttest.com/connecttest.txt"

def parse_config(path: Path):
    data = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, value = line.split("=", 1)
        elif ":" in line:
            key, value = line.split(":", 1)
        else:
            continue
        data[key.strip()] = value.strip().strip('"\'')
    for key in ("check_interval", "request_retries"):
        if key in data:
            data[key] = int(data[key])
    data.setdefault("check_interval", 5); data.setdefault("request_retries", 3)
    data.setdefault("service", ""); data.setdefault("connectivity_test_url", DEFAULT_TEST)
    if not all(data.get(k) for k in ("username", "password", "base_url")):
        raise ValueError("username、password、base_url 不能为空")
    return data

def find_config(explicit=None):
    if explicit: return Path(explicit)
    paths = [Path("config.toml"), Path("config.yaml"), Path("config.yml")]
    found = [p for p in paths if p.exists()]
    if len(found) != 1: raise ValueError("请只保留一个 config.toml/config.yaml/config.yml")
    return found[0]

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None
OPENER = urllib.request.build_opener(NoRedirect)

def request(url, method="GET", body=None):
    req = urllib.request.Request(url, data=body.encode() if isinstance(body, str) else body, method=method,
                                 headers={"User-Agent": "CampusWebLogin/0.1"})
    try:
        return OPENER.open(req, timeout=10)
    except urllib.error.HTTPError as e:
        return e

def follow(url):
    for _ in range(10):
        response = request(url)
        if 300 <= response.status < 400 and response.headers.get("Location"):
            url = urllib.parse.urljoin(url, response.headers["Location"]); continue
        return url, response.read().decode("utf-8", "replace")
    raise RuntimeError("重定向次数过多")

def extract_query(html):
    m = re.search(r"location\.href\s*=\s*['\"]([^'\"]+)", html, re.I)
    return urllib.parse.urlparse(m.group(1)).query if m else ""

def fetch_config(c):
    _, html = follow(c["base_url"]); query = extract_query(html)
    url = c["base_url"].rstrip("/") + "/eportal/InterFace.do?method=pageInfo"
    body = urllib.parse.urlencode({"queryString": query})
    result = json.loads(request(url, "POST", body).read().decode())
    return query, result["publicKeyModulus"], result.get("publicKeyExponent", "10001")

def rsa_encrypt(password, modulus, exponent):
    n, e = int(modulus, 16), int(exponent, 16)
    raw = (password[::-1]).encode("utf-16le")
    chunk = max(2, ((n.bit_length() + 7) // 8) - 2)
    values = []
    for pos in range(0, len(raw), chunk):
        block = raw[pos:pos + chunk].ljust(chunk, b"\0")
        values.append(format(pow(int.from_bytes(block, "little"), e, n), "x"))
    return " ".join(values)

def login(c, query, modulus, exponent):
    fields = {"userId": c["username"], "password": rsa_encrypt(c["password"], modulus, exponent),
              "service": c["service"], "queryString": query, "operatorPwd": "", "operatorUserId": "",
              "validcode": "", "passwordEncrypt": "true"}
    url = c["base_url"].rstrip("/") + "/eportal/InterFace.do?method=login"
    result = json.loads(request(url, "POST", urllib.parse.urlencode(fields)).read().decode())
    return result.get("result") in ("success", 1), result

def online(c):
    try:
        r = request(c["connectivity_test_url"]); return r.status == 200 and r.read().decode().strip() == "Microsoft Connect Test"
    except Exception: return False

def main():
    p = argparse.ArgumentParser(); p.add_argument("command", nargs="?", choices=("run", "fetch-config", "check"), default="run"); p.add_argument("--config"); p.add_argument("--interval", type=int); p.add_argument("--retries", type=int); p.add_argument("--once", action="store_true"); args = p.parse_args()
    c = parse_config(find_config(args.config)); c["check_interval"] = args.interval or c["check_interval"]; c["request_retries"] = args.retries or c["request_retries"]
    if args.command == "check": print("online" if online(c) else "offline"); return
    if args.command == "fetch-config": print(json.dumps(dict(zip(("queryString", "publicKeyModulus", "publicKeyExponent"), fetch_config(c))), ensure_ascii=False)); return
    while True:
        if not online(c):
            last = None
            for _ in range(c["request_retries"]):
                try: last = fetch_config(c); break
                except Exception as e: time.sleep(1)
            if not last: raise RuntimeError("获取登录配置失败")
            ok, result = login(c, *last); print("登录成功" if ok else f"登录失败: {result}")
        else: print("网络正常")
        if args.once: return
        time.sleep(c["check_interval"])

if __name__ == "__main__":
    try: main()
    except Exception as e: print(f"错误: {e}", file=sys.stderr); sys.exit(1)
