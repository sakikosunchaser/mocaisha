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
- 进行队伍提名、全员投票、匿名任务行动和任务结算。组队投票采用阿瓦隆多数制（赞成须超过半数），投票全部提交后公开每位玩家的票型；连续三次提名未通过后，下一次提名自动通过。
- 7 人及以上的第 4 轮任务需要至少 2 次破坏才会失败；魔女累计 3 次破坏立即获胜。
- 每局为玩家随机分配不重复的公开角色牌；宝生玛格只会出现在 7 人局。第 3 轮开始前进行一次魔法竞选；候选人不投票，其他玩家可弃票，并列时仅并列候选人重新投票，所有投票者弃票时跳过竞选。竞选胜者须发动魔法；米莉亚可将技能保留到侵染阶段。
- 13 张角色牌均已接入对应阵营的技能处理，包括侵染封锁、第二轮重开/改写、第三轮行动调整、身份调查与身份交换。希罗魔女方改写第二轮时会公开更新结果和比分；希罗魔法少女方重开的第二轮结果仅本人可见，雪莉的改写也不会追溯改写已公开记录。隐藏任务结果、身份和技能查验信息由服务端按玩家隔离发送；公开比分不包含隐藏的任务结果，但胜负始终由服务端完整计数判定。
- 第 3–5 轮任务结束后进入侵染阶段。魔女阵营只能选择固定魔法少女阵营的玩家，命中其当前身份卡上的凭依者则魔女获胜，选错则魔法少女获胜；身份牌互换不会改变玩家阵营或目标资格。若亚里沙封锁侵染的回合同时完成第三次破解，则魔法少女立即获胜；选择者不会公开。
- 房间和对局暂存在服务端内存中；重启服务端会清空对局，暂不包含持久化存储。
- 大厅中点击“返回主页”会从房间移除该玩家；房主离开时自动移交房主权限。游戏开始后不可退出当前对局，以免破坏进行中的流程。

## 常用命令

```bash
npm run dev
npm run build
npm test
```

生产构建生成 `dist/`。设置 `PORT` 可修改服务端端口；生产环境可将 `CLIENT_ORIGIN` 设置为允许的前端来源。

## 发布到 GitHub 与手动更新服务器

推送到 GitHub 仅用于备份和保存代码，不会自动更新服务器。当前仓库 `sakikosunchaser/mocaisha` 是公开仓库，推送后所有人都可以查看源码。

本地提交并推送代码：

```powershell
git add .
git commit -m "Describe your changes"
git push origin main
```

服务器更新需单独手动进行。此公开仓库可通过 HTTPS 直接克隆，不需要 SSH 密钥或 GitHub token。首次迁移和后续更新都在服务器 root 终端中一次性执行下面整段命令。它先在独立目录克隆、测试和构建；成功后才切换版本，并在健康检查失败时恢复旧目录。请勿分开执行其中的命令，因为目录变量只在当前终端会话中有效。

```bash
set -eu
if ! command -v git >/dev/null 2>&1; then
  apt update
  apt install -y git
fi
STAMP="$(date +%Y%m%d-%H%M%S)"
NEXT="/opt/mosaica-next-$STAMP"
BACKUP="/opt/mosaica-backup-$STAMP"
FAILED="/opt/mosaica-failed-$STAMP"
runuser -u mosaica-deploy -- git clone --branch main https://github.com/sakikosunchaser/mocaisha.git "$NEXT"
runuser -u mosaica-deploy -- bash -lc "cd '$NEXT' && npm ci && npm test && npm run build && npm prune --omit=dev"
systemctl stop mosaica
if [ -e /opt/mosaica ]; then
  mv /opt/mosaica "$BACKUP"
fi
if ! mv "$NEXT" /opt/mosaica; then
  if [ -e "$BACKUP" ]; then mv "$BACKUP" /opt/mosaica; fi
  systemctl start mosaica
  exit 1
fi
systemctl start mosaica
for attempt in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:3001/health; then
    echo
    echo "Mosaica update succeeded."
    exit 0
  fi
  sleep 1
done
echo "Health check failed; restoring the previous version."
systemctl stop mosaica || true
mv /opt/mosaica "$FAILED"
if [ -e "$BACKUP" ]; then
  mv "$BACKUP" /opt/mosaica
  systemctl start mosaica
  curl --fail --silent http://127.0.0.1:3001/health
  echo
fi
exit 1
```

成功时会打印 `Mosaica update succeeded.` 以及 `{"status":"ok"}`。如果测试或构建失败，脚本会在切换前停止，不影响当前服务。请勿在仓库或服务器项目目录中保存 SSH 私钥。
