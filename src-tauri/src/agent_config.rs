use std::path::PathBuf;

use serde_json::{Map, Value};

/// The name the canvas server appears under in the agent's config.
const SERVER_NAME: &str = "canvas";

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// An agent whose MCP servers live in a JSON file.
///
/// They differ in two ways and no more: where the file is, and whether the
/// map of servers is called `mcpServers` or `servers`. Everything else about
/// the entry is the same shape, so one writer serves all of them.
struct JsonAgent {
    /// For logging, and for saying which agents were reached.
    name: &'static str,
    /// Relative to the user's home directory.
    path: &'static [&'static str],
    /// The key holding the map of servers.
    key: &'static str,
    /// A file or directory whose existence means this agent is installed.
    ///
    /// Configuring an agent the user does not have would litter their home
    /// directory with files for tools they never asked for, so absence here
    /// is a skip rather than a failure.
    marker: &'static [&'static str],
}

const JSON_AGENTS: &[JsonAgent] = &[
    JsonAgent {
        name: "Claude Code",
        path: &[".claude.json"],
        key: "mcpServers",
        marker: &[".claude.json"],
    },
    JsonAgent {
        name: "Cursor",
        path: &[".cursor", "mcp.json"],
        key: "mcpServers",
        marker: &[".cursor"],
    },
    JsonAgent {
        name: "Windsurf",
        path: &[".codeium", "windsurf", "mcp_config.json"],
        key: "mcpServers",
        marker: &[".codeium", "windsurf"],
    },
    JsonAgent {
        // VS Code Copilot calls the map `servers`, not `mcpServers`.
        name: "VS Code",
        path: &["Library", "Application Support", "Code", "User", "mcp.json"],
        key: "servers",
        marker: &["Library", "Application Support", "Code", "User"],
    },
    JsonAgent {
        name: "Cline",
        path: &[
            "Library", "Application Support", "Code", "User", "globalStorage",
            "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json",
        ],
        key: "mcpServers",
        marker: &[
            "Library", "Application Support", "Code", "User", "globalStorage",
            "saoudrizwan.claude-dev",
        ],
    },
];

fn join(base: &PathBuf, parts: &[&str]) -> PathBuf {
    let mut p = base.clone();
    for part in parts {
        p.push(part);
    }
    p
}

/// Write `value` to `path` without risking a partial file.
///
/// This config belongs to the user and can be hundreds of kilobytes holding
/// unrelated state, so a crash mid-write must not truncate it: serialise to a
/// sibling temp file, then rename, which is atomic within a filesystem.
fn write_atomic(path: &PathBuf, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.canvas-tmp");
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&tmp, text).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("could not replace config: {e}"))
}

fn load(path: &PathBuf) -> Value {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| Value::Object(Map::new())),
        Err(_) => Value::Object(Map::new()),
    }
}

/// Point every agent the user has at this app's MCP server.
///
/// Written directly rather than shelling out to `claude mcp add`, because:
///
/// * the port can change between launches, so this runs on every start and
///   must be idempotent — `claude mcp add` fails when the name already
///   exists, so shelling out would need a remove-then-add dance that can
///   leave the entry missing if it fails halfway;
/// * it does not depend on the agent being on the PATH of the process that
///   spawns it, which differs from the user's interactive shell;
/// * it does not depend on any CLI's flag surface staying stable;
/// * and it reaches agents that have no CLI at all, which is most of them.
///
/// Each file holds unrelated user state, so this merges one key and leaves
/// everything else as it was. An agent with no marker on disk is skipped
/// rather than configured: writing a config for a tool the user does not have
/// would litter their home directory to no purpose.
pub fn configure_agent(port: u16) -> Result<String, String> {
    let home = home().ok_or("no HOME directory")?;
    let url = format!("http://127.0.0.1:{port}/mcp");
    let mut reached: Vec<&str> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for agent in JSON_AGENTS {
        let marker = join(&home, agent.marker);
        if !marker.exists() {
            continue;
        }
        match write_json_agent(&join(&home, agent.path), agent.key, &url) {
            Ok(()) => reached.push(agent.name),
            Err(e) => failures.push(format!("{}: {e}", agent.name)),
        }
    }

    match write_codex(&home, &url) {
        Ok(true) => reached.push("Codex"),
        Ok(false) => {}
        Err(e) => failures.push(format!("Codex: {e}")),
    }

    if reached.is_empty() && failures.is_empty() {
        // Not an error. A machine with no agent installed is a machine where
        // there is nothing to configure yet, and the canvas still works.
        return Ok("no supported agent found".into());
    }
    if !failures.is_empty() {
        return Err(failures.join("; "));
    }
    Ok(reached.join(", "))
}

/// Merge the canvas entry into one JSON config.
fn write_json_agent(path: &PathBuf, key: &str, url: &str) -> Result<(), String> {
    let mut root = load(path);
    let obj = root.as_object_mut().ok_or("config is not a JSON object")?;
    let servers = obj.entry(key).or_insert_with(|| Value::Object(Map::new()));
    let servers = servers
        .as_object_mut()
        .ok_or_else(|| format!("{key} in the config is not an object"))?;

    let mut entry = Map::new();
    entry.insert("type".into(), Value::String("http".into()));
    entry.insert("url".into(), Value::String(url.into()));
    servers.insert(SERVER_NAME.into(), Value::Object(entry));

    write_atomic(path, &root)
}

/// Codex keeps its servers in TOML, so it gets its own narrow writer.
///
/// Deliberately not a TOML parser. Re-serialising a config file would reorder
/// keys, drop comments and reformat tables the user wrote by hand, which is a
/// bad trade for adding one entry. Instead the canvas table is located by its
/// header and replaced up to the next top-level header, leaving every other
/// byte of the file exactly as it was. Appended when it is not present.
///
/// Returns whether Codex was found at all.
fn write_codex(home: &PathBuf, url: &str) -> Result<bool, String> {
    let dir = home.join(".codex");
    if !dir.exists() {
        return Ok(false);
    }
    let path = dir.join("config.toml");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();

    let header = format!("[mcp_servers.{SERVER_NAME}]");
    let table = format!("{header}\nurl = \"{url}\"\n");

    let next = match existing.find(&header) {
        Some(start) => {
            // The table runs to the next line that opens a new one.
            let rest = &existing[start + header.len()..];
            let end = rest
                .match_indices('\n')
                .find(|(i, _)| rest[i + 1..].trim_start().starts_with('['))
                .map(|(i, _)| start + header.len() + i + 1)
                .unwrap_or(existing.len());
            format!("{}{table}{}", &existing[..start], &existing[end..])
        }
        None => {
            let mut out = existing.clone();
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&table);
            out
        }
    };

    let tmp = path.with_extension("toml.canvas-tmp");
    std::fs::write(&tmp, next).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("could not replace config: {e}"))?;
    Ok(true)
}

/// Remove the entry from every agent. Not called on a normal quit: the server
/// prefers a stable port, so the entry stays valid across restarts and
/// rewriting the user's configs twice per session would be churn for no
/// benefit. Kept for an explicit teardown.
#[allow(dead_code)]
pub fn unconfigure_agent() {
    let Some(home) = home() else { return };
    for agent in JSON_AGENTS {
        let path = join(&home, agent.path);
        if !path.exists() {
            continue;
        }
        let mut root = load(&path);
        let Some(obj) = root.as_object_mut() else { continue };
        let Some(servers) = obj.get_mut(agent.key).and_then(|v| v.as_object_mut()) else {
            continue;
        };
        if servers.remove(SERVER_NAME).is_some() {
            let _ = write_atomic(&path, &root);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The Codex writer edits a real config by hand rather than reparsing it,
    /// so the cases that matter are the ones where it could eat somebody's
    /// settings: a table that already exists, and a table that is followed by
    /// another one.
    fn codex_write(dir: &PathBuf, url: &str) -> String {
        write_codex(dir, url).expect("codex write failed");
        std::fs::read_to_string(dir.join(".codex").join("config.toml")).unwrap()
    }

    fn scratch(name: &str, seed: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("canvas-cfg-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".codex")).unwrap();
        if let Some(text) = seed {
            std::fs::write(dir.join(".codex").join("config.toml"), text).unwrap();
        }
        dir
    }

    #[test]
    fn writes_into_an_empty_config() {
        let dir = scratch("empty", None);
        let out = codex_write(&dir, "http://127.0.0.1:4319/mcp");
        assert!(out.contains("[mcp_servers.canvas]"));
        assert!(out.contains("url = \"http://127.0.0.1:4319/mcp\""));
    }

    #[test]
    fn keeps_unrelated_settings() {
        let dir = scratch(
            "keep",
            Some("model = \"o3\"\n\n[mcp_servers.other]\nurl = \"http://x/\"\n"),
        );
        let out = codex_write(&dir, "http://127.0.0.1:4319/mcp");
        assert!(out.contains("model = \"o3\""), "lost a top-level setting");
        assert!(out.contains("[mcp_servers.other]"), "lost another server");
        assert!(out.contains("http://x/"), "lost the other server's url");
        assert!(out.contains("[mcp_servers.canvas]"));
    }

    #[test]
    fn replaces_its_own_entry_rather_than_duplicating_it() {
        let dir = scratch(
            "replace",
            Some("[mcp_servers.canvas]\nurl = \"http://127.0.0.1:1111/mcp\"\n"),
        );
        let out = codex_write(&dir, "http://127.0.0.1:4319/mcp");
        assert_eq!(out.matches("[mcp_servers.canvas]").count(), 1, "duplicated");
        assert!(!out.contains("1111"), "left the stale port behind");
        assert!(out.contains("4319"));
    }

    #[test]
    fn replaces_its_entry_without_eating_the_next_table() {
        let dir = scratch(
            "middle",
            Some(
                "[mcp_servers.canvas]\nurl = \"http://127.0.0.1:1111/mcp\"\n\n\
                 [mcp_servers.other]\nurl = \"http://x/\"\n\n[tui]\ntheme = \"dark\"\n",
            ),
        );
        let out = codex_write(&dir, "http://127.0.0.1:4319/mcp");
        assert_eq!(out.matches("[mcp_servers.canvas]").count(), 1);
        assert!(out.contains("4319"));
        assert!(out.contains("[mcp_servers.other]"), "ate the following table");
        assert!(out.contains("http://x/"));
        assert!(out.contains("[tui]"), "ate a later table");
        assert!(out.contains("theme = \"dark\""));
    }

    #[test]
    fn skips_an_agent_that_is_not_installed() {
        let dir = std::env::temp_dir().join("canvas-cfg-absent");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(write_codex(&dir, "http://x/"), Ok(false));
        assert!(!dir.join(".codex").exists(), "created a config unasked");
    }

    #[test]
    fn json_agents_merge_rather_than_replace() {
        let dir = std::env::temp_dir().join("canvas-cfg-json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mcp.json");
        std::fs::write(
            &path,
            r#"{"mcpServers":{"other":{"url":"http://x/"}},"unrelated":42}"#,
        )
        .unwrap();
        write_json_agent(&path, "mcpServers", "http://127.0.0.1:4319/mcp").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["unrelated"], 42, "dropped unrelated state");
        assert_eq!(v["mcpServers"]["other"]["url"], "http://x/", "dropped a server");
        assert_eq!(v["mcpServers"]["canvas"]["url"], "http://127.0.0.1:4319/mcp");
    }
}
