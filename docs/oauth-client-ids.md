# Google Sheets OAuth Client IDs

Two separate "Chrome Extension" type OAuth clients exist in the
`indiamart-extension-notifier` Cloud project, because `chrome.identity.getAuthToken`
validates the client against the *exact* extension ID making the request — a single
client can't serve both the published build and a locally-loaded unpacked build, since
those have different IDs.

| Purpose | Extension ID it's bound to | Client ID |
|---|---|---|
| **Production** (published Chrome Web Store build) | `bgbcnhgmphhdnpdhjfhbefhdakcjafmm` | `797004741619-qgmsjp8q20mnnuekrr7vbchihpkd0838.apps.googleusercontent.com` |
| **Local dev** (unpacked `dist/` build, current machine/folder) | `eaahfeboagapmmcgoldghmfpegaknkjh` | `797004741619-mm5bkfld3cuplsa1dgutt2fet06026g8.apps.googleusercontent.com` |

`public/manifest.json`'s `oauth2.client_id` currently holds the **local dev** value, for
testing the Sheets export feature with an unpacked build.

**Before publishing any update to the Chrome Web Store**, swap `client_id` back to the
**production** value above — otherwise real installs (which have the production
extension ID) will fail with `bad client id`, the same error the dev ID fixed locally.

If the unpacked extension's folder path ever changes, Chrome will assign a new dev
extension ID, and a new "Local dev" OAuth client (with a new Item ID) will need to be
created to match it.
