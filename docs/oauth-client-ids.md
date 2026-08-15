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

`public/manifest.json`'s `oauth2.client_id` currently holds the **local dev** value, for
testing the Sheets export feature with an unpacked build.

**Before publishing any update to the Chrome Web Store**, swap `client_id` back to the
**production** value above — otherwise real installs (which have the production
extension ID) will fail with `bad client id`, the same error the dev ID fixed locally.

**Also remove the `"key"` field from `manifest.json` before zipping for upload.** It
only exists to pin the local-dev extension ID (see below) — the production extension
already has a permanent ID assigned by the Chrome Web Store at first publish, unrelated
to this key, so the field serves no purpose in a Store upload and should not ship in it.

The local-dev extension ID is now **pinned**, not path-derived: `public/manifest.json`
carries a `"key"` field (the base64 DER-encoded public half of a throwaway RSA keypair)
that makes Chrome compute `lpfajdjpbifcgmbhlpendjhdefeddokn` for *any* unpacked load of
this manifest, regardless of machine or folder path. This is what lets multiple dev
machines share one `drive.file` grant — e.g. a sheet picked on one dev machine is
already accessible from another, the same way it already worked between two production
installs. The matching private key isn't needed anywhere in this repo or elsewhere —
only the public half (already in the manifest) is required for Chrome to derive the ID.
Do **not** regenerate this key casually; doing so changes the ID and breaks every dev
machine's existing `drive.file` grants until the "Local Setup" client's Item ID (and
this doc) are updated to match.
