# 课堂云端版上线信息

- 网页：https://bingley-a.github.io/e-writing/
- 正式接口：https://e-writing-classroom-api.pages.dev
- 数据库：e-writing-classroom（Cloudflare D1 Free）
- 教师邀请码：一次使用、一年有效；首个邀请码到期时间为北京时间 2027 年 11 月 6 日 08:53。
- 入口使用免费 Cloudflare Pages Functions，复用同一个 D1；同时保留的 Worker 入口在当前网络遇到 workers.dev DNS 异常，网页不使用它。

注册老师时填写专用邀请码；学生留空。老师建班、取得学生加入码，学生注册后凭班级码加入。老师保存词库后，学生在同步、进入班级或开始练习前获取新版本。成绩按账号与班级保存在云端。

旧本地账号需重新注册，旧记录未自动迁移。当前线上初始词库保持原仓库的空词库状态；可选导入原词库备份。

后端更新：在 cloud-classroom 目录运行以下命令（需先登录 Cloudflare）：

```powershell
Copy-Item worker.mjs pages-api/public/_worker.js -Force
npx wrangler --cwd pages-api pages deploy public --project-name e-writing-classroom-api --branch main
```

生成其他教师邀请码（有效一年、仅一次）：

```powershell
npm run invite
npx wrangler d1 execute e-writing-classroom --remote --file=invite.sql
```

不要上传明文邀请码、登录凭证或数据库备份。免费额度不是无限，也不是永久免费承诺。

已通过真实线上联调：教师/学生注册、邀请码一次使用、建班与加入、词库修改与同步、学生修改被拒、成绩上传与教师查看、学生不可读取全班成绩。测试账号和临时班级已清理，正式教师邀请码未使用。
