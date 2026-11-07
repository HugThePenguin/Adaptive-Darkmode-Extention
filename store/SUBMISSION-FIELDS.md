# Chrome Web Store submission fields

Version: 1.6.0 · Publisher: HugThePenguin · Contact: penguin.x.product@gmail.com

以下の英文を該当欄へコピーできます。現行実装に合わせて、公開者へ送信しないローカル処理も開示しています。

## Single purpose description

Provide a customizable darker appearance for websites by adjusting backgrounds, text contrast, and color temperature, while preserving detected native dark themes.

## storage permission justification

Stores global appearance preferences and per-hostname settings locally in the browser. This includes mode, brightness, color temperature, text contrast, and the optional CSS background-image setting. No settings are sent to a server or synchronized to the cloud.

## Host permissions justification — http://*/* and https://*/*

The extension applies user-selected appearance adjustments automatically on ordinary HTTP and HTTPS websites, including dynamically added content and embedded frames. Access to those websites is necessary to inspect computed styles, detect native dark themes, and change CSS colors. The current tab's hostname selects local site preferences and keeps frame settings consistent. Website text and browsing activity are not sent to the publisher. Users can pause adjustments globally or for each website. Protected browser pages are excluded by the browser.

## Remote code

選択：**No, I am not using remote code.**

All executable extension code is included in the uploaded package. No JavaScript, WebAssembly, or executable instructions are downloaded. Loading an image already referenced by the current website is used only to inspect image dimensions and does not execute remote code.

## Data usage

本実装はローカルであってもWebサイトの内容とURLを使用します。「何も扱わない」とするのではなく、次を開示する形で準備しています。

- **Website content**：ページの要素、計算済みスタイル、画面内の文字の有無をブラウザ内で確認。本文・入力値の記録や公開者への送信は行いません。
- **Web history**：現在のサイトのURL／ホスト名を参照し、ユーザーが設定したサイトのホスト名を設定に保存。履歴APIや閲覧ログは使いません。
- **任意のお問い合わせ**：サポート画面からGoogleフォームを開き、利用者が入力・送信した報告本文、任意のURL・診断情報・連絡用メールアドレスを公開者が受け取ります。自動送信ではありません。公開者は回答内容を非公開で保管し、調査・要望の検討・返信に使用します。Googleもフォームの提供者として情報を処理します。連絡先・通信内容など、ダッシュボードの各項目の説明に照らしてこの任意の収集も開示してください。

画面の選択肢・説明に照らしてこれらを申告し、自由記述欄がある場合は次の説明を使用できます。

Website content and the current URL/hostname are processed locally to adjust appearance and select site preferences. Configured hostnames are stored locally. The extension does not create a browsing-history log or automatically transmit page text, form values or preferences. It may load a background image already referenced by the website to determine its dimensions. The Support page previews a diagnostic report containing the extension/Chromium version, OS, UI language, appearance settings and state, excluding website addresses, page/input text and other sites’ preferences. Users may copy it and voluntarily submit feedback, an optional URL and optional contact email through Google Forms. Google processes the form, and the publisher uses submitted reports privately for troubleshooting, requests and replies.

データ利用に関する確認項目は、実装と一致するため、販売しない・単一目的と無関係に利用しない・信用力／融資判断に利用しない、という各項目を確認して申告できます。

## Privacy policy URL

公開サイトが正常に表示されることを確認後、次のURLを入力します。

https://github.com/HugThePenguin/Adaptive-Darkmode-Extention/blob/main/PRIVACY.md

## Reviewer test instructions

No login, payment, or test credentials are required.

1. Install the extension and allow it to run on websites. Reload an ordinary web page, such as https://example.com/.
2. Open the toolbar popup. Auto should apply a darker background on the light page. Move the color temperature slider between warm and cool and release it to save the setting. Check brightness and text contrast controls.
3. Choose OFF. The original website appearance should return and adjustment controls should be disabled. Choose ON to apply adjustments again.
4. For a reproducible native-dark test, open https://hugthepenguin.github.io/Adaptive-Darkmode-Extention/demo.html. Click “Dark theme” on that page, then select Auto in the extension. The native theme should be preserved, controls disabled, and the status should indicate that the website's dark mode is in use. Choose ON to override automatic detection.
5. Click “Edit defaults” in the popup. The Settings tab edits global defaults and the master enable switch. Website tabs edit per-hostname overrides; unchanged fields inherit global defaults. Reset one website from its tab or delete all website settings from Settings. Changes are saved automatically. Global OFF overrides site preferences. The English or Japanese interface follows the browser's UI language.
6. Open “Support” from the popup. Review the diagnostic information and copy it if desired. The English/Japanese feedback buttons open the publisher's Google Forms, prefilling only the topic. No report is submitted automatically. Sponsors links are hidden while the publisher's profile is being set up. The extension and source are MIT licensed.

Before submission, confirm that both the privacy-policy URL and the demo page open successfully.

## Privacy consistency

The store description, this disclosure, and `website/index.html` describe the same implementation. Local access/storage still needs disclosure under the [Chrome User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq). Permission and remote-code fields follow the [official privacy-field guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).
