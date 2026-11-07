# Contributing

Bug fixes, compatibility improvements, documentation and Japanese/English translations are welcome. Contributions to this project are under the [MIT license](LICENSE).

Use the [English feedback form](https://forms.gle/GDChahyEi93FtYqk9) or [日本語フォーム](https://forms.gle/Ji97QbZP6zikcprw7) for ordinary bug reports and feature requests. Include reproducible steps and, optionally, diagnostic information copied from the extension’s Support page. Do not include credentials, session URLs, personal page text or browser profiles. Reports received through the form are not automatically published as issues.

## Development

Use Node.js 22+, run `npm ci`, then `npx playwright install chromium`. Run `npm test` and relevant browser tests; `npm run test:ci` runs the offline regression suite. Set `AD_BROWSER` to use a compatible alternative browser. All generated files belong in `.test-artifacts/`.

Keep changes focused. For rendering changes, check original-style restoration on OFF, dynamic content, typing/IME, native-theme detection and performance. Runtime code must remain bundled with the extension; no remote executable code or additional telemetry. New interface text must be present in both `extension/_locales/en` and `ja`.

Submit a pull request explaining the problem, resulting behavior and relevant validation. Maintainers may request changes or decline proposals to preserve scope. Financial support does not guarantee a particular feature, priority or response time.

日本語での不具合報告・修正提案も歓迎します。公開するコードや画像に個人情報を含めず、変更に関係するテストを実施してください。
