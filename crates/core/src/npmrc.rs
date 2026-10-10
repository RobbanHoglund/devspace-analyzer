//! Bounded, top-level scalar extraction for the npm INI cache/store fields.
//! Never returns unrelated values (registry credentials, tokens, etc.).

fn value(raw: &str) -> String {
    let text = raw.trim();
    let double = text.len() >= 2 && text.starts_with('"') && text.ends_with('"');
    let single = text.len() >= 2 && text.starts_with('\'') && text.ends_with('\'');
    if double || single {
        let json = if single { &text[1..text.len() - 1] } else { text };
        // npm/ini attempts JSON parsing of whole quoted values; a failed parse
        // leaves the original text (with single outer quotes removed).
        return match serde_json::from_str::<serde_json::Value>(json) {
            Ok(serde_json::Value::String(s)) => s,
            Ok(other) => other.to_string(),
            Err(_) => json.to_owned(),
        };
    }
    let mut out = String::new();
    let mut escaped = false;
    for ch in text.chars() {
        if escaped {
            if !matches!(ch, '\\' | ';' | '#') { out.push('\\'); }
            out.push(ch);
            escaped = false;
        } else if matches!(ch, ';' | '#') { break; }
        else if ch == '\\' { escaped = true; }
        else { out.push(ch); }
    }
    if escaped { out.push('\\'); }
    out.trim().to_owned()
}

/// None means absent. An invalid explicit scalar is an error, never a fallback
/// to an older setting or a guessed default. Files are already capped at 64 KiB.
pub fn setting(text: &str, wanted: &str) -> Option<Result<String, &'static str>> {
    let mut result = None;
    let mut in_section = false;
    let mut array = false;
    for line in text.split(['\r', '\n']) {
        if line.trim().is_empty() || line.trim_start().starts_with([';', '#']) { continue; }
        if line.starts_with('[') && line.trim_end().ends_with(']') {
            in_section = true;
            continue;
        }
        if in_section { continue; }
        let (key, raw) = line.split_once('=').map_or((line, None), |(k, v)| (k, Some(v)));
        let key = value(key);
        if key != wanted && key != format!("{wanted}[]") { continue; }
        array |= key.ends_with("[]");
        result = Some(if array {
            Err("Expected one scalar path, not an array.")
        } else if let Some(raw) = raw {
            let parsed = value(raw);
            if parsed.is_empty() || matches!(parsed.as_str(), "true" | "false" | "null") {
                Err("Expected a nonempty path, not a boolean or null value.")
            } else { Ok(parsed) }
        } else { Err("Expected a path value after '='.") });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_scalar_last_wins() {
        assert_eq!(setting("cache=/old\ncache=/new", "cache"), Some(Ok("/new".into())));
    }
    #[test]
    fn inline_comments_and_escaped_delimiters() {
        assert_eq!(value(r"/cache\#one\;two ; ignored"), "/cache#one;two");
        assert_eq!(value(r"C:\Users\Jane Doe\cache # ignored"), r"C:\Users\Jane Doe\cache");
        assert_eq!(value("/cache\\"), "/cache\\");
    }
    #[test]
    fn quoted_paths_and_windows_json_escapes() {
        assert_eq!(value(r#""C:\\Users\\Jane Doe\\cache;#""#), r"C:\Users\Jane Doe\cache;#");
        assert_eq!(value("'/cache;#'"), "/cache;#");
        assert_eq!(value(r#""/space dir;#""#), "/space dir;#");
    }
    #[test]
    fn sections_are_not_global_cache_settings() {
        assert_eq!(setting("cache=/real\n[other]\ncache=/wrong", "cache"), Some(Ok("/real".into())));
    }
    #[test]
    fn invalid_last_setting_does_not_restore_old_value() {
        assert!(setting("cache=/old\ncache", "cache").unwrap().is_err());
        assert!(setting("cache=/old\ncache=", "cache").unwrap().is_err());
        assert!(setting("cache[]=/one\ncache=/two", "cache").unwrap().is_err());
    }
    #[test]
    fn only_requested_field_is_extracted() {
        assert_eq!(setting("//host/:_authToken=PRIVATE_CANARY\nstore-dir=/store", "cache"), None);
        assert_eq!(setting("//host/:_authToken=PRIVATE_CANARY\nstore-dir=/store", "store-dir"), Some(Ok("/store".into())));
    }
}
