use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use num_bigint::BigUint;
use regex::Regex;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::{fs, path::{Path, PathBuf}, thread, time::Duration};
use url::Url;

const DEFAULT_TEST: &str = "http://www.msftconnecttest.com/connecttest.txt";
const TEST_BODY: &str = "Microsoft Connect Test";
const EPORTAL: &str = "/eportal/InterFace.do?method=";

#[derive(Debug, Clone, Deserialize)]
struct Config { username: String, password: String, base_url: String, #[serde(default = "default_interval")] check_interval: u64, #[serde(default = "default_retries")] request_retries: u32, #[serde(default)] service: String, #[serde(default = "default_test")] connectivity_test_url: String }
fn default_interval() -> u64 { 5 }
fn default_retries() -> u32 { 3 }
fn default_test() -> String { DEFAULT_TEST.into() }

#[derive(Parser)]
#[command(name="campus-web-login", version, about="Campus network auto login")]
struct Cli { #[arg(short, long)] config: Option<PathBuf>, #[arg(long)] interval: Option<u64>, #[arg(long)] retries: Option<u32>, #[command(subcommand)] command: Option<Command> }
#[derive(Subcommand)]
enum Command { Run { #[arg(long)] once: bool }, FetchConfig, Check }

fn config_path(explicit: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(p) = explicit { return Ok(p); }
    let toml = PathBuf::from("config.toml"); let yaml = PathBuf::from("config.yaml"); let yml = PathBuf::from("config.yml");
    let found: Vec<_> = [toml, yaml, yml].into_iter().filter(|p| p.exists()).collect();
    match found.as_slice() { [p] => Ok(p.clone()), [] => Err(anyhow!("配置文件不存在，请复制 config.toml.example 为 config.toml")), _ => Err(anyhow!("检测到多个配置文件，请只保留一个")) }
}
fn load_config(path: &Path) -> Result<Config> {
    let text = fs::read_to_string(path).with_context(|| format!("读取配置失败: {}", path.display()))?;
    let mut c: Config = match path.extension().and_then(|x| x.to_str()) { Some("yaml") | Some("yml") => serde_yaml::from_str(&text)?, _ => toml::from_str(&text)? };
    if c.username.is_empty() || c.password.is_empty() || c.base_url.is_empty() { return Err(anyhow!("username、password、base_url 不能为空")); }
    if c.request_retries == 0 { c.request_retries = 1; } Ok(c)
}
fn client() -> Result<Client> { Ok(Client::builder().timeout(Duration::from_secs(10)).user_agent("CampusWebLogin/0.1").build()?) }
fn get(client: &Client, url: &str) -> Result<reqwest::blocking::Response> { Ok(client.get(url).send()?) }
fn follow(client: &Client, start: &str) -> Result<(String, String)> {
    let mut current = Url::parse(start)?;
    for _ in 0..10 { let r = get(client, current.as_str())?; let status = r.status(); if status.is_redirection() { if let Some(loc) = r.headers().get("location") { current = current.join(loc.to_str()?)?; continue; } } return Ok((current.to_string(), r.text()?)); }
    Err(anyhow!("重定向次数过多"))
}
fn query_from_redirect(html: &str) -> Option<String> { let re = Regex::new(r#"location\.href\s*=\s*['\"]([^'\"]+)['\"]"#).unwrap(); re.captures(html).and_then(|c| c[1].split_once('?').map(|(_, q)| q.to_string())).filter(|x| !x.is_empty()) }
fn page_info(client: &Client, base: &str, query: &str) -> Result<(String, String)> { let url = format!("{}{}pageInfo", base.trim_end_matches('/'), EPORTAL); let value: serde_json::Value = client.post(url).form(&[("queryString", query)]).send()?.json()?; let modulus = value.get("publicKeyModulus").and_then(|v| v.as_str()).ok_or_else(|| anyhow!("pageInfo 缺少 publicKeyModulus"))?.to_string(); let exponent = value.get("publicKeyExponent").and_then(|v| v.as_str()).unwrap_or("10001").to_string(); Ok((modulus, exponent)) }
fn fetch_config(client: &Client, base: &str, retries: u32) -> Result<(String,String,String)> { let mut last = None; for _ in 0..retries { match (|| { let (_redirect, html) = follow(client, base)?; let q = query_from_redirect(&html).ok_or_else(|| anyhow!("无法提取 queryString"))?; let (m,e) = page_info(client, base, &q)?; Ok((q,m,e)) })() { Ok(v) => return Ok(v), Err(e) => last = Some(e) } } Err(last.unwrap_or_else(|| anyhow!("获取配置失败"))) }
fn rsa_encrypt(password: &str, modulus: &str, exponent: &str) -> Result<String> { let n = BigUint::parse_bytes(modulus.as_bytes(), 16).ok_or_else(|| anyhow!("RSA modulus 无效"))?; let e = BigUint::parse_bytes(exponent.as_bytes(), 16).ok_or_else(|| anyhow!("RSA exponent 无效"))?; let bytes: Vec<u16> = password.chars().rev().map(|c| c as u16).collect(); let chunk = ((n.bits() as usize + 7) / 8).saturating_sub(2).max(2); let mut out = Vec::new(); for part in bytes.chunks(chunk / 2) { let mut block = Vec::new(); for &u in part { block.push((u & 0xff) as u8); block.push((u >> 8) as u8); } while block.len() < chunk { block.push(0); } let x = BigUint::from_bytes_le(&block); out.push(format!("{:x}", x.modpow(&e, &n))); } Ok(out.join(" ")) }
fn login(client: &Client, c: &Config, q: &str, modulus: &str, exponent: &str) -> Result<bool> { let password = rsa_encrypt(&c.password, modulus, exponent)?; let url = format!("{}{}login", c.base_url.trim_end_matches('/'), EPORTAL); let v: serde_json::Value = client.post(url).form(&[("userId", c.username.as_str()), ("password", password.as_str()), ("service", c.service.as_str()), ("queryString", q), ("operatorPwd", ""), ("operatorUserId", ""), ("validcode", ""), ("passwordEncrypt", "true")]).send()?.json()?; Ok(v.get("result").map(|x| x == "success" || x == 1).unwrap_or(false)) }
fn check(client: &Client, url: &str) -> bool { get(client, url).and_then(|r| Ok(r.status().is_success() && r.text()?.trim() == TEST_BODY)).unwrap_or(false) }
fn main() -> Result<()> { let cli = Cli::parse(); let path = config_path(cli.config)?; let mut c = load_config(&path)?; if let Some(v)=cli.interval { c.check_interval=v; } if let Some(v)=cli.retries { c.request_retries=v; } let client=client()?; match cli.command.unwrap_or(Command::Run{once:false}) { Command::Check => println!("{}", if check(&client,&c.connectivity_test_url) {"online"} else {"offline"}), Command::FetchConfig => { let (q,m,e)=fetch_config(&client,&c.base_url,c.request_retries)?; println!("queryString={q}\npublicKeyModulus={m}\npublicKeyExponent={e}"); }, Command::Run{once} => loop { if !check(&client,&c.connectivity_test_url) { let (q,m,e)=fetch_config(&client,&c.base_url,c.request_retries)?; println!("登录{}", if login(&client,&c,&q,&m,&e)? {"成功"} else {"失败"}); } else { println!("网络正常"); } if once { break; } thread::sleep(Duration::from_secs(c.check_interval)); } } Ok(()) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_query_from_javascript_redirect() {
        assert_eq!(query_from_redirect("<script>location.href='/index.jsp?a=1&b=2'</script>").unwrap(), "a=1&b=2");
    }
    #[test]
    fn rsa_is_hex_and_deterministic() {
        let a = rsa_encrypt("abc", "c1", "10001").unwrap();
        assert_eq!(a, rsa_encrypt("abc", "c1", "10001").unwrap());
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() || c == ' '));
    }
}
