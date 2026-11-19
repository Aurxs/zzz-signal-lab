# 欧非鉴定所 · Signal Lab

《绝区零》玩家调频记录鉴定工具。理论百分位根据同池、同 UP 数量的离散概率分布计算。打开 `dist/` 中的站点即可使用计算器。截图在浏览器内处理。分享车票上的二维码在本机生成，打开对应卡池、UP 数量和总抽数的结果链接。链接使用出票时的域名。

## 静态托管

`dist/` 已含页面和资源，无需构建。可在本地仓库根目录运行 `python3 -m http.server 8000 --directory dist`，然后访问 `http://localhost:8000`。发布到 GitHub Pages 时，把 `dist/` 里的内容作为 Pages 构件。纯静态托管提供理论鉴定和本地交互。

## 启用跨设备样本榜

仓库附带 Cloudflare Pages Functions 入口 `functions/api/sample.js` 和 D1 迁移目录 `db/`（按编号应用 0001、0002）。在仓库根目录完成以下步骤即可发布到自己的 Cloudflare 账户。

1. 运行 `npx wrangler login`，然后运行 `npx wrangler d1 create luck-samples`，记下返回的数据库 ID。
2. 在根目录新建 `wrangler.jsonc`，将下面的示例 ID 换成真实值。将 `name` 改为自己的 Pages 项目名。

```json
{
  "name": "luck-signal",
  "pages_build_output_dir": "./dist",
  "compatibility_date": "2025-04-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "luck-samples",
      "database_id": "<database-id>",
      "migrations_dir": "db"
    }
  ]
}
```

3. 本地验证可运行 `npx wrangler d1 migrations apply luck-samples --local` 和 `npx wrangler pages dev dist`。打开本地站点的 `/api/sample`，数据库就绪时返回 `{"available":true}`。
4. 正式发布前，运行 `npx wrangler d1 migrations apply luck-samples --remote`。首次发布可先运行 `npx wrangler pages project create luck-signal --production-branch main`，将项目名换成配置中的值，再运行 `npx wrangler pages deploy dist --branch main`。Wrangler 会一起部署根目录中的 `functions/`。
5. 如使用 Git 集成，仓库根目录保留 `functions/`，构建输出目录设为 `dist`。在目标环境绑定同名 D1 数据库并应用迁移。

[Cloudflare Pages Functions 文档](https://developers.cloudflare.com/pages/functions/get-started/) · [D1 绑定](https://developers.cloudflare.com/pages/functions/bindings/) · [D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)

### 样本口径

浏览器从截图中识别到调频统计数字后，核对界面会显示默认关闭的「匿名提交到样本榜」选项。勾选并确认鉴定后，前端向同源 `POST /api/sample` 发送 `pool`、`count`、`total` 及本机生成的随机 UUID `device`。截图留在本机。后端在数据库中仅存储卡池、UP 数、总抽数及按卡池散列的标识。每个浏览器、每个卡池保留最新一次提交，重复提交会更新原记录。清除浏览器数据或更换设备可产生新的标识。

界面显示本次提交状态。接口返回同组样本数 `size` 和欧气百分位 `percentile`，仅与同卡池、同 UP 数量的记录比较，当前提交计入样本。同抽数的记录平分名次。样本由玩家自愿提供并自行核对，样本百分位仅描述这些提交。服务端无法验证图片来源和内容。
