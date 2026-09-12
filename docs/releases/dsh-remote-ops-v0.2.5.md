# dsh-remote-ops v0.2.5

## Changes

- Fixed modifier-key handling so the `Control` key itself is not interpreted as `Ctrl+C`; Ctrl+C now forwards one control character instead of two.
- Kept the v0.2.4 direct terminal input, UTF-8 locale, ANSI cleanup, and safe SSH open response fixes.

## Validation

- `npm run check` passes.
- Reproduced the duplicate Ctrl+C issue against local DSH Web on port 3080, traced it to the modifier-key predicate, then verified the corrected key mapping in the source before release.
- Local DSH profile is updated to the v0.2.5 release artifact.
