# Adaptive Dark

[日本語](README.ja.md) · [Send feedback](https://forms.gle/GDChahyEi93FtYqk9) · [Privacy](https://github.com/HugThePenguin/Adaptive-Darkmode-Extention/blob/main/PRIVACY.md)

A Manifest V3 extension for Chromium browsers that darkens bright websites, adjusts text contrast and lets you choose a warm, neutral or cool appearance. Rendering and preferences stay in the browser. No runtime dependencies, extension accounts, advertising or analytics.

## Features

- Adjustable brightness, color temperature and text contrast, with ordinary images/videos kept in their original colors.
- Auto mode preserves detected native dark themes. Detection is heuristic; explicit ON/OFF is available.
- Global defaults in Settings; popup changes override only the current hostname. Unchanged fields inherit the defaults.
- Early loading backgrounds, dynamic content, open Shadow DOM and embedded-frame handling.
- English/Japanese support forms and a diagnostic preview/copy tool that excludes website addresses, page text, input values and other sites’ settings. Nothing is submitted automatically.

## Install

Download the source or clone this repository. In your browser’s extension manager, enable Developer mode, choose **Load unpacked**, and select the **extension/** folder. Reload web pages. To update an existing unpacked installation, reload the extension and its open pages; saved preferences are retained.

Protected browser pages and some specialized embedded content cannot be modified. Native-theme detection is not perfect. Runtime files require no build or npm install.

## Feedback and support

Open **Support** in the popup to review/copy diagnostic information for that page, then submit the report on [Google Forms (English)](https://forms.gle/GDChahyEi93FtYqk9) or [日本語フォーム](https://forms.gle/Ji97QbZP6zikcprw7). Website URLs and reply email addresses are optional form fields. Reports are not automatically published on GitHub.

Publisher: **HugThePenguin** · Contact: **penguin.x.product@gmail.com**. GitHub Sponsors is being set up; no sponsor button is displayed until the profile is ready. See [maintainer notes](MAINTAINERS.md).

## Development

Use Node.js 22 or newer:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:ci
```

Tests use Brave on Windows when installed in its standard location, otherwise Playwright’s Chromium. Set **AD_BROWSER** to a compatible executable to override it. Branded Chrome/Edge builds may restrict command-line extension loading. The offline suite uses intercepted test fixtures rather than submitting forms or contacting routers.

Optional live checks: **test:browser**, **test:regressions**, **test:pedal**, **test:soundhouse**, **test:scroll -- --live**, **test:native -- --live**. Sites may deny access or change behavior; distinguish an unverified live result from a passing fixture. Historical **--before** comparisons need private local baseline copies and are not required for normal development.

Generated browser profiles, screenshots and results stay in **.test-artifacts/** and are not published. Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md) and [MAINTAINERS.md](MAINTAINERS.md) for details.

## License

Copyright (c) 2026 HugThePenguin. [MIT](LICENSE) applies to this project’s code, documentation and original icons. Development dependencies have their own licenses and are not bundled into the runtime extension.
