use base64::{engine::general_purpose::STANDARD, Engine as _};

/// Read a user-picked image and hand it back as a data URL.
///
/// The webview cannot open an HTML file picker, so the path comes from the
/// native dialog and the bytes are read here rather than granting the
/// frontend filesystem scope over arbitrary paths.
#[tauri::command]
fn read_image_data_url(path: String) -> Result<String, String> {
    let mime = match std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        other => return Err(format!("unsupported image type: {other:?}")),
    };

    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    // Documents embed images inline, so keep a ceiling on what can be added.
    const MAX_BYTES: usize = 8 * 1024 * 1024;
    if bytes.len() > MAX_BYTES {
        return Err(format!("image is {} bytes; limit is {MAX_BYTES}", bytes.len()));
    }

    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Local document persistence writes into the app data directory.
        .plugin(tauri_plugin_fs::init())
        // Native file picker: WKWebView does not open HTML file inputs.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_image_data_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
