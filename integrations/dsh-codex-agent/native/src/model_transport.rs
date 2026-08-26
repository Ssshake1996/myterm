use std::sync::Arc;

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use crate::{
    error::CoreError,
    types::{ModelRequest, ModelResponse},
};

pub type DeltaSink = Arc<dyn Fn(String) + Send + Sync>;

#[async_trait]
pub trait ModelTransport: Send + Sync {
    async fn stream(
        &self,
        request: ModelRequest,
        cancellation: CancellationToken,
        on_text_delta: Option<DeltaSink>,
    ) -> Result<ModelResponse, CoreError>;
}
