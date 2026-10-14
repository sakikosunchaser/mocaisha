# Mosaica

一个以 React、TypeScript、Socket.IO 构建的秘密身份桌游 Web MVP。游戏状态和裁判逻辑运行在服务端；客户端只收到公开局势，以及发给当前玩家的私密身份信息。

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

打开 Vite 显示的本地地址。开发环境前端默认运行于 `5173`，Socket.IO 服务端运行于 `3001`。

## 当前规则范围

- 5–10 人；支持创建房间、凭房间码加入，以及刷新后恢复座位。
- 在当前浏览器设备上记住上次成功使用的昵称；可随时编辑，不需要 QQ 授权。
- 身份在服务端洗牌分配：魔法少女阵营包含凭依者、大侦探和普通魔法少女；魔女阵营包含半魔女、善良魔女和普通魔女。
- 凭依者能看到非善良魔女；大侦探知道凭依者与半魔女的身份组合；魔女能看到其他魔女。
- 进行队伍提名、全员投票、匿名任务行动和任务结算。连续三次提名未通过后，下一次提名自动通过。
- 7 人及以上的第 4 轮任务需要至少 2 次破坏才会失败；魔女累计 3 次破坏立即获胜。
- 每局为玩家随机分配不重复的公开角色牌；宝生玛格只会出现在 7 人局。第 3 轮开始前进行魔法竞选，候选人不投票，并列时仅并列候选人重新投票。
- 13 张角色牌均已接入对应阵营的技能处理，包括侵染封锁、第二轮重开/改写、第三轮行动调整、身份调查与身份交换。希罗魔女方改写第二轮时会公开更新结果和比分；希罗魔法少女方重开的第二轮结果仅本人可见，雪莉的改写也不会追溯改写已公开记录。隐藏任务结果、身份和技能查验信息由服务端按玩家隔离发送；公开比分不包含隐藏的任务结果，但胜负始终由服务端完整计数判定。
- 第 3–5 轮任务结束后进入侵染阶段。魔女阵营选择一位玩家：命中凭依者则魔女获胜，选错则魔法少女获胜；选择者不会公开。
- 房间和对局暂存在服务端内存中；重启服务端会清空对局，暂不包含持久化存储。
- 大厅中点击“返回主页”会从房间移除该玩家；房主离开时自动移交房主权限。游戏开始后不可退出当前对局，以免破坏进行中的流程。

## 常用命令

```bash
npm run dev
npm run build
npm test
```

生产构建生成 `dist/`。设置 `PORT` 可修改服务端端口；生产环境可将 `CLIENT_ORIGIN` 设置为允许的前端来源。

## GitHub 自动部署

将项目放进 GitHub 仓库后，推送到 `main` 或 `master` 分支会自动运行测试、构建并部署到服务器；也可在 GitHub Actions 页面手动运行部署。首次配置只需一次：

1. 在 GitHub 创建空仓库，并确认可见性。当前配置的 `sakikosunchaser/mocaisha` 是公开仓库，推送后所有人都可以查看代码；如要保护源码，应先在 GitHub 将其改为私有。首次推送前，先完成服务器 SSH 部署账号和仓库 Secrets 配置。
2. 在服务器上创建专用部署账号，并允许其写入 `/opt/mosaica`、重启服务：

   ```bash
   apt update && apt install -y sudo
   useradd --create-home --shell /bin/bash mosaica-deploy
   install -d -o mosaica-deploy -g mosaica-deploy /opt/mosaica
   chown -R mosaica-deploy:mosaica-deploy /opt/mosaica
   install -d /etc/systemd/system/mosaica.service.d
   printf '[Service]\nUser=mosaica-deploy\nGroup=mosaica-deploy\n' > /etc/systemd/system/mosaica.service.d/override.conf
   systemctl daemon-reload
   systemctl restart mosaica
   systemctl status mosaica --no-pager -l
   printf '%s\n' 'mosaica-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart mosaica, /usr/bin/systemctl status mosaica --no-pager -l' > /etc/sudoers.d/mosaica-deploy
   chmod 440 /etc/sudoers.d/mosaica-deploy
   visudo -cf /etc/sudoers.d/mosaica-deploy
   install -d -o mosaica-deploy -g mosaica-deploy -m 700 /home/mosaica-deploy/.ssh
   ```

3. 在自己的电脑上生成专用 SSH 密钥。私钥只添加到 GitHub Secrets，公钥安装到服务器账号：

   ```powershell
   ssh-keygen -t ed25519 -C "github-actions-mosaica" -f "$HOME\.ssh\mosaica_deploy"
   Get-Content "$HOME\.ssh\mosaica_deploy.pub"
   ```

   将公钥整行添加到服务器 `/home/mosaica-deploy/.ssh/authorized_keys`，然后设置权限：

   ```bash
   chown mosaica-deploy:mosaica-deploy /home/mosaica-deploy/.ssh/authorized_keys
   chmod 600 /home/mosaica-deploy/.ssh/authorized_keys
   ```

4. 在服务器运行 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 记下 SSH 主机指纹；在本机运行 `ssh-keyscan -t ed25519 -p 22 110.42.33.50` 取得 known_hosts 行，并核对其指纹与服务器一致。
5. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：
   - `DEPLOY_HOST`：服务器 IP，例如 `110.42.33.50`
   - `DEPLOY_USER`：`mosaica-deploy`
   - `DEPLOY_PORT`：`22`
   - `DEPLOY_SSH_KEY`：`mosaica_deploy` 私钥文件的完整内容（不要提交或发送给任何人）
   - `DEPLOY_KNOWN_HOSTS`：已核对指纹的 `ssh-keyscan` 输出行

完成后，每次 `git push` 到 `main`，GitHub Actions 会自动部署并检查 `/health`。失败时可在 GitHub Actions 页面查看日志。GitHub Actions workflow 使用 `actions/checkout@v4` 和 `actions/setup-node@v4`；生产部署会在服务器重新安装依赖、运行测试和构建，再重启 systemd 服务。
