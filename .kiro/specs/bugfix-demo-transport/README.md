# Demo transport bugfix

The build review reproduced eight failures against the compiled simulator. This spec covers reply delivery, request selection, event access and the limits on new demo sessions.

## Expected behaviour

- Inbound text must be a bounded string and come from a valid synthetic actor. Invalid input returns a clear error before it has any side effect.
- A short reply addresses exactly one applicable request owned by the sender. If several match, the inbox names the eligible codes. An explicit code can only affect its own request.
- A rejected command produces one actionable reply for its sender. Replaying the same delivery must not create extra domain events or duplicate the inbox reply.
- Authenticated simulator participants can inspect their session's synthetic event and message history through scoped endpoints. The same routes support MCP inspection.
- Demo creation is bounded by request and lifetime limits. The local server's default continues to be loopback.

## Regression checks

The executable cases live in `review/transport-regressions.test.mjs`. Before the implementation, the original review reproduced eight failures. To verify the local fix, run `npm run build` and `node --test review/transport-regressions.test.mjs`, then run the browser, API, MCP and PostgreSQL restart smoke checks.
