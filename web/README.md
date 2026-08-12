# web/ — the browser verifier

`verify.html` is a single self-contained file: no build step, no npm, no bundler, no
CDN. Save it to disk and it keeps working — that is the only kind of verifier worth
having, because a verifier you must fetch from someone is a verifier they can change.

Deploy (static, nothing to build):

```
vercel deploy --prod
```

## About the CSP in `vercel.json`

The page loads no third-party code **by design**. The Content-Security-Policy makes
that structural rather than a promise:

- `default-src 'none'` — nothing loads by default.
- `script-src 'unsafe-inline'` — the verifier's own inline script runs, and **no
  external script can**. The usual objection to `'unsafe-inline'` is that it permits
  injected script; here there is no server, no user-supplied HTML and no template, so
  the only thing it permits is the code you can read in the file. What it forbids is
  the thing that would actually hurt: pulling in a library later.
- `connect-src https:` — deliberately *not* pinned to one host. The RPC endpoint is
  user-editable on purpose: a lying RPC can feed the page a lying record, so the
  answer is to let a skeptic point it at their own node, or at two they do not
  control, and compare.

If a future edit tries to add a `<script src>`, the browser refuses it instead of
quietly widening the trust surface.
