# Maintainer notes

## Support links

`extension/support-config.js` contains the canonical English/Japanese Google Forms URLs and topic labels. Only the topic is prefilled through `entry.1236763802`. Do not add diagnostic data, site URLs, hostnames or settings to external-link query strings. If a form is recreated, verify the field ID and labels again. Never submit test reports to the live forms without an explicit reason.

## GitHub Sponsors: pending

The publisher is setting up GitHub Sponsors. `sponsorUrl` is intentionally empty, and sponsor sections are hidden. After the profile is approved and publicly accepts support:

1. Set `sponsorUrl` in `extension/support-config.js` to the approved HTTPS GitHub Sponsors profile.
2. Copy `.github/FUNDING.yml.example` to `.github/FUNDING.yml`, verify the account and enable Sponsorships in repository settings if needed.
3. Update the privacy policy and store description for any new information handling. The extension should only open the external support page; it must not collect payment information.
4. Check English/Japanese visibility, link destination, keyboard navigation and the popup height, then release an updated version.

The support tests currently assert that Sponsors is not configured. Update that expectation and add the live-link validation when enabling it.

## Privacy and feedback

Keep Forms and linked response spreadsheets private. Use reports only for triage, improvements and replies. Remove or anonymize reports when no longer needed, and honor identifiable deletion requests. Obtain permission before publishing a reporter’s details, screenshots or original text as an issue. The published privacy policy describes these practices.

## Release

The extension is loaded from `extension/`; its version is in `extension/manifest.json`. Keep package metadata and publication documents consistent. `extension/LICENSE.txt` must match the root `LICENSE`. The store ZIP contains only the files inside `extension/`, with `manifest.json` at the archive root. Do not include browser profiles, `.test-artifacts/`, `node_modules/`, credentials or other extensions.

`npm run prepare:store` updates the bilingual screenshots and `store/website/` privacy/demo files. The repository-root `index.html`, `privacy.css`, `demo.html` and `demo.js` are the public Pages copies; update them from `store/website/` when the policy or demo changes. Do not assume Pages is live until its public URL has been checked.
