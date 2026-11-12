# ResearchCrew fetch helper (optional)

Web pages can't read most other websites because of CORS, so the app can't fetch arbitrary URLs on its own.
This tiny Node server (no dependencies) does it for you, on your own computer only.

```sh
cd server
node server.mjs --allow example.org,docs.example.com
# prints a token; paste it into Settings > Helper token, and set the helper URL to http://127.0.0.1:8788
```

Options: `--port 8788`, `--allow host[,host]` (subdomains included), `--origin https://your-copy.example` (defaults to
`https://shaikbasha1437.github.io`). Set `RC_TOKEN` to reuse a fixed token.

What it refuses:

- Requests without the token, or from page origins you didn't allow.
- Hosts that aren't on your allowlist, URLs with credentials, non-http(s) URLs.
- Hosts that resolve to private, loopback or link-local addresses, re-checked on every redirect (max 3).
- Non-text responses, anything over 2 MB, anything slower than 15 s.

It listens on 127.0.0.1 only and returns plain text (HTML is stripped). Chrome and Firefox ask before a public page
may reach localhost ("local network access"); allow it for the app's site only.
