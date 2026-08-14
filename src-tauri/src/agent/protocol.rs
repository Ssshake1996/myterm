//! Versioned line-delimited JSON protocol for out-of-process Agent plugins.
//!
//! The first release keeps process supervision deliberately small: a future
//! host can start a plugin, exchange these messages over stdin/stdout, and
//! still reuse the same manifest/tool vocabulary as in-process plugins.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppError;

pub const PROTOCOL_VERSION: u16 = 1;
const MAX_MESSAGE_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPluginManifest {
    pub protocol_version: u16,
    pub id: String,
    pub name: String,
    pub version: String,
    pub kind: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub requires: Vec<String>,
    #[serde(default)]
    pub tools: Vec<ExternalToolDescriptor>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalToolDescriptor {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRequest {
    pub protocol_version: u16,
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginResponse {
    pub protocol_version: u16,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<PluginError>,
}

pub fn decode_line(line: &str) -> Result<PluginRequest, AppError> {
    if line.len() > MAX_MESSAGE_BYTES {
        return Err(AppError::InvalidInput(
            "agent plugin message exceeds 256 KiB".to_owned(),
        ));
    }
    let request: PluginRequest = serde_json::from_str(line).map_err(|error| {
        AppError::InvalidInput(format!("invalid agent plugin message: {error}"))
    })?;
    if request.protocol_version != PROTOCOL_VERSION {
        return Err(AppError::InvalidInput(format!(
            "unsupported agent plugin protocol version {}",
            request.protocol_version
        )));
    }
    if request.id.trim().is_empty() || request.method.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "agent plugin messages require id and method".to_owned(),
        ));
    }
    Ok(request)
}

pub fn encode_response(response: &PluginResponse) -> Result<String, AppError> {
    if response.protocol_version != PROTOCOL_VERSION {
        return Err(AppError::InvalidInput(
            "cannot encode an unsupported agent plugin protocol version".to_owned(),
        ));
    }
    serde_json::to_string(response)
        .map_err(|error| AppError::InvalidInput(format!("encode agent plugin response: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_and_response_round_trip() {
        let request = PluginRequest {
            protocol_version: PROTOCOL_VERSION,
            id: "call-1".to_owned(),
            method: "tool.execute".to_owned(),
            params: serde_json::json!({"name": "host_facts"}),
        };
        let encoded = serde_json::to_string(&request).expect("request encodes");
        assert_eq!(decode_line(&encoded).expect("request decodes"), request);

        let response = PluginResponse {
            protocol_version: PROTOCOL_VERSION,
            id: "call-1".to_owned(),
            result: Some(serde_json::json!({"ok": true})),
            error: None,
        };
        let encoded = encode_response(&response).expect("response encodes");
        assert_eq!(
            serde_json::from_str::<PluginResponse>(&encoded).unwrap(),
            response
        );
    }

    #[test]
    fn malformed_and_wrong_version_messages_are_rejected() {
        assert!(decode_line("not-json").is_err());
        assert!(
            decode_line(r#"{"protocolVersion":2,"id":"1","method":"manifest","params":{}}"#)
                .is_err()
        );
        assert!(
            decode_line(r#"{"protocolVersion":1,"id":"","method":"manifest","params":{}}"#)
                .is_err()
        );
    }
}
