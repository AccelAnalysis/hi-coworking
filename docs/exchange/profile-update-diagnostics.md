# Profile update diagnostics

## Root cause and the former `{}`

The configured browser called `profile_update` in the correct project/region, but the Function did not exist and returned HTTP 404. The former `console.error("Profile update failed", error)` exposed `{}` because Firebase error properties are largely non-enumerable and the page discarded the meaningful SDK code/details. It was a serialization/diagnostic defect, not proof that the error had no information.

The shared serializer now emits only a bounded structure: Firebase/name code, safe diagnostic code, retryability, request ID, function name, project, region, endpoint classification, and finite HTTP status. It never emits payloads, ID tokens, emails, business identifiers, addresses, file paths, provider responses, or secrets.

## Classifications

The profile UI distinguishes service-not-deployed/404, wrong project, wrong region, emulator/remote mismatch, deployment revision mismatch, unauthenticated or stale session, permission denial, invalid input, invalid storage reference, App Check rejection, version conflict, transaction abort, timeout/network/CORS failure, and unknown failure.

Expected callable rejections use a structured development warning and an actionable inline message. Unexpected upload/UI failures remain errors. Production shows recovery text without implementation detail. The error summary has `role="alert"`, receives focus, and gives a reload/retry or sign-in action appropriate to the code.

Request IDs connect browser evidence to safe Function log entries. Server logs record status/count/correlation metadata only; they do not log queries or profile/provider payloads.
