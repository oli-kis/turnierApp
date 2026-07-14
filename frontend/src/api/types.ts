import { z } from "zod";

/**
 * Zod schemas mirroring the backend response contract. Dates stay ISO strings
 * (formatted in lib/time). Nested objects that vary by endpoint use permissive
 * shapes so a backend addition never blanks a screen.
 */

export const RoleSchema = z.enum(["ADMIN", "REFEREE"]);
export const UserStatusSchema = z.enum(["APPROVED", "PENDING", "REJECTED"]);
export const TournamentStatusSchema = z.enum(["DRAFT", "SCHEDULED", "RUNNING", "FINISHED"]);
export const SlotStatusSchema = z.enum(["PENDING", "WAITING_READY", "RUNNING", "FINISHED"]);
export const MatchStatusSchema = z.enum(["SCHEDULED", "READY", "RUNNING", "FINISHED"]);
export const MatchPhaseSchema = z.enum([
  "GROUP",
  "ROUND_OF_16",
  "QUARTERFINAL",
  "SEMIFINAL",
  "THIRD_PLACE",
  "FINAL",
]);

export type Role = z.infer<typeof RoleSchema>;
export type UserStatus = z.infer<typeof UserStatusSchema>;
export type TournamentStatus = z.infer<typeof TournamentStatusSchema>;
export type SlotStatus = z.infer<typeof SlotStatusSchema>;
export type MatchStatus = z.infer<typeof MatchStatusSchema>;
export type MatchPhase = z.infer<typeof MatchPhaseSchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: RoleSchema,
  status: UserStatusSchema,
});
export type User = z.infer<typeof UserSchema>;

export const RefereeSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: UserStatusSchema,
  createdAt: z.string(),
});
export type Referee = z.infer<typeof RefereeSchema>;

export const PitchSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
});
export type Pitch = z.infer<typeof PitchSchema>;

export const TournamentSchema = z.object({
  id: z.string(),
  name: z.string(),
  startAt: z.string(),
  matchDurationMin: z.number(),
  transitionMin: z.number(),
  pitchCount: z.number(),
  status: TournamentStatusSchema,
});
export type Tournament = z.infer<typeof TournamentSchema>;

export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string().optional(),
  groupId: z.string().nullish(),
});
export type Team = z.infer<typeof TeamSchema>;

export const GroupSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  name: z.string(),
  tiebreak: z.string().nullish(),
  teams: z.array(TeamSchema).optional(),
});
export type Group = z.infer<typeof GroupSchema>;

export const CategorySchema = z.object({
  id: z.string(),
  tournamentId: z.string(),
  name: z.string(),
  qualifiersPerGroup: z.number().nullish(),
  knockoutGenerated: z.boolean(),
  groups: z.array(GroupSchema).optional(),
  teams: z.array(TeamSchema).optional(),
});
export type Category = z.infer<typeof CategorySchema>;

export const TournamentDetailSchema = TournamentSchema.extend({
  pitches: z.array(PitchSchema).optional(),
  categories: z.array(CategorySchema).optional(),
});
export type TournamentDetail = z.infer<typeof TournamentDetailSchema>;

export const SlotSchema = z.object({
  id: z.string(),
  index: z.number(),
  status: SlotStatusSchema,
  plannedStart: z.string(),
  actualStart: z.string().nullish(),
  estimatedStart: z.string().nullish(),
});
export type Slot = z.infer<typeof SlotSchema>;

const TeamRef = TeamSchema.nullish();

export const MatchListItemSchema = z.object({
  id: z.string(),
  phase: MatchPhaseSchema,
  status: MatchStatusSchema,
  categoryId: z.string().optional(),
  groupId: z.string().nullish(),
  scoreHome: z.number(),
  scoreAway: z.number(),
  pensHome: z.number().nullish(),
  pensAway: z.number().nullish(),
  slot: z.object({ id: z.string(), index: z.number(), status: SlotStatusSchema }).nullish(),
  pitch: z.object({ id: z.string(), name: z.string() }).nullish(),
  homeTeam: TeamRef,
  awayTeam: TeamRef,
});
export type MatchListItem = z.infer<typeof MatchListItemSchema>;

export const GoalSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  teamId: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const MatchDetailSchema = MatchListItemSchema.extend({
  tournamentId: z.string().optional(),
  homeTeamId: z.string().nullish(),
  awayTeamId: z.string().nullish(),
  refereeId: z.string().nullish(),
  referee: z.object({ id: z.string(), name: z.string() }).nullish(),
  goals: z.array(GoalSchema).optional(),
  // Detail includes the full slot (with start times) — override the list shape.
  slot: SlotSchema.nullish(),
});
export type MatchDetail = z.infer<typeof MatchDetailSchema>;

export const RefereeMatchSchema = z.object({
  id: z.string(),
  status: MatchStatusSchema,
  phase: MatchPhaseSchema,
  pitch: z.string().nullish(),
  slotIndex: z.number().nullish(),
  slotStatus: SlotStatusSchema.nullish(),
  estimatedStart: z.string().nullish(),
  homeTeam: z.string().nullish(),
  awayTeam: z.string().nullish(),
  scoreHome: z.number(),
  scoreAway: z.number(),
});
export type RefereeMatch = z.infer<typeof RefereeMatchSchema>;

export const RestStatsSchema = z.object({
  min: z.number(),
  max: z.number(),
  avg: z.number(),
});
export type RestStats = z.infer<typeof RestStatsSchema>;

export const StandingRowSchema = z.object({
  teamId: z.string(),
  name: z.string(),
  played: z.number(),
  won: z.number(),
  drawn: z.number(),
  lost: z.number(),
  goalsFor: z.number(),
  goalsAgainst: z.number(),
  goalDifference: z.number(),
  points: z.number(),
  rank: z.number(),
});
export type StandingRow = z.infer<typeof StandingRowSchema>;

export const StandingsSchema = z.object({
  groupId: z.string(),
  standings: z.array(StandingRowSchema),
  tieUnresolved: z.boolean(),
  note: z.string().optional(),
});
export type Standings = z.infer<typeof StandingsSchema>;

export const BracketMatchSchema = z.object({
  id: z.string(),
  phase: MatchPhaseSchema,
  label: z.string().nullish(),
  slotIndex: z.number().nullish(),
  pitch: z.string().nullish(),
  status: MatchStatusSchema,
  home: z.string(),
  away: z.string(),
  homeTeamId: z.string().nullish(),
  awayTeamId: z.string().nullish(),
  scoreHome: z.number(),
  scoreAway: z.number(),
  pensHome: z.number().nullish(),
  pensAway: z.number().nullish(),
});
export type BracketMatch = z.infer<typeof BracketMatchSchema>;

export const BracketSchema = z.object({
  categoryId: z.string(),
  generated: z.boolean(),
  rounds: z.array(z.object({ phase: MatchPhaseSchema, matches: z.array(BracketMatchSchema) })),
});
export type Bracket = z.infer<typeof BracketSchema>;

export const DashboardSlotMatchSchema = z.object({
  matchId: z.string(),
  pitch: z.string().nullish(),
  referee: z.string().nullish(),
  status: MatchStatusSchema,
  homeTeam: z.string().nullish(),
  awayTeam: z.string().nullish(),
  scoreHome: z.number(),
  scoreAway: z.number(),
});
export type DashboardSlotMatch = z.infer<typeof DashboardSlotMatchSchema>;

export const DashboardSlotSchema = z.object({
  slotId: z.string(),
  index: z.number(),
  status: SlotStatusSchema,
  plannedStart: z.string(),
  actualStart: z.string().nullish(),
  estimatedStart: z.string().nullish(),
  matches: z.array(DashboardSlotMatchSchema),
});
export type DashboardSlot = z.infer<typeof DashboardSlotSchema>;

export const DashboardSchema = z.object({
  tournamentStatus: TournamentStatusSchema,
  currentSlot: DashboardSlotSchema.nullish(),
  nextSlot: DashboardSlotSchema.nullish(),
  delayMin: z.number().nullish(),
  unassignedMatches: z.array(
    z.object({
      matchId: z.string(),
      slotIndex: z.number().nullish(),
      pitch: z.string().nullish(),
      homeTeam: z.string().nullish(),
      awayTeam: z.string().nullish(),
    }),
  ),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

export const TeamSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string().nullish(),
  category: z.string(),
});
export type TeamSearchResult = z.infer<typeof TeamSearchResultSchema>;

export const TeamMatchSchema = z.object({
  id: z.string(),
  phase: MatchPhaseSchema,
  status: MatchStatusSchema,
  pitch: z.string().nullish(),
  slotIndex: z.number().nullish(),
  estimatedStart: z.string().nullish(),
  homeTeam: z.string().nullish(),
  awayTeam: z.string().nullish(),
  scoreHome: z.number(),
  scoreAway: z.number(),
});
export type TeamMatch = z.infer<typeof TeamMatchSchema>;
