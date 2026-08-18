# Google Sheets OAuth Client IDs

Two separate "Chrome Extension" type OAuth clients exist in the
`indiamart-extension-notifier` Cloud project, because `chrome.identity.getAuthToken`
validates the client against the *exact* extension ID making the request — a single
client can't serve both the published build and a locally-loaded unpacked build, since
those have different IDs.

| Purpose | Extension ID it's bound to | Client ID |
|---|---|---|
| **Production** (published Chrome Web Store build) | `bgbcnhgmphhdnpdhjfhbefhdakcjafmm` | `797004741619-qgmsjp8q20mnnuekrr7vbchihpkd0838.apps.googleusercontent.com` |
| **Local dev** (unpacked build, any machine/folder) | `lpfajdjpbifcgmbhlpendjhdefeddokn` | `797004741619-mm5bkfld3cuplsa1dgutt2fet06026g8.apps.googleusercontent.com` (client renamed "Local Setup") |

**The checked-in `public/manifest.json` must always hold the production config**:
`oauth2.client_id` set to the **production** value above, and **no `"key"` field**.
This is what gets committed and pushed — never the local-dev values below.

To test the Sheets export feature with an unpacked build, edit your local working copy
of `manifest.json` (uncommitted): swap `client_id` to the **local dev** value, and add
back the `"key"` field from the section below. Do **not** commit or push that state —
`git status` should show `public/manifest.json` as modified while you're testing
locally, and that diff should never be staged. Discard it (or swap the values back)
before committing anything else in the file.

Why this direction, not the other way: a commit briefly shipped the local-dev
client_id (and no `key`) as the repo default, which would break `chrome.identity.getAuthToken`
for every real install if it had reached the Chrome Web Store build — `bad client id`,
since production installs carry the production extension ID, not the dev one. Keeping
production as the committed default means a build straight off `main`, zipped with no
extra steps, is always Store-safe; the local-dev swap is the one that must be
deliberate and temporary.

The local-dev extension ID is **pinned**, not path-derived: adding this `"key"` field
(the base64 DER-encoded public half of a throwaway RSA keypair) to your local
`manifest.json` makes Chrome compute `lpfajdjpbifcgmbhlpendjhdefeddokn` for *any*
unpacked load of this manifest, regardless of machine or folder path. This is what lets
multiple dev machines share one `drive.file` grant — e.g. a sheet picked on one dev
machine is already accessible from another, the same way it already works between two
production installs. The matching private key isn't needed anywhere in this repo or
elsewhere — only the public half below is required for Chrome to derive the ID.
Do **not** regenerate this key casually; doing so changes the ID and breaks every dev
machine's existing `drive.file` grants until the "Local Setup" client's Item ID (and
this doc) are updated to match.

```
"key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzY7gMPTawMxdCBZCLJhnwmXLS0nz5FXlYA0boI+KZJ+jMbbBIQR4DO8pioA0+toRuUfDVSola9vc5VePaKWQpdd8UhwgS0KUeyOKBILZXKbmMsya9f/KcsOtF+JRf/PKT0324bol5zb7p4Q1f2aUYWiK6CtVLJ5UQHYE0EZ6EAN3dCjQfWKY8O/t8BGJ5vV7UatYx4gqpSvnVY9aCvibzfN4WewytkWMs3hOdHqc3aPclvs4Pfgw5YIIm4+ALQltpbEYymWBOTUBjsnlbCh9t09ZaRUkIZ5va4oeAnCmsJ5uxHpPDzpwIerE7PiWRRYvSXqC0x+jSJ8GKNcyRyl76wIDAQAB"
```


`open -na "Google Chrome" --args --user-data-dir="$HOME/chrome-computer-b"`
use this open secondary chrome