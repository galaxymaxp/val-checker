# Worker history

This directory preserves the original separate-VPS scaffold from the Version
2.0 build specification. The Track C blocker is retired. Phase 6 runs through
one shared storefront worker. The protected server cron invokes it at 00:05 UTC
with one database-enforced automatic attempt per allowlisted Riot connection and
UTC store day. An authenticated dashboard server action can invoke that same
pipeline for one exact, owned connection using a separate allowance of at most
one manual storefront attempt per stable Riot PUUID and store day. Internal
operator runs also reuse the pipeline; there is no public debug or polling
endpoint.

The forward refresh-control migration must be reconciled with the hosted
Supabase migration ledger before it is applied. Never use `supabase db push`
blindly for this repository.
