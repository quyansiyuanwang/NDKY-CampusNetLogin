#!/usr/bin/env lua
-- Lua 5.4 CLI. Requires LuaSocket (socket.http, ltn12) and dkjson.
local http = require("socket.http")
local ltn12 = require("ltn12")
local json = require("dkjson")

local function read_file(path)
  local f = assert(io.open(path, "r")); local s = f:read("*a"); f:close(); return s
end
local function config_path(explicit)
  if explicit then return explicit end
  local found = {}
  for _, p in ipairs({"config.toml", "config.yaml", "config.yml"}) do local f = io.open(p, "r"); if f then f:close(); table.insert(found, p) end end
  assert(#found == 1, "请只保留一个 config.toml/config.yaml/config.yml")
  return found[1]
end
local function config(path)
  local c = {}
  for line in read_file(path):gmatch("[^\r\n]+") do
    local k, v = line:match("^%s*([%w_]+)%s*[=:]%s*[\"']?(.-)[\"']?%s*$")
    if k and v then c[k] = v end
  end
  c.check_interval = tonumber(c.check_interval) or 5; c.request_retries = tonumber(c.request_retries) or 3
  c.service = c.service or ""; c.connectivity_test_url = c.connectivity_test_url or "http://www.msftconnecttest.com/connecttest.txt"
  assert(c.username and c.password and c.base_url, "username、password、base_url 不能为空")
  return c
end
local function request(url, method, body)
  local out = {}; local _, code = http.request{url=url, method=method or "GET", source=body and ltn12.source.string(body), sink=ltn12.sink.table(out), headers={ ["Content-Type"]="application/x-www-form-urlencoded", ["User-Agent"]="CampusWebLogin/0.1" }}
  return tonumber(code), table.concat(out)
end
local function query(html)
  local u = html:match("location%.href%s*=%s*['\"]([^'\"]+)")
  return u and u:match("%?(.*)") or ""
end
local function rsa(password, modulus, exponent)
  -- Lua 5.4 integers are not wide enough for campus RSA; use openssl when available.
  local tmp = os.tmpname(); local f = assert(io.open(tmp, "w")); f:write(password:reverse()); f:close()
  local cmd = string.format("openssl pkeyutl -encrypt -pubin -inkey /dev/null 2>NUL")
  os.remove(tmp)
  error("RSA requires a Lua big-integer implementation; use the packaged launcher or Rust binary")
end
local function fetch(c)
  local code, html = request(c.base_url); assert(code and code < 400, "无法访问登录页面")
  local q = query(html); local body = "queryString=" .. q
  local _, raw = request(c.base_url:gsub("/$", "") .. "/eportal/InterFace.do?method=pageInfo", "POST", body)
  local v = assert(json.decode(raw)); assert(v.publicKeyModulus, "pageInfo 缺少 RSA 公钥")
  return q, v.publicKeyModulus, v.publicKeyExponent or "10001"
end
local function online(c)
  local code, body = request(c.connectivity_test_url); return code == 200 and body:match("Microsoft Connect Test") ~= nil
end
local args = {}; for _, a in ipairs(arg) do table.insert(args, a) end
local explicit, command, once = nil, "run", false
for i, a in ipairs(args) do if a == "--config" then explicit = args[i+1] elseif a == "--once" then once = true elseif a == "run" or a == "check" or a == "fetch-config" then command = a end end
local c = config(config_path(explicit))
if command == "check" then print(online(c) and "online" or "offline")
elseif command == "fetch-config" then local q,m,e=fetch(c); print("queryString="..q); print("publicKeyModulus="..m); print("publicKeyExponent="..e)
else repeat if not online(c) then print("网络断开；Lua 源码模式请使用 Rust 发行包中的 bundled launcher 完成 RSA 登录") else print("网络正常") end; if not once then os.execute("timeout /t "..c.check_interval.." >NUL") end until once end
