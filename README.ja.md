# やさしいダーク — Adaptive Dark

[English](README.md) · [お問い合わせ](https://forms.gle/Ji97QbZP6zikcprw7) · [プライバシー](https://github.com/HugThePenguin/Adaptive-Darkmode-Extention/blob/main/PRIVACY.md)

Chromium系ブラウザ向けの、背景・文字のコントラスト・色温度を調整するManifest V3拡張機能です。配色処理と設定保存はブラウザ内で行います。実行時の外部ライブラリ、アカウント、広告、解析サービスはありません。

## 機能

- 明るい背景を暗くし、文字のコントラストを調整します。画像・動画は通常の色を維持します。
- 明るさ、暖色〜寒色、文字のコントラストを設定できます。
- 自動モードはサイト標準のダーク配色を検出した場合に変換を控えます。検出は完全ではありません。ON/OFFも選べます。
- 設定ページの既定値を全サイトに適用し、右上ペインの変更はそのサイトだけに適用します。
- 読み込み中の白い背景を抑える対策、動的な内容、open Shadow DOM、埋め込みフレームに対応します。
- サポート画面から日英のGoogleフォームへ移動できます。診断情報は確認してからコピーし、自分で送信できます。

## インストール

1. ソースをダウンロードするかリポジトリを取得します。
2. ブラウザの拡張機能管理画面でデベロッパーモードを有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」で **`extension` フォルダ**を選びます。
4. Webページを再読み込みします。更新時は拡張機能も再読み込みしてください。保存設定は引き継ぎます。

ソースのルートフォルダ全体や、ZIPそのものはローカル読み込みの対象ではありません。保護されたブラウザ画面や、一部の特殊な埋め込み内容は変更できません。

## 不具合・ご要望

右上ペインの「サポート」から、Googleフォームを開いてください。現在のページの配色設定を含む診断情報を確認・コピーできます。診断情報にサイトのアドレス、ページ本文、入力値、他のサイトの設定は含めず、自動送信しません。URLや返信先メールはフォームで任意入力します。

- [日本語フォーム](https://forms.gle/Ji97QbZP6zikcprw7)
- [English form](https://forms.gle/GDChahyEi93FtYqk9)

ソースはMITライセンスです。公開者は **HugThePenguin**、連絡先は **penguin.x.product@gmail.com** です。GitHub Sponsorsは準備中で、現時点の拡張機能に支援ボタンは表示しません。開通後の追加方法は [MAINTAINERS.md](MAINTAINERS.md) を参照してください。

## 開発・検証

Node.js 22以降を使用します。

```sh
npm ci
npx playwright install chromium
npm test
npm run test:ci
```

WindowsでBraveが標準位置にインストールされている場合はBraveを使い、それ以外ではPlaywrightのChromiumを使います。`AD_BROWSER` 環境変数で別の互換ブラウザの実行ファイルを指定できます。Chrome/Edgeの製品版は、テスト用のコマンドラインによる拡張機能読み込みが制限される場合があります。

`test:ci` は外部サイトに依存しない模擬ページを使います。実サイトを含む検証は `test:browser`、`test:regressions`、`test:pedal`、`test:soundhouse`、`test:scroll -- --live`、`test:native -- --live` です。外部サイトのアクセス制限や仕様変更で検証できない場合があります。`--before` は開発時の旧版コピーが必要な比較用オプションで、通常のテストには不要です。

プロファイル・スクリーンショット・診断・結果は `.test-artifacts/` に保存し、公開しません。コードや翻訳への貢献方法は [CONTRIBUTING.md](CONTRIBUTING.md)、セキュリティ上の連絡は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

Copyright (c) 2026 HugThePenguin. [MIT](LICENSE)。本プロジェクトのコード・文書・オリジナルのアイコンに適用します。開発用の依存ライブラリにはそれぞれのライセンスが適用され、拡張機能の実行パッケージには同梱しません。
