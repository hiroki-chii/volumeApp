# Volume App

Windowsのタスクバー上でマウスホイールを操作し、システム音量を調整するTauri 2アプリです。

## 開発

```powershell
npm install
npm run dev
```

## 配布用ビルド

```powershell
# WebView2 Runtimeを利用するポータブル実行ファイル
npm run dist

# NSISインストーラー
npm run bundle
```

`npm run dist` の成果物は `src-tauri/target/release/volume-app.exe` に生成されます。

## 操作

- タスクバー上でマウスホイール: 音量調整
- タスクバー上で中クリック: ミュート切り替え
- トレイメニュー: 設定表示・終了
- OSDの音量バー: クリックした位置へ音量を変更

設定した音量ステップはTauriのアプリ設定ディレクトリへ保存します。初回起動時は、既存Electron版の `%APPDATA%\\volume-app\\settings.json` があれば読み込みます。
