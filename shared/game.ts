export type GamePhase =
  | "LOBBY"
  | "SELECT_TEAM"
  | "TEAM_VOTE"
  | "MISSION_ACTION"
  | "MISSION_RESULT"
  | "INVASION"
  | "MAGIC_CANDIDACY"
  | "MAGIC_VOTE"
  | "MAGIC_USE"
  | "MAGIC_RESOLUTION"
  | "INVASION_MAGIC"
  | "ENDED";

export type Camp = "MAGICAL_GIRL" | "WITCH";

export type IdentityId =
  | "possessed"
  | "detective"
  | "halfWitch"
  | "goodWitch"
  | "magicalGirl"
  | "witch";

export type CharacterId =
  | "emma"
  | "hiro"
  | "anna"
  | "noah"
  | "reia"
  | "milia"
  | "maga"
  | "naya"
  | "arisa"
  | "shirley"
  | "hanna"
  | "coco"
  | "meruru";

export interface PublicCharacter {
  id: CharacterId;
  name: string;
  title: string;
  magicalGirlSkill: string;
  witchSkill: string;
}

export type MissionAction = "SUCCESS" | "FAIL";

export interface Identity {
  id: IdentityId;
  name: string;
  camp: Camp;
  canSabotage: boolean;
}

export interface PublicPlayer {
  id: string;
  name: string;
  seatIndex: number;
  connected: boolean;
  isHost: boolean;
  characterId: CharacterId | null;
}

export interface MissionResult {
  succeeded: boolean;
  failActions: number;
}

export interface PublicGameState {
  code: string;
  phase: GamePhase;
  players: PublicPlayer[];
  round: number;
  leaderId: string | null;
  successCount: number;
  failCount: number;
  currentTeam: string[];
  teamSize: number;
  hannaCountsAsTwo: boolean;
  teamVotesSubmitted: number;
  lastTeamVotes: Array<{ playerId: string; approve: boolean }>;
  missionActionsSubmitted: number;
  failedProposals: number;
  forceTeamApproval: boolean;
  lastMissionResult: MissionResult | null;
  winner: Camp | null;
  logs: string[];
  magicCandidates: string[];
  magicVotesSubmitted: number;
  magicElectorateSize: number;
  magicUserId: string | null;
  magicAbilityUsed: boolean;
  magicCandidacySubmitted: number;
  magicTiedVote: boolean;
}

export interface PrivateMagicInfo {
  hasDeclaredCandidacy: boolean;
  isCandidate: boolean;
  hasVotedMagic: boolean;
  canVoteMagic: boolean;
  isMagicUser: boolean;
  magicMessage: string | null;
  magicResult: string | null;
  magicTargets: string[];
  decisionPreview: Array<{
    index: number;
    playerId?: string;
    playerName?: string;
    actionIndex?: number;
    action?: MissionAction;
  }>;
}

export interface PrivateGameState {
  identity: Identity;
  alignment: Camp;
  canSabotage: boolean;
  invasionTargets: string[];
  privateMessage: string;
  isOnTeam: boolean;
  hasVoted: boolean;
  hasActed: boolean;
  magic: PrivateMagicInfo;
}

export interface GameUpdate {
  publicState: PublicGameState;
  privateState: PrivateGameState | null;
}

export interface ActionResponse {
  ok: boolean;
  error?: string;
}

export interface SessionResponse extends ActionResponse {
  code?: string;
  playerId?: string;
}

export interface ServerToClientEvents {
  "game:update": (update: GameUpdate) => void;
  "room:error": (message: string) => void;
}

export interface ClientToServerEvents {
  "room:create": (name: string, callback: (response: SessionResponse) => void) => void;
  "room:join": (
    request: { code: string; name: string },
    callback: (response: SessionResponse) => void
  ) => void;
  "room:reconnect": (
    request: { code: string; playerId: string },
    callback: (response: SessionResponse) => void
  ) => void;
  "room:leave": (callback: (response: ActionResponse) => void) => void;
  "game:start": (callback: (response: ActionResponse) => void) => void;
  "game:select-team": (
    playerIds: string[],
    callback: (response: ActionResponse) => void
  ) => void;
  "game:vote-team": (approve: boolean, callback: (response: ActionResponse) => void) => void;
  "game:mission-action": (
    action: MissionAction | MissionAction[],
    callback: (response: ActionResponse) => void
  ) => void;
  "game:continue": (callback: (response: ActionResponse) => void) => void;
  "game:invade": (targetPlayerId: string, callback: (response: ActionResponse) => void) => void;
  "game:magic-candidacy": (isCandidate: boolean, callback: (response: ActionResponse) => void) => void;
  "game:magic-vote": (candidateId: string | null, callback: (response: ActionResponse) => void) => void;
  "game:use-magic": (action: MagicAction, callback: (response: ActionResponse) => void) => void;
  "game:resolve-magic": (action: MagicAction, callback: (response: ActionResponse) => void) => void;
}

export type MagicAction =
  | { type: "PASS" }
  | { type: "INVESTIGATE_IDENTITY"; targetId: string; reveal: boolean; claimIdentityId?: IdentityId }
  | { type: "INVESTIGATE_CAMP"; targetId: string; claimSame: boolean }
  | { type: "SET_INVASION_BLOCK"; round: number }
  | { type: "SWAP_IDENTITIES"; firstId: string; secondId: string; revealSelf?: boolean }
  | { type: "REPLAY_ROUND_TWO" }
  | { type: "CHANGE_ROUND_TWO_RESULT"; succeeded: boolean }
  | { type: "DECLARE_EMMA_WITCH" }
  | { type: "SET_MISSION_EFFECT"; effect: "BLOCK_WITCH_FAIL" | "HIDDEN_RESULT" | "REVEAL_SABOTEUR" | "ADD_MISSION_ACTION" | "REPLACE_MISSION_ACTION" | "ARM_EMMA_WITCH" | "NOAH_MG"; replacement?: MissionAction; targetId?: string; extraCount?: number }
  | { type: "MISSION_OVERRIDE"; targetId: string; replacement: MissionAction; actionIndex?: number }
  | { type: "REIA_DECISIONS"; removedDecisionIndexes: number[]; ownAction?: MissionAction }
  | { type: "ANNOUNCE_SABOTEUR"; targetId: string }
  | { type: "PEEK_DECISIONS"; targetIds: string[] }
  | { type: "COCO_REPLACE_DECISION"; decisionIndex: number; replacement: MissionAction };

export interface InterServerEvents {}

export interface SocketData {
  playerId?: string;
  roomCode?: string;
}
