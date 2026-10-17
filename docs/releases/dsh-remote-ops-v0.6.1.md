# dsh-remote-ops v0.6.1

Adds the missing Agent environment-update tool and a bundled SSH environment-management skill. Agent/core remain unchanged; release assets are tgz and SHA256 only.

- `remote_environment_update` targets an existing ID or name, preserves identity and omitted/null fields, validates before writing, and supports group moves, credential references, encoding and CLI/terminal defaults.
- Existing SSH sessions keep their original configuration. Updates apply to newly opened connections; saving does not imply a successful connection.
- The `configured` credential display marker is rejected as an update reference. Empty credential/key-path strings clear only the saved association. Plaintext passwords are not accepted by the tool.
- `remote-ops-environments` and `remote-ops-browser` are discovered and loaded separately through the same native DSH skill provider. No manual skill copying or user skill-file changes.
- README now distinguishes the previously missing Agent update tool from frontend saving and documents all environment/group operations.

Validation and host/package acceptance are recorded in [v0.6.1 acceptance](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.6.1-acceptance.md).

Install using `dsh plugin --profile web add ./dsh-remote-ops-v0.6.1.tgz`, with the same user, DSH_HOME and actual profile as the running host. Fully stop and restart DSH, refresh its webpage, and confirm v0.6.1 under Remote Ops settings. Existing saved data remains; process-local SSH/browser sessions must be reopened.
