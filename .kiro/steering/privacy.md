# Privacy

Invariant I8: no message sent to a whole circle contains a price, a price band, a reliability count, a pickup code, a phone number or a customer note.
Invariant I9: a demo workspace never produces an outbound row for the SMS gateway channel.
Invariant I10: a shortage alert contains only the item, circle and counts and is sent only at or above the ask threshold. Never include a request code, trader alias or price.

Reliability uses counts only. Do not add ratings, comments or rankings.

Real phone numbers exist only in the live database and on the gateway phone. Never put a real number in code, fixtures, logs, screenshots or Kiro context. The .kiroignore file excludes .env files, pilot contacts, field notes and gateway configuration.

The coordinator sees nothing about a request until the requester has widened it (I5). The coordinator view never shows a requester's phone number, exact address or private quote terms.

Demo traders are fictional aliases (Mara, Ellis, Jules, Casey, Rowan, Avery, Quinn). No real person's details appear anywhere in the codebase.
