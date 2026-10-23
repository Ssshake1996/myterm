---
name: remote-ops-api
description: Manage saved Remote Ops RESTful/API environments, log in with a stored username/password to obtain Token or Cookie, execute business or device API requests, and inspect redacted execution records. Use remote_api_* tools for API operations; use remote-ops-environments for SSH environments.
---

# Remote Ops API

Use the plugin tools so the user sees the same login, request and response in **Remote Ops → API**. Requests originate on the DSH host. Do not replace these calls with curl or a browser unless the user asks for it or the API requires unsupported authentication.

## Fast path

1. `remote_api_environment_list {}`. Pick the exact API environment ID, base URL and group. Do not invent IDs or use an SSH environment ID as the API ID.
2. If the environment is missing, `remote_api_environment_save` with name, baseUrl and auth. For edits, pass id and only the changed fields. Omitted/null fields keep values; `{}` clears headers/headerRefs/extraBody; empty string clears optional text. No SSH fields are required. Optional sshEnvironmentId links an existing SSH target for the same device but does not share credentials automatically.
3. When auth.mode is token/cookie and the current conversation has no login session, `remote_api_login {environment, requestId}`. Check state=completed. A 200 response alone is insufficient: the configured token/cookie must be found. The tool never returns the password or token.
4. `remote_api_request {environment, requestId, method, path, body?}`. Check **state, httpStatus and response.body**. HTTP 2xx only means HTTP success; inspect the business API's success/error fields too.
5. `remote_api_records {requestId}` retrieves full redacted details. With no requestId it lists this conversation's summaries, including UI requests. Use the same ID to inspect an ongoing or uncertain operation, not a new mutation.

## Environment example

The password must already exist in DSH credentials under the named reference. Otherwise ask the user to enter it in **API → 管理环境 → 密码**. Do not ask for passwords in chat or put them in tool arguments, headers, extraBody or URLs.

```json
{
  "name": "Lab device API",
  "group": "lab",
  "baseUrl": "https://device.example/api/v1",
  "auth": {
    "mode": "token",
    "username": "operator",
    "passwordRef": "LAB_API_PASSWORD",
    "loginPath": "login",
    "bodyFormat": "json",
    "usernameField": "username",
    "passwordField": "password",
    "tokenSource": "body",
    "tokenPointer": "/data/token",
    "headerName": "Authorization",
    "prefix": "Bearer "
  }
}
```

Login is one POST; usernameField/passwordField are literal top-level body keys. tokenPointer and successPointer use **JSON Pointer** (`/data/token`, not `data.token` or XPath). For form login use bodyFormat=form. For a token in a response header use tokenSource=header and tokenResponseHeader. For Cookie use mode=cookie and preferably cookieName; Cookie domain/path/Secure/expiry rules apply. Optional csrfCookie and csrfHeader send a cookie value in a header. Optional successPointer + successValue checks a login business flag.

For API keys or other secret headers use `headerRefs: {"X-Api-Key":"LAB_API_KEY"}`; headers only accept non-secret values. Do not override managed token/CSRF headers. TLS certificates are verified; caPem can contain a private CA certificate. No insecure-TLS switch is provided.

## Request example

Replace the environment ID with one actually returned by list. A leading `/` still preserves the base URL prefix: both `volumes` and `/volumes` resolve to `/api/v1/volumes` in the example. Absolute URLs, parent traversal and automatic redirects are unsupported.

```json
{
  "environment": "api-id-returned-by-list",
  "requestId": "inspect-volumes-1",
  "method": "GET",
  "path": "volumes?limit=20"
}
```

`body` accepts an actual JSON object/array or literal text. Use an object for JSON, not a string containing serialized JSON. GET/HEAD cannot have a body. Request size limit 1 MiB; response preview 128 KiB with truncated=true when shortened. Use explicit API pagination to obtain more data. Binary downloads, streaming and file upload are outside this first version.

## Recovery and boundaries

- **API_LOGIN_REQUIRED / API_CREDENTIAL_MISSING**: configure credentials or login explicitly. No business request was dispatched during preflight.
- **401 / API_AUTH_EXPIRED**: session is cleared; request is not replayed. Inspect the receipt and, for mutations, query device state before considering another attempt. Login again explicitly.
- **state=unknown** (timeout, cancellation, interrupted response): the device may already have applied the operation. Do not retry automatically or claim it failed. Check with a read-only request or ask the user how to verify.
- **http_error**: inspect HTTP status and redacted body; 3xx is returned without following redirects. Fix the endpoint when needed.
- Reusing an identical requestId/arguments returns its retained receipt. Different arguments with the same ID fail. Deduplication covers only the last 100 receipts per conversation in this DSH process; after eviction/restart, inspect device state before retrying.
- Environment edits invalidate login sessions. Already running requests keep their captured target; their old login cannot populate the new configuration. UI selection never changes an Agent request's environment.
- Login sessions and execution records are isolated by conversation and live only until DSH restarts. Configurations and credential references persist. Export JSON from the API pane before restart when records are needed.
- Stopping the DSH conversation cancels waiting Agent requests; already dispatched requests cannot be rolled back. Closing/switching the plugin pane does not cancel requests. Humans and Agent may operate concurrently.
- This version supports one login request returning Token/Cookie. MFA, CAPTCHA, browser SSO and multi-step token refresh require a different workflow. Do not invent login endpoints or field mappings: use the system's API documentation or a user-provided contract.
