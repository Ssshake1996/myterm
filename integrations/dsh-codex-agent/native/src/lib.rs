mod chat_completions_sse;
mod chat_completions_transport;
mod error;
mod model_transport;
mod responses_transport;
mod result_reducer;
mod runtime;
mod store;
mod types;

use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use napi::{
    Status,
    bindgen_prelude::Promise,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;

pub use chat_completions_transport::ChatCompletionsTransport;
pub use error::CoreError;
pub use model_transport::ModelTransport;
pub use responses_transport::ResponsesTransport;
pub use runtime::{CodexRuntime, HostBridge};
pub use types::*;

type HostCallback = ThreadsafeFunction<String, Promise<String>>;

struct NapiHostBridge {
    callback: HostCallback,
}

#[async_trait]
impl HostBridge for NapiHostBridge {
    fn emit(&self, event: RuntimeEvent) {
        let payload = serde_json::json!({
            "kind": "event",
            "event": event,
        })
        .to_string();
        let _ = self
            .callback
            .call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
    }

    async fn execute_tool(
        &self,
        invocation: ToolInvocation,
    ) -> Result<ToolExecutionResult, CoreError> {
        let payload = serde_json::json!({
            "kind": "tool",
            "invocation": invocation,
        })
        .to_string();
        let promise = self
            .callback
            .call_async(Ok(payload))
            .await
            .map_err(|error| CoreError::Tool {
                tool: "harness_provider".to_owned(),
                detail: format!("host callback invocation failed: {error}"),
            })?;
        let response = promise.await.map_err(|error| CoreError::Tool {
            tool: "harness_provider".to_owned(),
            detail: format!("host callback promise rejected: {error}"),
        })?;
        serde_json::from_str(&response).map_err(|error| CoreError::Tool {
            tool: "harness_provider".to_owned(),
            detail: format!("host callback returned invalid ToolExecutionResult JSON: {error}"),
        })
    }
}

#[napi(js_name = "NativeCodexCore")]
pub struct NativeCodexCore {
    runtime: Arc<CodexRuntime>,
}

#[napi]
impl NativeCodexCore {
    #[napi(constructor)]
    pub fn new(config_json: String, api_key: String) -> napi::Result<Self> {
        let config: CoreConfig = serde_json::from_str(&config_json).map_err(|error| {
            napi::Error::new(
                Status::InvalidArg,
                format!("invalid dsh-codex-agent config JSON: {error}"),
            )
        })?;
        config
            .validate()
            .map_err(|detail| napi::Error::new(Status::InvalidArg, detail))?;
        let transport = Arc::new(
            ChatCompletionsTransport::new(
                &config.base_url,
                api_key,
                config.model.clone(),
                Duration::from_millis(config.request_timeout_ms),
            )
            .map_err(to_napi_error)?,
        );
        let runtime = CodexRuntime::new(config, transport).map_err(to_napi_error)?;
        Ok(Self { runtime })
    }

    #[napi(js_name = "createThread")]
    pub fn create_thread(
        &self,
        thread_id: String,
        cwd: Option<String>,
        parent_thread_id: Option<String>,
        role: Option<String>,
    ) -> napi::Result<()> {
        self.runtime
            .create_thread(
                &thread_id,
                cwd.as_deref(),
                parent_thread_id.as_deref(),
                role.as_deref().unwrap_or("root"),
            )
            .map_err(to_napi_error)
    }

    #[napi(js_name = "resumeThread")]
    pub fn resume_thread(&self, thread_id: String) -> napi::Result<String> {
        serde_json::to_string(
            &self
                .runtime
                .resume_thread(&thread_id)
                .map_err(to_napi_error)?,
        )
        .map_err(|error| napi::Error::new(Status::GenericFailure, error.to_string()))
    }

    #[napi(js_name = "deleteUnpublishedThread")]
    pub async fn delete_unpublished_thread(&self, thread_id: String) -> napi::Result<()> {
        self.runtime
            .delete_unpublished_thread(&thread_id)
            .await
            .map_err(to_napi_error)
    }

    #[napi(js_name = "threadSnapshot")]
    pub fn thread_snapshot(&self, thread_id: String) -> napi::Result<String> {
        serde_json::to_string(
            &self
                .runtime
                .thread_snapshot(&thread_id)
                .map_err(to_napi_error)?,
        )
        .map_err(|error| napi::Error::new(Status::GenericFailure, error.to_string()))
    }

    #[napi(js_name = "graphSnapshot")]
    pub fn graph_snapshot(&self, root_thread_id: String) -> napi::Result<String> {
        serde_json::to_string(
            &self
                .runtime
                .graph_snapshot(&root_thread_id)
                .map_err(to_napi_error)?,
        )
        .map_err(|error| napi::Error::new(Status::GenericFailure, error.to_string()))
    }

    #[napi(js_name = "runTurn")]
    pub async fn run_turn(
        &self,
        thread_id: String,
        input: String,
        tools_json: String,
        host_callback: HostCallback,
    ) -> napi::Result<String> {
        let tools: Vec<ToolDefinition> = serde_json::from_str(&tools_json).map_err(|error| {
            napi::Error::new(
                Status::InvalidArg,
                format!("invalid Harness tool schema JSON: {error}"),
            )
        })?;
        let host: Arc<dyn HostBridge> = Arc::new(NapiHostBridge {
            callback: host_callback,
        });
        let result = self
            .runtime
            .run_turn(&thread_id, &input, tools, host)
            .await
            .map_err(to_napi_error)?;
        serde_json::to_string(&result)
            .map_err(|error| napi::Error::new(Status::GenericFailure, error.to_string()))
    }

    #[napi(js_name = "cancelThread")]
    pub async fn cancel_thread(&self, thread_id: String) -> bool {
        self.runtime.cancel_thread(&thread_id).await
    }

    #[napi(js_name = "steerThread")]
    pub async fn steer_thread(&self, thread_id: String, input: String) -> napi::Result<()> {
        self.runtime
            .steer_thread(&thread_id, input)
            .await
            .map_err(to_napi_error)
    }

    #[napi]
    pub async fn dispose(&self) -> napi::Result<()> {
        self.runtime.dispose().await.map_err(to_napi_error)
    }
}

fn to_napi_error(error: CoreError) -> napi::Error {
    napi::Error::new(Status::GenericFailure, error.to_json())
}
