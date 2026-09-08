# CampusWebLogin

校园网自动登录工具，提供 Node.js、Python、Lua 5.4 和 Rust 四种实现。四种 CLI 使用相同的配置字段和校园网协议；Rust 是跨平台发行版入口。

## 配置

复制 `config.toml.example` 为 `config.toml`，填写账号密码。也可以使用 `config.yaml.example`。同时存在多个配置文件会直接报错。旧 `.env` 不再读取。

```toml
username = "学号"
password = "密码"
base_url = "http://10.88.108.101"
check_interval = 5
request_retries = 3
service = ""
connectivity_test_url = "http://www.msftconnecttest.com/connecttest.txt"
```

## 运行

```bash
# Rust（推荐）
cargo run --manifest-path rust/Cargo.toml -- run
cargo run --manifest-path rust/Cargo.toml -- check
cargo run --manifest-path rust/Cargo.toml -- fetch-config

# Node.js 20+
node node/cli.js run --once

# Python 3.11+
python python/campus_login.py run --once

# Lua 5.4（需要 LuaSocket、dkjson）
lua lua/campus_login.lua check
```

所有实现支持 `--config PATH`、`--interval N`、`--retries N`；`run --once` 执行一次检查后退出。

## 构建与发布

Rust 使用 `rust/dist-workspace.toml` 配置 cargo-dist，目标平台为 Windows/Linux/macOS 的 x64 与 ARM64。推送 `v*` tag 后，GitHub Actions 自动构建并上传 Release 产物。发布包应包含 Rust 二进制、配置样例、Node/Python/Lua 源码、LICENSE 和 Lua 运行时启动文件。

Lua 源码运行需要 Lua 5.4、LuaSocket 与 dkjson；发布包提供 bundled launcher，免去用户单独安装解释器。Lua 5.4 本身没有原生大整数，因此 RSA 登录由 bundled launcher/Rust CLI 完成。

## 测试

```bash
python -m py_compile python/campus_login.py
node --check node/cli.js
cargo test --manifest-path rust/Cargo.toml
```

共享协议样例位于 `tests/fixtures/`，用于 mock portal 和多语言 golden case 测试。
