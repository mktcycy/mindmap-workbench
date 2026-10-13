# 心智圖工作台 Mind Map Workbench

純前端的心智圖編輯器，部署在 GitHub Pages。

線上版：https://mktcycy.github.io/mindmap-workbench/

## 功能

- 建立多張心智圖，可改名、刪除
- 節點任意增刪：`Tab` 加子節點、`Enter` 加同層、雙擊或 `F2` 改文字、`Delete` 刪除（含底下整串分支）
- 每個節點可掛**超連結**與**備註**：選中節點 → 工具列「連結 / 備註」（或 `⌘K`）。
  有掛的節點會出現小圖示，點連結圖示開新分頁、點備註圖示跳出備註泡泡。
  網址只接受 `http://` / `https://`，沒寫協定會自動補 `https://`
- 存檔是明確動作：右上「儲存變更」或 `⌘S` / `Ctrl+S` 才寫入；未存的心智圖在左欄會顯示藍點
- 畫布可拖曳平移、滾輪／雙指縮放，「置中」一鍵把整張圖擺正
- 深色 / 淺色主題跟隨系統

## 資料存在哪裡

看 `app.js` 最上面的 `CONFIG`：

| 設定 | 行為 |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_KEY` 都有填（**目前就是這個模式**） | 走 Supabase，資料共用，任何開這個網址的人都看得到同一份、也能存檔 |
| 留空 | 退回瀏覽器的 localStorage，只留在這台裝置的這個瀏覽器 |

前端帶的是 Supabase 的 publishable（anon）key，本來就設計成公開；資料表的 RLS 開放匿名讀寫，
等於**知道網址的人都能新增 / 修改 / 刪除心智圖**。這是刻意的設計決定，不要把機密內容放進來。

### Supabase 資料表

```sql
create table public.mindmaps (
  id          text primary key,
  title       text not null default '未命名心智圖',
  data        jsonb not null,
  created_at  bigint not null,
  updated_at  bigint not null,
  node_count  int not null default 0
);
```

`data` 內容為 `{ rootId, nodes }`，`nodes` 是 `{ [id]: { id, text, parent, side, seq, url?, note? } }`。

## 檔案

- `index.html` — 版面與樣式
- `app.js` — 編輯器與資料層
