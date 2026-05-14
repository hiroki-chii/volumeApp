const fs = require('fs');
fs.appendFileSync('../workLoggerApp/history.md', '\n### 実行ファイルのビルド\n- 2026-05-01 11:11: 最新の修正（ルール編集機能など）を反映して再ビルドを実施。\n- `npm run build` を実行し、`dist-pulse` フォルダ内の `PulseWork 1.0.0.exe` を更新。\n', 'utf8');
