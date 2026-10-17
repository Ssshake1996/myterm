# dsh-remote-ops v0.7.1

The environment editor now lets the user view the saved SSH password through an eye button. Passwords remain masked until requested; hiding the value or closing the editor/drawer discards the revealed value. New password drafts can also be shown and hidden.

Viewing is separate from editing. Saving a renamed environment after viewing its password does not rewrite the credential. Changing the password field does update it. Each reveal resolves the currently effective value through DSH's public credentials service. Missing/unavailable credentials have clear messages and a retry path; cancelled and stale requests cannot restore a closed editor's password or overwrite a new draft.

The dedicated UI route accepts an exact saved environment ID, uses the authenticated DSH transport and returns `Cache-Control: no-store`. It does not expose arbitrary credential-reference lookup, log provider errors, or add an Agent password-reading tool. The environment-management skill now explains the user-facing path. No Agent/core changes.

Target host: DSH 0.2.0-rc.2. Install in the same DSH profile, fully restart DSH and refresh the browser. Saved environment definitions and credential references are retained. Running terminals/browser sessions and in-memory terminal logs do not survive a DSH restart; export needed logs first.

Release assets remain **tgz and SHA256 only**. Validation evidence: `docs/testing/dsh-remote-ops-v0.7.1-acceptance.md`.

Post-publication validation: the downloaded official package passed all six real DSH acceptance steps and ten native tool calls. Linux/Windows release checks and 345 local tests passed; the local browser suite passed 15/15. Browser CI passed the new password scenario, but remains 14/15 because an existing large-directory switching performance check exceeded 250ms (294ms, then 250.5ms). The same check also failed on the v0.7.0 baseline; it remains unresolved. Full evidence is in the [acceptance report](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.7.1-acceptance.md).
