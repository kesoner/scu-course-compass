# 職涯導航 · GitHub Pages 展示版

公開展示網址：https://kesoner.github.io/scu-course-compass/

這是目前本機 MVP 的獨立靜態展示產物。Python 規則引擎透過固定版本 Pyodide 在瀏覽器 Web Worker 內執行，沒有對外 Python 伺服器。所有學生、成績及學籍資料都是共用 Mock；公開課程目錄是經 SHA-256 驗證的校方公開觀察版本。

支援四階段示範、課程探索、時間標記、規則檢查、預選確認、CSV、瀏覽器內版本與 IndexedDB 保存。不同裝置或瀏覽器不會同步。瀏覽器封鎖儲存時會明示僅暫存記憶體。

Gemini 未連線：意圖與方向使用現有程式內的明示示範，不能視為真實 AI 回應。PDF 按鈕未啟用。個人進度匯入、校方登入、後端管理及正式帳號驗證不提供。首次載入需下載 WebAssembly/Python 套件，需可存取 jsDelivr CDN；來源使用 Pyodide 314.0.7。

runtime.zip 只包含 allowlist 程式、合成資料、公開目錄與公開節次來源，不含 .env、API 金鑰、任何本機 runtime 資料庫或個人紀錄。不要將私人內容加入此公開倉庫。

部署：GitHub Pages 從 main 分支根目錄發布。本倉庫為建置產物，後續從原始工作區 deploy/github-pages/build.py 重建，再審核產物清單後更新。
