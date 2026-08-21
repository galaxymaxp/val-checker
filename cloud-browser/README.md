# Riot cloud-browser canary

This service is the replaceable browser data plane. It runs Chromium outside
Vercel, creates one browser process and incognito context per temporary
connection, and exposes a minimal screenshot/input stream. It never logs input,
screenshots, URLs, cookies, tokens, MFA codes, or Riot response bodies.

The Vercel app calls the `/v1/sessions` control API with
`CLOUD_BROWSER_API_KEY`. A user receives only a short-lived viewer URL whose
bearer token lives in the URL fragment (not the HTTP request or access log).
Captured cookies are returned only to the authenticated control API and are
cleared when `DELETE /v1/sessions/:id` destroys the browser.

For the canary, deploy one Cloud Run instance in Singapore so REST status calls
and the WebSocket always reach the same in-memory session map:

```shell
gcloud run deploy val-checker-riot-browser \
  --source ./cloud-browser \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --cpu 1 \
  --memory 2Gi \
  --concurrency 4 \
  --max-instances 1 \
  --timeout 600 \
  --set-env-vars CLOUD_BROWSER_PUBLIC_URL=https://YOUR-SERVICE.run.app \
  --set-secrets CLOUD_BROWSER_API_KEY=val-checker-cloud-browser-api:latest
```

`--allow-unauthenticated` lets a normal mobile browser load the viewer. Control
endpoints still require the API key and the WebSocket requires its independent
session token. Keep `max-instances=1` for this in-memory canary. Scaling past
one instance requires external session routing or per-session compute; do not
simply increase it.
