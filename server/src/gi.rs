//! GI's side of the backend: the page's policy steps (`POST api/gi/step`) are forwarded to the GI endpoint set in
//! Settings → GI (the `gi.autodrive` setting's `endpoint`) with the API key added here, so the key never reaches a page,
//! `GET api/settings` or the agent. The key is kept in its own file (`gi_key` in the app's data dir, owner-only), set
//! with `PUT api/gi/key`. docs/gi.md describes the (imagined) GI API.
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::State as Extract;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use crate::api::{Api, Body};

const STEP_TIMEOUT: Duration = Duration::from_secs(15);

pub struct Gi {
    key_file: Option<PathBuf>,
    key: Mutex<Option<String>>,
    client: reqwest::Client,
}

impl Gi {
    pub fn load(key_file: Option<PathBuf>) -> Gi {
        let key = key_file
            .as_ref()
            .and_then(|file| std::fs::read_to_string(file).ok())
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty());
        Gi {
            key_file,
            key: Mutex::new(key),
            client: reqwest::Client::builder()
                .timeout(STEP_TIMEOUT)
                .build()
                .expect("an HTTP client"),
        }
    }

    pub fn has_key(&self) -> bool {
        self.key.lock().unwrap().is_some()
    }

    /// Saves the key (None or "" removes it).
    fn set_key(&self, key: Option<String>) -> std::io::Result<()> {
        let key = key.map(|key| key.trim().to_string()).filter(|key| !key.is_empty());
        if let Some(file) = &self.key_file {
            match &key {
                Some(key) => {
                    if let Some(dir) = file.parent() {
                        std::fs::create_dir_all(dir)?;
                    }
                    std::fs::write(file, key)?;
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600))?;
                    }
                }
                None => {
                    let _ = std::fs::remove_file(file);
                }
            }
        }
        *self.key.lock().unwrap() = key;
        Ok(())
    }
}

impl Default for Gi {
    fn default() -> Self {
        Gi::load(None)
    }
}

fn error(status: StatusCode, message: impl std::fmt::Display) -> Response {
    (status, Json(json!({ "error": message.to_string() }))).into_response()
}

fn endpoint(api: &Api) -> String {
    api.settings.get("gi.autodrive")["endpoint"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// GET api/gi: the endpoint in use and whether a key is set (never the key).
pub async fn config(Extract(api): Extract<Api>) -> Json<Value> {
    let endpoint = endpoint(&api);
    Json(json!({
        "endpoint": endpoint,
        "policy": if endpoint.is_empty() { "mock (runs in the page)" } else { "GI, through api/gi/step" },
        "hasKey": api.gi.has_key(),
        "settings": api.settings.get("gi.autodrive"),
    }))
}

/// PUT api/gi/key {key}: saves the key ("" or null removes it).
pub async fn put_key(Extract(api): Extract<Api>, Body(body): Body) -> Response {
    let key = body["key"].as_str().map(str::to_string);
    match api.gi.set_key(key) {
        Ok(()) => Json(json!({ "hasKey": api.gi.has_key() })).into_response(),
        Err(caught) => error(StatusCode::INTERNAL_SERVER_ERROR, format!("couldn't save the key: {caught}")),
    }
}

/// POST api/gi/step: the page's step, forwarded to the endpoint with the key; GI's answer comes back as is.
pub async fn step(Extract(api): Extract<Api>, Body(body): Body) -> Response {
    let endpoint = endpoint(&api);
    if endpoint.is_empty() {
        return error(StatusCode::BAD_REQUEST, "no GI endpoint is set (Settings → GI); without one the page uses its mock");
    }
    if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
        return error(StatusCode::BAD_REQUEST, format!("the GI endpoint isn't an http(s) URL: {endpoint}"));
    }
    let key = api.gi.key.lock().unwrap().clone();
    let mut request = api.gi.client.post(&endpoint).json(&body);
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(caught) if caught.is_timeout() => {
            return error(StatusCode::GATEWAY_TIMEOUT, format!("GI took over {} s", STEP_TIMEOUT.as_secs()))
        }
        Err(caught) => return error(StatusCode::BAD_GATEWAY, format!("couldn't reach GI: {caught}")),
    };
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet: String = text.chars().take(300).collect();
        return error(StatusCode::BAD_GATEWAY, format!("GI answered {status}: {snippet}"));
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(value) => Json(value).into_response(),
        Err(_) => error(StatusCode::BAD_GATEWAY, "GI's answer isn't JSON"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body as HttpBody;
    use axum::routing::post;
    use std::sync::Arc;
    use tower::ServiceExt;

    async fn call(router: &axum::Router, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
        let request = axum::http::Request::builder().method(method).uri(path);
        let request = match body {
            Some(body) => request.body(HttpBody::from(body.to_string())),
            None => request.body(HttpBody::empty()),
        };
        let response = router.clone().oneshot(request.unwrap()).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    /// A fake GI on loopback: answers every step with a fixed action and records what it was sent.
    async fn fake_gi(seen: Arc<Mutex<Vec<(Option<String>, Value)>>>) -> String {
        let app = axum::Router::new().route(
            "/v1/step",
            post(move |headers: axum::http::HeaderMap, Json(body): Json<Value>| {
                let seen = seen.clone();
                async move {
                    let auth = headers.get("authorization").and_then(|v| v.to_str().ok()).map(str::to_string);
                    seen.lock().unwrap().push((auth, body));
                    Json(json!({ "action": { "leftStick": [0, 0.5], "rightStick": [0.1, 0] }, "status": "running", "thought": "hi" }))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{address}/v1/step")
    }

    fn router(key_file: Option<PathBuf>) -> (Api, axum::Router) {
        let mut api = Api::for_tests(Arc::default());
        api.gi = Arc::new(Gi::load(key_file));
        (api.clone(), crate::api::routes().router.with_state(api))
    }

    #[tokio::test]
    async fn a_step_goes_to_the_endpoint_with_the_key_and_the_key_stays_out_of_settings() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let endpoint = fake_gi(seen.clone()).await;
        let key_file = std::env::temp_dir().join(format!("gi_key_test_{}", std::process::id()));
        let _ = std::fs::remove_file(&key_file);
        let (_, router) = router(Some(key_file.clone()));

        // no endpoint yet: refused, nothing sent
        let (status, body) = call(&router, "POST", "/api/gi/step", Some(json!({ "instruction": "go" }))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

        let (status, _) = call(&router, "PATCH", "/api/settings", Some(json!({ "key": "gi.autodrive", "value": { "endpoint": endpoint } }))).await;
        assert_eq!(status, StatusCode::OK);
        let (status, body) = call(&router, "PUT", "/api/gi/key", Some(json!({ "key": "sk-secret-123" }))).await;
        assert_eq!((status, body["hasKey"].clone()), (StatusCode::OK, json!(true)));
        assert_eq!(std::fs::read_to_string(&key_file).unwrap(), "sk-secret-123");

        let step = json!({ "session": "s1", "model": "gi-action-1", "instruction": "explore", "frame": { "mimeType": "image/jpeg", "data": "AAAA", "width": 2, "height": 2 }, "t": 0.5 });
        let (status, body) = call(&router, "POST", "/api/gi/step", Some(step.clone())).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["action"]["leftStick"], json!([0, 0.5]));
        assert_eq!(body["status"], "running");
        let sent = seen.lock().unwrap().clone();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].0.as_deref(), Some("Bearer sk-secret-123"));
        assert_eq!(sent[0].1, step, "the step is forwarded unchanged");

        // the key is in no answer the page or the agent can read
        let (_, settings) = call(&router, "GET", "/api/settings", None).await;
        assert!(!settings.to_string().contains("sk-secret-123"), "{settings}");
        let (_, config) = call(&router, "GET", "/api/gi", None).await;
        assert!(!config.to_string().contains("sk-secret-123"), "{config}");
        assert_eq!(config["hasKey"], json!(true));

        // a reload reads the key back from its file; clearing it removes the file
        assert!(Gi::load(Some(key_file.clone())).has_key());
        let (_, body) = call(&router, "PUT", "/api/gi/key", Some(json!({ "key": "" }))).await;
        assert_eq!(body["hasKey"], json!(false));
        assert!(!key_file.exists());
    }

    #[tokio::test]
    async fn gi_errors_come_back_as_errors() {
        let app = axum::Router::new().route("/step", post(|| async { (StatusCode::UNAUTHORIZED, "bad key") }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let (_, router) = router(None);
        call(&router, "PATCH", "/api/settings", Some(json!({ "key": "gi.autodrive", "value": { "endpoint": format!("http://{address}/step") } }))).await;
        let (status, body) = call(&router, "POST", "/api/gi/step", Some(json!({}))).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(body["error"].as_str().unwrap().contains("401"), "{body}");

        call(&router, "PATCH", "/api/settings", Some(json!({ "key": "gi.autodrive", "value": { "endpoint": "ftp://nope" } }))).await;
        let (status, _) = call(&router, "POST", "/api/gi/step", Some(json!({}))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
}
