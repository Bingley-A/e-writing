# e-writing 班级云端版

网站：https://bingley-a.github.io/e-writing/

- 学生：用昵称和至少8位密码注册，教师邀请码留空，输入老师提供的班级码加入。
- 教师：注册时填写管理员私下发放的一次性教师邀请码（有效一年），创建班级后分享学生加入码。
- 各班词库独立；老师可添加、覆盖、编辑、删除或清空词语。学生进入班级、点击同步或开始练习前获取最新词库。
- 练习成绩保存到云端，老师只能查看自己班级的学生记录。
- 旧版本地账号需重新注册；原本地数据未删除，但不自动迁移。

网页托管在 GitHub Pages，API 托管在 Cloudflare Pages Functions，数据库使用 D1 Free。教师邀请码不放在公开仓库。

后端源代码见 `cloud/`。当前公网 API 为 `https://e-writing-classroom-api.pages.dev`，这是公开配置，不是密钥。详情见 `CLOUD-DEPLOYMENT.md`。
