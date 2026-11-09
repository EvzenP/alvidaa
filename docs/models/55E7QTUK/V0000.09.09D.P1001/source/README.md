# Archived probe pages

The one-off discovery pages from the 55E7QTUK phase-3 work, kept out of
`launcher/` so that directory stays the launcher and its general probes.

These are records, not tools. They were served from the launcher host while the
work was happening and post their results to `/api/probe` or `/api/recon`.
Nothing here is wired into the launcher, and nothing here is referenced by the
findings by filename; the findings describe what the pages measured.

The pages that are still part of the launcher (`index.html`, `debug.html`,
`fingerprint.html`, `identity.html`, `recon-55.html`, the hook pages that
findings cite, and `pub/*.js`) stayed in `launcher/`.
