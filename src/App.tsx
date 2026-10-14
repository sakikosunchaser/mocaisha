import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActionResponse,
  CharacterId,
  GameUpdate,
  IdentityId,
  MagicAction,
  MissionAction,
  SessionResponse
} from "../shared/game";
import { getCampLabel, getWitchCount, MAX_PLAYERS, MIN_PLAYERS } from "../shared/rules";
import { CHARACTER_CARDS } from "../shared/characters";
import { socket } from "./socket";

interface SavedSession {
  code: string;
  playerId: string;
}

const SESSION_KEY = "mosaica.session";
const NICKNAME_KEY = "mosaica.nickname";

function readSavedSession(): SavedSession | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      "playerId" in value &&
      typeof value.code === "string" &&
      typeof value.playerId === "string"
    ) {
      return { code: value.code, playerId: value.playerId };
    }
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
  return null;
}

function readSavedNickname(): string {
  try {
    const nickname = localStorage.getItem(NICKNAME_KEY);
    return nickname && nickname.length <= 20 ? nickname : "";
  } catch {
    return "";
  }
}

export default function App() {
  const [session, setSession] = useState<SavedSession | null>(readSavedSession);
  const [update, setUpdate] = useState<GameUpdate | null>(null);
  const [nickname, setNickname] = useState(readSavedNickname);
  const [roomCode, setRoomCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onUpdate = (nextUpdate: GameUpdate) => setUpdate(nextUpdate);
    const onError = (message: string) => setNotice(message);
    socket.on("game:update", onUpdate);
    socket.on("room:error", onError);

    const reconnect = () => {
      const saved = readSavedSession();
      if (!saved) return;
      socket.emit("room:reconnect", saved, (response) => {
        if (!response.ok) {
          localStorage.removeItem(SESSION_KEY);
          setSession(null);
          setUpdate(null);
          setNotice(response.error ?? "无法恢复房间连接，请重新加入。");
          return;
        }
        setSession(saved);
      });
    };
    socket.on("connect", reconnect);
    if (socket.connected) reconnect();

    return () => {
      socket.off("game:update", onUpdate);
      socket.off("room:error", onError);
      socket.off("connect", reconnect);
    };
  }, []);

  const perform = useCallback(
    (action: (callback: (response: ActionResponse) => void) => void) => {
      setBusy(true);
      action((response) => {
        setBusy(false);
        setNotice(response.ok ? "" : response.error ?? "操作失败，请重试。");
      });
    },
    []
  );

  const joinOrCreate = (mode: "create" | "join") => {
    const cleanName = nickname.trim();
    if (!cleanName) {
      setNotice("先给自己取一个昵称吧。");
      return;
    }
    setBusy(true);
    const onResponse = (response: SessionResponse) => {
      setBusy(false);
      if (!response.ok || !response.code || !response.playerId) {
        setNotice(response.error ?? "无法加入房间，请重试。");
        return;
      }
      let nicknameSaved = true;
      try {
        localStorage.setItem(NICKNAME_KEY, cleanName);
      } catch {
        nicknameSaved = false;
      }
      const nextSession = { code: response.code, playerId: response.playerId };
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setNotice(nicknameSaved ? "" : "已加入房间，但浏览器无法记住昵称。");
    };
    if (mode === "create") {
      socket.emit("room:create", cleanName, onResponse);
    } else {
      socket.emit("room:join", { code: roomCode, name: cleanName }, onResponse);
    }
  };

  const leaveRoom = () => {
    if (!socket.connected) {
      setNotice("连接已断开，暂时无法离开房间；请恢复连接后重试。");
      return;
    }
    setBusy(true);
    socket.emit("room:leave", (response) => {
      setBusy(false);
      if (!response.ok) {
        setNotice(response.error ?? "无法离开房间，请重试。");
        return;
      }
      localStorage.removeItem(SESSION_KEY);
      setSession(null);
      setUpdate(null);
      setNotice("");
    });
  };

  if (!session || !update) {
    return (
      <Landing
        busy={busy}
        nickname={nickname}
        notice={notice}
        roomCode={roomCode}
        onCreate={() => joinOrCreate("create")}
        onJoin={() => joinOrCreate("join")}
        onNicknameChange={setNickname}
        onRoomCodeChange={setRoomCode}
      />
    );
  }

  return (
    <GameRoomView
      busy={busy}
      notice={notice}
      onAction={perform}
      onLeave={leaveRoom}
      onNotice={setNotice}
      playerId={session.playerId}
      update={update}
    />
  );
}

interface LandingProps {
  busy: boolean;
  nickname: string;
  roomCode: string;
  notice: string;
  onNicknameChange: (value: string) => void;
  onRoomCodeChange: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}

function Landing(props: LandingProps) {
  return (
    <main className="landing-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Mosaica 首页">
          <span className="brand-mark">M</span>
          <span>MOSAICA</span>
        </a>
        <span className="topbar-note">A game of hidden loyalties</span>
      </header>

      <section className="landing-grid">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> 秘密身份 · 实时联机</span>
          <h1>相信你的<br /><em>直觉。</em></h1>
          <p className="hero-description">
            有些人正在守护机关，有些人正悄悄将它摧毁。
            找到同伴，识破谎言，在最后一票落下前决定你相信谁。
          </p>
          <div className="hero-stats">
            <div><strong>{MIN_PLAYERS}–{MAX_PLAYERS}</strong><span>位玩家</span></div>
            <i />
            <div><strong>5</strong><span>轮机关</span></div>
            <i />
            <div><strong>{getWitchCount(8)}</strong><span>位魔女（8人局）</span></div>
          </div>
          <div className="decor-orbit orbit-one" />
          <div className="decor-orbit orbit-two" />
        </div>

        <section className="entry-card">
          <div className="card-kicker">准备好了吗？</div>
          <h2>进入游戏</h2>
          <p className="card-subtitle">创建一个新房间，或加入朋友的房间。</p>
          <label className="field-label" htmlFor="nickname">你的昵称 <span>自动记住</span></label>
          <input
            autoComplete="nickname"
            id="nickname"
            maxLength={20}
            onChange={(event) => props.onNicknameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onCreate();
            }}
            placeholder="怎么称呼你？"
            value={props.nickname}
          />
          <button className="button button-primary create-button" disabled={props.busy} onClick={props.onCreate}>
            创建新房间 <span aria-hidden="true">↗</span>
          </button>
          <div className="form-divider"><span />或者加入已有房间<span /></div>
          <div className="join-row">
            <input
              aria-label="房间码"
              autoCapitalize="characters"
              maxLength={5}
              onChange={(event) => props.onRoomCodeChange(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") props.onJoin();
              }}
              placeholder="输入 5 位房间码"
              value={props.roomCode}
            />
            <button className="button button-secondary" disabled={props.busy} onClick={props.onJoin}>
              加入
            </button>
          </div>
          {props.notice && <div className="notice" role="alert">{props.notice}</div>}
          <div className="room-hint"><span className="lock-icon">◈</span> 身份信息仅对你自己可见</div>
        </section>
      </section>
      <footer className="landing-footer"><span>为那些仍愿意相信的人而造。</span><span>© MOSAICA</span></footer>
    </main>
  );
}

interface GameRoomViewProps {
  busy: boolean;
  notice: string;
  playerId: string;
  update: GameUpdate;
  onAction: (action: (callback: (response: ActionResponse) => void) => void) => void;
  onLeave: () => void;
  onNotice: (notice: string) => void;
}

function GameRoomView({ busy, notice, onAction, onLeave, onNotice, playerId, update }: GameRoomViewProps) {
  const { publicState, privateState } = update;
  const me = publicState.players.find((player) => player.id === playerId);
  const leader = publicState.players.find((player) => player.id === publicState.leaderId);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const hannaPlayerId = publicState.players.find((player) => player.characterId === "hanna")?.id;

  useEffect(() => setSelectedIds([]), [publicState.phase, publicState.round, publicState.leaderId]);

  const teamPlayers = useMemo(
    () => publicState.players.filter((player) => publicState.currentTeam.includes(player.id)),
    [publicState.currentTeam, publicState.players]
  );
  const isLeader = publicState.leaderId === playerId;
  const canChoose = publicState.phase === "SELECT_TEAM" && isLeader;
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((playerId) => playerId !== id);
      const includesHanna = publicState.round === 3 && publicState.magicAbilityUsed
        && (id === hannaPlayerId || current.includes(hannaPlayerId ?? ""));
      const selectionLimit = Math.max(1, publicState.teamSize - (includesHanna ? 1 : 0));
      return current.length < selectionLimit ? [...current, id] : current;
    });
  };
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(publicState.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      onNotice("无法复制房间码，请手动记下。");
    }
  };

  const winnerText = publicState.winner === "MAGICAL_GIRL" ? "魔法少女阵营胜利" : "魔女阵营胜利";
  const phaseLabel: Record<typeof publicState.phase, string> = {
    LOBBY: "等待玩家",
    SELECT_TEAM: "选择队伍",
    TEAM_VOTE: "队伍表决",
    MISSION_ACTION: "执行机关",
    MISSION_RESULT: "机关结算",
    INVASION: "侵染判定",
    MAGIC_CANDIDACY: "魔法竞选报名",
    MAGIC_VOTE: "魔法竞选投票",
    MAGIC_USE: "发动魔法",
    MAGIC_RESOLUTION: "魔法结算",
    INVASION_MAGIC: "侵染前交换",
    ENDED: "游戏结束"
  };

  if (publicState.phase === "LOBBY") {
    return (
      <LobbyScreen
        busy={busy}
        copied={copied}
        isHost={Boolean(me?.isHost)}
        notice={notice}
        roomCode={publicState.code}
        onCopyCode={copyCode}
        onLeave={onLeave}
        onNotice={onNotice}
        onStart={() => onAction((callback) => socket.emit("game:start", callback))}
        players={publicState.players}
      />
    );
  }

  return (
    <main className="game-shell">
      <header className="game-topbar">
        <a className="brand" href="/" aria-label="Mosaica">
          <span className="brand-mark">M</span><span>MOSAICA</span>
        </a>
        <div className="room-code-pill">
          <span>房间码</span><strong>{publicState.code}</strong>
          <button aria-label="复制房间码" className="copy-button" onClick={copyCode}>{copied ? "已复制" : "复制"}</button>
        </div>
        <button className="text-button" onClick={onLeave}>离开房间</button>
      </header>

      <div className="game-layout">
        <section className="game-main">
          <div className="game-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" /> {phaseLabel[publicState.phase]}</div>
              <h1>{publicState.phase === "LOBBY" ? "集结你的队伍" : publicState.phase === "ENDED" ? winnerText : `第 ${publicState.round} 轮机关`}</h1>
              <p>{publicState.phase === "LOBBY" ? `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 位玩家开始游戏` : leader ? `当前领袖：${leader.name}` : "等待本轮开始"}</p>
            </div>
            {publicState.phase !== "LOBBY" && (
              <div className="score-board">
                <div className="score-good"><strong>{publicState.successCount}</strong><span>破解</span></div>
                <span className="score-slash">/</span>
                <div className="score-bad"><strong>{publicState.failCount}</strong><span>破坏</span></div>
              </div>
            )}
          </div>

          {notice && <div className="notice game-notice" role="alert">{notice}<button onClick={() => onNotice("")}>×</button></div>}

          {publicState.phase === "ENDED" ? (
            <section className="panel result-panel">
              <span className="result-sparkle">✳</span>
              <span className="eyebrow">本局结果</span>
              <h2>{winnerText}</h2>
              <p>破解 {publicState.successCount} 次 · 破坏 {publicState.failCount} 次</p>
              {privateState && <div className="identity-reveal">你的身份是：<strong>{privateState.identity.name}</strong></div>}
            </section>
          ) : (
            <GameActionPanel
              busy={busy}
              canChoose={canChoose}
              isLeader={isLeader}
              onAction={onAction}
              onTogglePlayer={toggleSelected}
              phase={publicState.phase}
              playerId={playerId}
              privateState={privateState}
              publicState={publicState}
              selectedIds={selectedIds}
              teamPlayers={teamPlayers}
            />
          )}

          {publicState.phase !== "LOBBY" && (
            <section className="panel players-panel">
              <div className="section-heading"><div><span className="section-index">01</span><h2>玩家席位</h2></div><span>{publicState.players.length} 位玩家</span></div>
              <div className="player-grid">
                {publicState.players.map((player) => (
                  <div className={`player-tile ${player.id === publicState.leaderId ? "is-leader" : ""} ${publicState.currentTeam.includes(player.id) ? "is-teammate" : ""}`} key={player.id}>
                    <span className={`player-avatar avatar-${player.seatIndex % 6}`}>{player.name.slice(0, 1)}</span>
                    <span className="player-name">{player.name}{player.id === playerId ? <small>你</small> : null}</span>
                    <span className={`connection-dot ${player.connected ? "online" : ""}`} title={player.connected ? "在线" : "离线"} />
                    <div className="player-tags">
                      {player.isHost && <span>房主</span>}
                      {player.id === publicState.leaderId && <span>领袖</span>}
                      {publicState.currentTeam.includes(player.id) && <span>队员</span>}
                    </div>
                    {player.characterId && (
                      <div className="player-character">
                        {CHARACTER_CARDS.find((card) => card.id === player.characterId)?.name}
                        <small>{CHARACTER_CARDS.find((card) => card.id === player.characterId)?.title}</small>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel log-panel">
            <div className="section-heading"><div><span className="section-index">02</span><h2>行动记录</h2></div><span>仅显示公开信息</span></div>
            <div className="log-list">
              {publicState.logs.slice(-6).reverse().map((log, index) => (
                <div className="log-entry" key={`${index}-${log}`}><span className="log-dot" /><span>{log}</span></div>
              ))}
            </div>
          </section>
        </section>

        <aside className="game-sidebar">
          <IdentityCard privateState={privateState} phase={publicState.phase} characterId={me?.characterId ?? null} />
          <section className="panel mission-track">
            <div className="sidebar-title"><span>机关进度</span><span>5 轮</span></div>
            {Array.from({ length: 5 }, (_, index) => {
              const round = index + 1;
              const isCurrent = round === publicState.round && publicState.phase !== "LOBBY";
              const finished = round < publicState.round || (publicState.phase === "ENDED" && round <= publicState.round);
              const result = round === publicState.round ? publicState.lastMissionResult : null;
              const resultHidden = round === publicState.round
                && publicState.phase === "MISSION_RESULT"
                && result === null;
              return (
                <div className={`mission-round ${isCurrent ? "current" : ""} ${finished ? "finished" : ""}`} key={round}>
                  <span className="round-number">{String(round).padStart(2, "0")}</span>
                  <span className="round-title">第 {round} 轮</span>
                  {round === 4 && publicState.players.length >= 7 && <span className="round-note">需 2 次破坏</span>}
                  {result && <span className={result.succeeded ? "round-ok" : "round-fail"}>{result.succeeded ? "破解" : "破坏"}</span>}
                  {resultHidden && <span className="round-status">结果保密</span>}
                  {!result && !resultHidden && isCurrent && <span className="round-live">进行中</span>}
                  {!isCurrent && !result && <span className="round-status">{finished ? "完成" : "待开始"}</span>}
                </div>
              );
            })}
          </section>
          <section className="side-note">
            <span className="note-icon">✦</span>
            <p>谨慎分享屏幕。<br />你的身份只有你能看到。</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

function LobbyScreen({
  busy,
  copied,
  isHost,
  notice,
  roomCode,
  onCopyCode,
  onLeave,
  onNotice,
  onStart,
  players
}: {
  busy: boolean;
  copied: boolean;
  isHost: boolean;
  notice: string;
  roomCode: string;
  onCopyCode: () => void;
  onLeave: () => void;
  onNotice: (notice: string) => void;
  onStart: () => void;
  players: GameUpdate["publicState"]["players"];
}) {
  const witchCount = getWitchCount(players.length);
  const magicalGirlCount = players.length - witchCount;
  const roles = [
    { name: "凭依者", camp: "magical" },
    { name: "大侦探", camp: "magical" },
    { name: "魔法少女", camp: "magical", count: magicalGirlCount - 2 },
    { name: "半魔女", camp: "witch" },
    { name: "善良魔女", camp: "witch" },
    { name: "魔女", camp: "witch", count: witchCount - 2 }
  ].filter((role) => role.count === undefined || role.count > 0);

  return (
    <main className="lobby-screen">
      <header className="lobby-topbar">
        <button className="lobby-link-button" onClick={onLeave}>返回主页</button>
        <a className="lobby-brand" href="/" aria-label="Mosaica 房间首页">
          <span className="lobby-brand-mark">M</span>
          <span className="lobby-brand-name">MOSAICA</span>
          <span className="lobby-room-code">房间号：{roomCode}</span>
        </a>
        <button className="lobby-link-button" onClick={onCopyCode}>{copied ? "已复制房间码" : "邀请好友"}</button>
      </header>

      <div className="lobby-content">
        <div className="lobby-seat-row" aria-label={`当前 ${players.length} 位玩家，共 ${MAX_PLAYERS} 个席位`}>
          {Array.from({ length: MAX_PLAYERS }, (_, index) => {
            const player = players[index];
            return (
              <div className={`lobby-seat ${player ? "occupied" : "vacant"}`} key={player?.id ?? `seat-${index}`}>
                <div className={`lobby-seat-avatar ${player ? `avatar-${player.seatIndex % 6}` : ""}`}>
                  {player ? player.name.slice(0, 1) : <span>＋</span>}
                </div>
                <span className="lobby-seat-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="lobby-seat-name">{player?.name ?? "空位"}</span>
                {player?.isHost && <span className="lobby-seat-host">房主</span>}
              </div>
            );
          })}
        </div>

        <section className="lobby-status">
          <span className="lobby-status-mark"><span /></span>
          <h1>等待玩家加入</h1>
          <p>分享房间号，邀请朋友一起开始游戏</p>
          <div className="lobby-host-avatar">{players.find((player) => player.isHost)?.name.slice(0, 1) ?? "M"}</div>
          <span className="lobby-player-count">{players.length} / {MAX_PLAYERS} 位玩家</span>
        </section>

        <section className="lobby-role-config">
          <div className="lobby-section-label"><span>角色配置</span><i /> <span>{players.length >= MIN_PLAYERS ? `${players.length} 人配置` : "基础身份"}</span></div>
          <div className="lobby-role-list">
            {roles.map((role) => (
              <div className="lobby-role-card" key={role.name}>
                <span className="lobby-role-name">{role.name}</span>
                {role.count !== undefined && <span className="lobby-role-count">×{role.count}</span>}
                <span className={`lobby-role-dot ${role.camp}`} />
              </div>
            ))}
          </div>
          <div className="lobby-role-legend">
            <span><i className="magical" />魔法少女阵营</span>
            <span><i className="witch" />魔女阵营</span>
          </div>
        </section>

        {notice && <div className="notice lobby-notice" role="alert">{notice}<button onClick={() => onNotice("")}>×</button></div>}

        <div className="lobby-start-row">
          <div className="lobby-start-hint">
            <span className="lobby-lock">◈</span>
            {players.length < MIN_PLAYERS
              ? `还需要 ${MIN_PLAYERS - players.length} 位玩家加入 · 至少 ${MIN_PLAYERS} 人开局`
              : "玩家已就绪，可以开始游戏"}
          </div>
          {isHost ? (
            <button className="lobby-start-button" disabled={busy || players.length < MIN_PLAYERS} onClick={onStart}>
              开始游戏 <span>↗</span>
            </button>
          ) : <span className="lobby-waiting-host">等待房主开始游戏…</span>}
        </div>
      </div>
      <footer className="lobby-footer-note">MOSAICA · 秘密身份，真实信任</footer>
    </main>
  );
}

function GameActionPanel({
  busy,
  canChoose,
  isLeader,
  onAction,
  onTogglePlayer,
  phase,
  playerId,
  privateState,
  publicState,
  selectedIds,
  teamPlayers
}: {
  busy: boolean;
  canChoose: boolean;
  isLeader: boolean;
  onAction: GameRoomViewProps["onAction"];
  onTogglePlayer: (id: string) => void;
  phase: Exclude<GameUpdate["publicState"]["phase"], "LOBBY" | "ENDED">;
  playerId: string;
  privateState: GameUpdate["privateState"];
  publicState: GameUpdate["publicState"];
  selectedIds: string[];
  teamPlayers: GameUpdate["publicState"]["players"];
}) {
  const hannaPlayerId = publicState.players.find((player) => player.characterId === "hanna")?.id;
  const invasionTargets = publicState.players;
  const requiredTeamSize = Math.max(
    1,
    publicState.teamSize - (publicState.round === 3 && publicState.hannaCountsAsTwo && selectedIds.includes(hannaPlayerId ?? "") ? 1 : 0)
  );
  let heading = "";
  let description = "";
  if (phase === "SELECT_TEAM") {
    heading = canChoose ? "选择任务队伍" : "等待领袖提名";
    description = canChoose
      ? `选择 ${publicState.teamSize} 位玩家组成任务队伍。`
      : `${publicState.players.find((player) => player.id === publicState.leaderId)?.name ?? "领袖"} 正在考虑队伍人选。`;
  } else if (phase === "TEAM_VOTE") {
    heading = "这支队伍值得信任吗？";
    description = `队伍成员：${teamPlayers.map((player) => player.name).join("、")}。`;
  } else if (phase === "MISSION_ACTION") {
    heading = privateState?.isOnTeam ? "轮到你执行机关" : "队伍正在执行机关";
    description = privateState?.isOnTeam ? "任务行动将以匿名方式结算。" : "等待任务队员提交行动。";
  } else if (phase === "INVASION") {
    heading = privateState?.alignment === "WITCH" ? "选择侵染目标" : "魔女正在选择侵染目标";
    description = privateState?.alignment === "WITCH"
      ? "选择一位玩家。命中凭依者，魔女阵营获胜；否则魔法少女阵营获胜。"
      : "第 3–5 轮任务后，魔女可以尝试找出凭依者。";
  } else if (phase === "MAGIC_CANDIDACY") {
    heading = "竞选魔法使用权";
    description = "选择是否参加竞选。候选人不能参与本轮投票。";
  } else if (phase === "MAGIC_VOTE") {
    heading = publicState.magicTiedVote ? "并列候选人重投" : "投票选出魔法使用者";
    description = publicState.magicTiedVote ? "仅并列候选人参与本轮重投，也可以弃票。" : "未参选玩家为候选人投票，也可以弃票。";
  } else if (phase === "MAGIC_USE") {
    heading = privateState?.magic.isMagicUser ? "发动你的角色魔法" : "魔法竞选已结束";
    description = privateState?.magic.isMagicUser ? "角色技能由服务器判定，请确认后发动。" : "等待竞选胜者发动魔法。";
  } else if (phase === "MAGIC_RESOLUTION") {
    heading = privateState?.magic.isMagicUser ? "处理第三轮魔法效果" : "第三轮魔法结算中";
    description = privateState?.magic.isMagicUser ? "根据你的角色技能查看、调整或公布任务决定。" : "等待竞选胜者完成魔法结算。";
  } else if (phase === "INVASION_MAGIC") {
    heading = privateState?.magic.isMagicUser ? "侵染前发动灵魂互换" : "魔女即将进行侵染";
    description = privateState?.magic.isMagicUser ? "你可以将自己的身份卡与任意一位玩家交换。" : "等待侵染阶段开始。";
  } else if (phase === "MISSION_RESULT") {
    heading = publicState.lastMissionResult
      ? publicState.lastMissionResult.succeeded ? "机关破解成功" : "机关遭到破坏"
      : "任务已结算 · 结果保密";
    description = publicState.lastMissionResult
      ? `本轮有 ${publicState.lastMissionResult.failActions} 次破坏行动。`
      : "本轮具体结果暂不公开。";
  } else {
    heading = "游戏阶段";
    description = "等待本阶段操作。";
  }

  return (
    <section className={`panel action-panel phase-${phase.toLowerCase()}`}>
      <div className="action-topline"><span className="action-phase">{phase.replaceAll("_", " ")}</span><span>第 {publicState.round} 轮</span></div>
      <h2>{heading}</h2>
      <p>{description}</p>

      {phase === "SELECT_TEAM" && canChoose && (
        <>
          <div className="selection-counter">已选择 <strong>{selectedIds.length}</strong> / {requiredTeamSize} 人</div>
          <div className="candidate-list">
            {publicState.players.map((player) => {
              const selected = selectedIds.includes(player.id);
              return (
                <button aria-pressed={selected} className={`candidate ${selected ? "selected" : ""}`} key={player.id} onClick={() => onTogglePlayer(player.id)}>
                  <span className={`player-avatar avatar-${player.seatIndex % 6}`}>{player.name.slice(0, 1)}</span>
                  <span>{player.name}{player.id === playerId ? <small>你</small> : null}</span>
                  <span className="candidate-check">{selected ? "✓" : "+"}</span>
                </button>
              );
            })}
          </div>
          <button
            className="button button-primary action-submit"
            disabled={busy || selectedIds.length !== requiredTeamSize}
            onClick={() => onAction((callback) => socket.emit("game:select-team", selectedIds, callback))}
          >确认提名</button>
        </>
      )}

      {phase === "SELECT_TEAM" && !canChoose && <div className="waiting-state"><span className="pulse-dot" />等待领袖选择队伍</div>}

      {phase === "TEAM_VOTE" && (
        <>
          <div className="candidate-list selected-team-list">
            {teamPlayers.map((player) => <div className="candidate team-member" key={player.id}><span className={`player-avatar avatar-${player.seatIndex % 6}`}>{player.name.slice(0, 1)}</span><span>{player.name}</span><span className="member-check">候选队员</span></div>)}
          </div>
          {privateState?.hasVoted ? (
            <div className="waiting-state"><span className="pulse-dot" />你已投票 · 等待其他玩家（{publicState.teamVotesSubmitted}/{publicState.players.length}）</div>
          ) : (
            <div className="vote-actions">
              <button className="button button-vote-no" disabled={busy} onClick={() => onAction((callback) => socket.emit("game:vote-team", false, callback))}>反对</button>
              <button className="button button-vote-yes" disabled={busy} onClick={() => onAction((callback) => socket.emit("game:vote-team", true, callback))}>赞成</button>
            </div>
          )}
        </>
      )}

      {phase === "MISSION_ACTION" && (
        privateState?.isOnTeam ? privateState.hasActed ? (
          <div className="waiting-state"><span className="pulse-dot" />行动已提交 · 等待队友（{publicState.missionActionsSubmitted}/{teamPlayers.length}）</div>
        ) : (
          publicState.round === 3 && privateState.alignment === "MAGICAL_GIRL" && privateState.magic.isMagicUser && publicState.players.find((player) => player.id === playerId)?.characterId === "hanna" ? (
            <div className="mission-actions mission-double-actions">
              <button className="button button-mission-success" disabled={busy} onClick={() => onAction((callback) => socket.emit("game:mission-action", ["SUCCESS", "SUCCESS"], callback))}>两次破解</button>
              {privateState.canSabotage && <>
                <button className="button button-mission-fail" disabled={busy} onClick={() => onAction((callback) => socket.emit("game:mission-action", ["SUCCESS", "FAIL"], callback))}>破解并破坏</button>
                <button className="button button-mission-fail" disabled={busy} onClick={() => onAction((callback) => socket.emit("game:mission-action", ["FAIL", "FAIL"], callback))}>两次破坏</button>
              </>}
            </div>
          ) : (
            <div className="mission-actions">
              <button className="button button-mission-success" disabled={busy} onClick={() => submitMission(onAction, "SUCCESS")}>破解机关</button>
              {privateState.canSabotage && <button className="button button-mission-fail" disabled={busy} onClick={() => submitMission(onAction, "FAIL")}>破坏机关</button>}
            </div>
          )
        ) : <div className="waiting-state"><span className="pulse-dot" />等待队员提交行动（{publicState.missionActionsSubmitted}/{teamPlayers.length}）</div>
      )}

      {phase === "MISSION_RESULT" && (
        <div className="result-continue">
          <div className="mission-result-badge">
            {publicState.lastMissionResult
              ? publicState.lastMissionResult.succeeded ? "✓" : "!"
              : "?"}
          </div>
          {isLeader ? (
            <button className="button button-primary" disabled={busy} onClick={() => onAction((callback) => socket.emit("game:continue", callback))}>
              继续下一轮 <span aria-hidden="true">↗</span>
            </button>
          ) : <div className="waiting-state"><span className="pulse-dot" />等待下一轮领袖继续</div>}
        </div>
      )}

      {phase === "INVASION" && (
        privateState?.alignment === "WITCH" ? (
          <>
            <div className="invasion-warning">
              <span>!</span>
              <p>这是最后一次判断。<br />目标选择后立即结算，且不会公开谁做出的选择。</p>
            </div>
            <div className="candidate-list invasion-target-list">
              {invasionTargets.filter((player) => privateState.invasionTargets.includes(player.id)).map((player) => (
                <button
                  className="candidate invasion-target"
                  disabled={busy}
                  key={player.id}
                  onClick={() => onAction((callback) => socket.emit("game:invade", player.id, callback))}
                >
                  <span className={`player-avatar avatar-${player.seatIndex % 6}`}>{player.name.slice(0, 1)}</span>
                  <span>{player.name}{player.id === playerId ? <small>你</small> : null}</span>
                  <span className="candidate-check">→</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="waiting-state"><span className="pulse-dot" />等待魔女阵营完成侵染判定</div>
        )
      )}

      {publicState.lastTeamVotes.length > 0 && (
        <div className="team-vote-results" aria-live="polite">
          <strong>上一轮组队票型</strong>
          {publicState.lastTeamVotes.map((vote) => {
            const voter = publicState.players.find((player) => player.id === vote.playerId);
            return <span key={vote.playerId}>{voter?.name ?? "玩家"}：{vote.approve ? "赞成" : "反对"}</span>;
          })}
        </div>
      )}

      {(phase === "MAGIC_CANDIDACY" || phase === "MAGIC_VOTE" || phase === "MAGIC_USE" || phase === "MAGIC_RESOLUTION" || phase === "INVASION_MAGIC") && (
        <MagicStagePanel
          busy={busy}
          onAction={onAction}
          phase={phase}
          playerId={playerId}
          privateState={privateState}
          publicState={publicState}
        />
      )}
    </section>
  );
}

const IDENTITY_CHOICES: Array<{ id: IdentityId; name: string }> = [
  { id: "possessed", name: "凭依者" },
  { id: "detective", name: "大侦探" },
  { id: "halfWitch", name: "半魔女" },
  { id: "goodWitch", name: "善良魔女" },
  { id: "magicalGirl", name: "魔法少女" },
  { id: "witch", name: "魔女" }
];

function MagicStagePanel({
  busy,
  onAction,
  phase,
  playerId,
  privateState,
  publicState
}: {
  busy: boolean;
  onAction: GameRoomViewProps["onAction"];
  phase: GameUpdate["publicState"]["phase"];
  playerId: string;
  privateState: GameUpdate["privateState"];
  publicState: GameUpdate["publicState"];
}) {
  const [targetId, setTargetId] = useState("");
  const [secondTargetId, setSecondTargetId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [choice, setChoice] = useState<MissionAction>("SUCCESS");
  const [decisionIndex, setDecisionIndex] = useState("");
  const [blockRound, setBlockRound] = useState(3);
  const [identityClaim, setIdentityClaim] = useState<IdentityId>("possessed");
  const [reveal, setReveal] = useState(false);
  const me = publicState.players.find((player) => player.id === playerId);
  const characterId = me?.characterId ?? null;
  const magic = privateState?.magic;
  const skill = magic?.magicMessage ?? "";
  const playerOptions = publicState.players.filter((player) => player.id !== playerId || characterId === "naya");
  const isMagicUser = Boolean(magic?.isMagicUser);
  useEffect(() => {
    setTargetId("");
    setSecondTargetId("");
    setSelectedIds([]);
    setChoice("SUCCESS");
    setDecisionIndex("");
    setIdentityClaim("possessed");
    setReveal(false);
    setBlockRound(3);
  }, [phase, publicState.round]);
  const sendUse = (action: MagicAction) => onAction((callback) => socket.emit("game:use-magic", action, callback));
  const sendResolve = (action: MagicAction) => onAction((callback) => socket.emit("game:resolve-magic", action, callback));
  const sendNoop = () => sendUse({ type: "PASS" });
  const identitySelect = (
    <select value={identityClaim} onChange={(event) => setIdentityClaim(event.target.value as IdentityId)}>
      {IDENTITY_CHOICES.map((identity) => <option key={identity.id} value={identity.id}>{identity.name}</option>)}
    </select>
  );
  const targetSelect = (
    <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
      <option value="">选择玩家</option>
      {playerOptions.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
    </select>
  );
  const teamTargetSelect = (
    <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
      <option value="">选择队伍成员</option>
      {publicState.players.filter((player) => publicState.currentTeam.includes(player.id)).map((player) => (
        <option key={player.id} value={player.id}>{player.name}</option>
      ))}
    </select>
  );
  const actionButton = (label: string, callback: () => void, disabled = false) => (
    <button className="button button-primary action-submit" disabled={busy || disabled} onClick={callback}>{label}</button>
  );

  if (!privateState || !magic) return <div className="waiting-state">正在载入私密游戏信息…</div>;

  if (phase === "MAGIC_CANDIDACY") {
    if (magic.hasDeclaredCandidacy) return <div className="waiting-state">报名已提交 · {publicState.magicCandidacySubmitted}/{publicState.players.length}</div>;
    return (
      <div className="vote-actions">
        <button className="button button-vote-no" disabled={busy} onClick={() => onAction((callback) => socket.emit("game:magic-candidacy", false, callback))}>不参加</button>
        <button className="button button-vote-yes" disabled={busy} onClick={() => onAction((callback) => socket.emit("game:magic-candidacy", true, callback))}>参加竞选</button>
      </div>
    );
  }

  if (phase === "MAGIC_VOTE") {
    if (!magic.canVoteMagic || magic.hasVotedMagic) {
      return <div className="waiting-state"><span className="pulse-dot" />{magic.hasVotedMagic ? "已投票" : "本轮不在投票范围内"} · 等待其他玩家（{publicState.magicVotesSubmitted}/{publicState.magicElectorateSize}）</div>;
    }
    return (
      <>
        <div className="candidate-list">
          {publicState.magicCandidates.map((candidateId) => {
            const candidate = publicState.players.find((player) => player.id === candidateId);
            if (!candidate) return null;
            return (
              <button className="candidate" disabled={busy} key={candidate.id} onClick={() => onAction((callback) => socket.emit("game:magic-vote", candidate.id, callback))}>
                <span className={`player-avatar avatar-${candidate.seatIndex % 6}`}>{candidate.name.slice(0, 1)}</span>
                <span>{candidate.name}</span><span className="candidate-check">投票</span>
              </button>
            );
          })}
        </div>
        <button className="button button-secondary action-submit" disabled={busy} onClick={() => onAction((callback) => socket.emit("game:magic-vote", null, callback))}>弃票</button>
      </>
    );
  }

  if (phase === "MAGIC_RESOLUTION" && !isMagicUser) {
    return <div className="waiting-state"><span className="pulse-dot" />等待竞选胜者处理技能（{publicState.magicUserId ? publicState.players.find((player) => player.id === publicState.magicUserId)?.name : "未知玩家"}）</div>;
  }
  if ((phase === "MAGIC_USE" || phase === "INVASION_MAGIC") && !isMagicUser) {
    return <div className="waiting-state"><span className="pulse-dot" />等待竞选胜者行动</div>;
  }

  if (phase === "INVASION_MAGIC") {
    return (
      <>
        <div className="skill-description">{skill}</div>
        <div className="magic-form-row">{targetSelect}</div>
        {privateState.alignment === "WITCH" && <label className="magic-checkbox"><input type="checkbox" checked={reveal} onChange={(event) => setReveal(event.target.checked)} />公开交换后的身份</label>}
        <div className="vote-actions">
          {actionButton("与目标交换", () => {
            if (targetId) sendUse({ type: "SWAP_IDENTITIES", firstId: playerId, secondId: targetId, revealSelf: reveal });
          }, !targetId)}
          {actionButton("放弃发动", sendNoop)}
        </div>
      </>
    );
  }

  if (phase === "MAGIC_USE") {
    let controls = <>{actionButton("发动魔法", sendNoop)}</>;
    if (characterId === "emma") {
      controls = <>{actionButton("发动魔法", () => sendUse({ type: "SET_MISSION_EFFECT", effect: privateState.alignment === "WITCH" ? "ARM_EMMA_WITCH" : "BLOCK_WITCH_FAIL" }))}</>;
    } else if (characterId === "hiro") {
      controls = privateState.alignment === "MAGICAL_GIRL"
        ? <>{actionButton("重开第二轮", () => sendUse({ type: "REPLAY_ROUND_TWO" }))}</>
        : <><label className="magic-choice">将第二轮改为 <select value={choice} onChange={(event) => setChoice(event.target.value as MissionAction)}><option value="SUCCESS">破解</option><option value="FAIL">破坏</option></select></label>{actionButton("确认改写", () => sendUse({ type: "CHANGE_ROUND_TWO_RESULT", succeeded: choice === "SUCCESS" }))}</>;
    } else if (characterId === "anna") {
      controls = <>{actionButton("发动洗脑", () => sendUse({ type: "SET_MISSION_EFFECT", effect: "REPLACE_MISSION_ACTION" }))}</>;
    } else if (characterId === "noah") {
      controls = <>{actionButton("发动液体操控", () => sendUse({ type: "SET_MISSION_EFFECT", effect: privateState.alignment === "WITCH" ? "REVEAL_SABOTEUR" : "NOAH_MG" }))}</>;
    } else if (characterId === "reia" || characterId === "hanna") {
      controls = <>{actionButton("发动技能", () => sendUse({ type: "SET_MISSION_EFFECT", effect: "ADD_MISSION_ACTION" }))}</>;
    } else if (characterId === "milia") {
      controls = <>{actionButton("保留灵魂互换至侵染阶段", sendNoop)}</>;
    } else if (characterId === "maga") {
      controls = <div className="magic-form-row">
        <select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">选择第一位玩家</option>{publicState.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select>
        <select value={secondTargetId} onChange={(event) => setSecondTargetId(event.target.value)}><option value="">选择第二位玩家</option>{publicState.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select>
        {actionButton("交换身份卡", () => sendUse({ type: "SWAP_IDENTITIES", firstId: targetId, secondId: secondTargetId }), !targetId || !secondTargetId || targetId === secondTargetId)}
      </div>;
    } else if (characterId === "naya") {
      controls = <div className="magic-form-row">
        {targetSelect}
        {privateState.alignment === "WITCH" && identitySelect}
        <label className="magic-checkbox"><input type="checkbox" checked={reveal} onChange={(event) => setReveal(event.target.checked)} />公开宣称结果</label>
        {actionButton("查看身份", () => sendUse({ type: "INVESTIGATE_IDENTITY", targetId, reveal, claimIdentityId: identityClaim }), !targetId)}
      </div>;
    } else if (characterId === "arisa") {
      controls = <div className="magic-form-row">
        <select aria-label="选择封锁轮次" value={blockRound} onChange={(event) => setBlockRound(Number(event.target.value))}><option value={3}>第 3 轮</option><option value={4}>第 4 轮</option><option value={5}>第 5 轮</option></select>
        {actionButton("封锁该轮侵染", () => sendUse({ type: "SET_INVASION_BLOCK", round: blockRound }))}
      </div>;
    } else if (characterId === "shirley") {
      controls = privateState.alignment === "MAGICAL_GIRL"
        ? <>{actionButton("将第二轮改为破解", () => sendUse({ type: "CHANGE_ROUND_TWO_RESULT", succeeded: true }))}</>
        : <><label className="magic-choice">将第二轮改为 <select value={choice} onChange={(event) => setChoice(event.target.value as MissionAction)}><option value="SUCCESS">破解</option><option value="FAIL">破坏</option></select></label>{actionButton("确认改写", () => sendUse({ type: "CHANGE_ROUND_TWO_RESULT", succeeded: choice === "SUCCESS" }))}</>;
    } else if (characterId === "coco") {
      controls = <>{actionButton("发动窥探", () => sendUse({
        type: "SET_MISSION_EFFECT",
        effect: privateState.alignment === "WITCH" ? "REPLACE_MISSION_ACTION" : "HIDDEN_RESULT"
      }))}</>;
    } else if (characterId === "meruru") {
      controls = <div className="magic-form-row">
        {targetSelect}
        {privateState.alignment === "WITCH" && <label className="magic-checkbox"><input type="checkbox" checked={choice === "SUCCESS"} onChange={(event) => setChoice(event.target.checked ? "SUCCESS" : "FAIL")} />宣称阵营相同</label>}
        {actionButton("查验并公布", () => sendUse({ type: "INVESTIGATE_CAMP", targetId, claimSame: privateState.alignment === "MAGICAL_GIRL" ? true : choice === "SUCCESS" }), !targetId)}
      </div>;
    }
    return (
      <>
        <div className="skill-description">{skill}</div>
        {controls}
      </>
    );
  }

  if (phase === "MAGIC_RESOLUTION") {
    if (characterId === "emma" && privateState.alignment === "WITCH") {
      return <>{actionButton("公开身份并将本轮改为破坏", () => sendResolve({ type: "DECLARE_EMMA_WITCH" }))}{actionButton("不发动", () => sendResolve({ type: "PASS" }))}</>;
    }
    if (characterId === "anna") {
      return <div className="magic-form-row">
        <div className="skill-decision-list">
          {privateState.magic.decisionPreview.map(({ index, playerName, action }) => (
            <div className="skill-decision" key={index}>第 {index + 1} 项 · {playerName ?? "队伍成员"} · {action === "SUCCESS" ? "破解" : "破坏"}</div>
          ))}
        </div>
        <select value={decisionIndex} onChange={(event) => {
          const selected = privateState.magic.decisionPreview.find((decision) => decision.index === Number(event.target.value));
          setDecisionIndex(event.target.value);
          setTargetId(selected?.playerId ?? "");
        }}>
          <option value="">选择要修改的决定</option>
          {privateState.magic.decisionPreview.map(({ index, playerName, action }) => (
            <option key={index} value={index}>第 {index + 1} 项 · {playerName} · {action === "SUCCESS" ? "破解" : "破坏"}</option>
          ))}
        </select>
        {privateState.alignment === "WITCH" && <select value={choice} onChange={(event) => setChoice(event.target.value as MissionAction)}><option value="SUCCESS">改为破解</option><option value="FAIL">改为破坏</option></select>}
        {actionButton("修改该项决定", () => {
          const selected = privateState.magic.decisionPreview.find((decision) => decision.index === Number(decisionIndex));
          if (selected?.playerId !== undefined) {
            sendResolve({
              type: "MISSION_OVERRIDE",
              targetId: selected.playerId,
              replacement: privateState.alignment === "MAGICAL_GIRL" ? "SUCCESS" : choice,
              actionIndex: selected.actionIndex
            });
          }
        }, !decisionIndex)}
        {actionButton("保留原决定", () => sendResolve({ type: "PASS" }))}
      </div>;
    }
    if (characterId === "noah") {
      const canReveal = privateState.magicTargets.length > 0;
      return <div className="magic-form-row">
        <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
          <option value="">选择玩家</option>
          {privateState.magicTargets.map((id) => {
            const player = publicState.players.find((entry) => entry.id === id);
            return player ? <option key={id} value={id}>{player.name}</option> : null;
          })}
        </select>
        {actionButton(privateState.alignment === "MAGICAL_GIRL" ? "公布实际破坏者" : "指认为破坏者", () => sendResolve({ type: "ANNOUNCE_SABOTEUR", targetId }), !targetId)}
        {privateState.alignment === "WITCH" && actionButton("不发动", () => sendResolve({ type: "PASS" }))}
        {privateState.alignment === "MAGICAL_GIRL" && !canReveal && actionButton("无破坏者，完成结算", () => sendResolve({ type: "PASS" }))}
      </div>;
    }
    if (characterId === "reia") {
      const needed = privateState.alignment === "MAGICAL_GIRL" ? 1 : 2;
      return <div className="magic-form-row">
        <div className="skill-decision-list">{privateState.magic.decisionPreview.map(({ index, action }) => (
          <button className={`candidate ${selectedIds.includes(String(index)) ? "selected" : ""}`} key={index} onClick={() => setSelectedIds((current) => current.includes(String(index)) ? current.filter((id) => id !== String(index)) : current.length < needed ? [...current, String(index)] : current)}>
            <span>决定 {index + 1} · {action === "SUCCESS" ? "破解" : "破坏"}</span><span className="candidate-check">{selectedIds.includes(String(index)) ? "✓" : "+"}</span>
          </button>
        ))}</div>
        {privateState.alignment === "WITCH" && <select value={choice} onChange={(event) => setChoice(event.target.value as MissionAction)}><option value="SUCCESS">放入破解</option>{privateState.canSabotage && <option value="FAIL">放入破坏</option>}</select>}
        {actionButton("移除并结算", () => sendResolve({ type: "REIA_DECISIONS", removedDecisionIndexes: selectedIds.map(Number), ownAction: privateState.alignment === "MAGICAL_GIRL" ? undefined : choice }), selectedIds.length !== needed)}
        {actionButton("不发动", () => sendResolve({ type: "PASS" }))}
      </div>;
    }
    if (characterId === "coco" && privateState.alignment === "MAGICAL_GIRL") {
      return <div className="magic-form-row">
        <div className="skill-decision-list">{privateState.magic.decisionPreview.map(({ index, playerName }) => (
          <button className={`candidate ${selectedIds.includes(String(index)) ? "selected" : ""}`} key={index} onClick={() => setSelectedIds((current) => current.includes(String(index)) ? current.filter((id) => id !== String(index)) : current.length < 2 ? [...current, String(index)] : current)}>
            <span>{playerName ?? "队伍成员"}</span><span className="candidate-check">{selectedIds.includes(String(index)) ? "✓" : "+"}</span>
          </button>
        ))}</div>
        {actionButton("查看并公布", () => sendResolve({
          type: "PEEK_DECISIONS",
          targetIds: selectedIds
            .map((index) => privateState.magic.decisionPreview.find((decision) => decision.index === Number(index))?.playerId)
            .filter((id): id is string => Boolean(id))
        }))}
      </div>;
    }
    if (characterId === "coco" && privateState.alignment === "WITCH") {
      return <div className="magic-form-row">
        <div className="skill-decision-list">{privateState.magic.decisionPreview.map(({ index }) => (
          <button className={`candidate ${decisionIndex === String(index) ? "selected" : ""}`} key={index} onClick={() => setDecisionIndex(String(index))}>
            <span>匿名决定 {index + 1}</span><span className="candidate-check">{decisionIndex === String(index) ? "✓" : "+"}</span>
          </button>
        ))}</div>
        <select value={choice} onChange={(event) => setChoice(event.target.value as MissionAction)}><option value="SUCCESS">替换为破解</option>{privateState.canSabotage && <option value="FAIL">替换为破坏</option>}</select>
        {actionButton("替换一项决定", () => sendResolve({
          type: "COCO_REPLACE_DECISION",
          decisionIndex: Number(decisionIndex),
          replacement: choice
        }), !decisionIndex)}
        {actionButton("不发动", () => sendResolve({ type: "PASS" }))}
      </div>;
    }
    return <>{actionButton("完成结算", () => sendResolve({ type: "PASS" }))}</>;
  }

  return <div className="waiting-state"><span className="pulse-dot" />等待本阶段其他行动</div>;
}

function submitMission(
  onAction: GameRoomViewProps["onAction"],
  action: MissionAction
) {
  onAction((callback) => socket.emit("game:mission-action", action, callback));
}

function IdentityCard({
  characterId,
  phase,
  privateState
}: {
  characterId: CharacterId | null;
  phase: GameUpdate["publicState"]["phase"];
  privateState: GameUpdate["privateState"];
}) {
  const character = characterId ? CHARACTER_CARDS.find((entry) => entry.id === characterId) : undefined;
  return (
    <section className="identity-card">
      <div className="identity-card-header"><span>你的秘密身份</span><span className="private-lock">◈ 私密</span></div>
      {privateState ? (
        <>
          <div className={`identity-emblem ${privateState.alignment === "WITCH" ? "witch-emblem" : ""}`}>
            {privateState.alignment === "WITCH" ? "☾" : "✦"}
          </div>
          <h2>{privateState.identity.name}</h2>
          <span className={`camp-label ${privateState.alignment === "WITCH" ? "witch-camp" : ""}`}>{getCampLabel(privateState.alignment)}</span>
          <div className="identity-divider" />
          <p>{privateState.privateMessage}</p>
          {character && (
            <div className="private-character">
              <span>你的公开角色牌</span>
              <strong>{character.name} · {character.title}</strong>
              <p>{privateState.alignment === "WITCH" ? character.witchSkill : character.magicalGirlSkill}</p>
            </div>
          )}
          {privateState.magic.magicResult && <div className="private-magic-result">{privateState.magic.magicResult}</div>}
          {phase !== "LOBBY" && <div className="identity-footnote">请勿向其他玩家展示此区域</div>}
        </>
      ) : (
        <div className="identity-placeholder"><span>✧</span><p>游戏开始后，<br />你的身份会在这里揭晓。</p></div>
      )}
    </section>
  );
}
