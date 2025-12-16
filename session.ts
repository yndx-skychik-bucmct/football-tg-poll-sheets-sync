import type { Context, SessionFlavor } from 'grammy';

export interface SessionData {
  state:
    | 'idle'
    | 'awaiting_column_confirmation'
    | 'awaiting_new_column_choice'
    | 'awaiting_date_name'
    | 'awaiting_cost'
    | 'awaiting_player_count'
    | 'awaiting_player_count_confirmation'
    | 'awaiting_usernames'
    | 'awaiting_override_confirmation'
    | 'awaiting_poll_intent'
    | 'awaiting_poll_option_selection';
  usernames: string[];
  detectedColumn?: string;
  targetColumn?: string;
  isNewColumn?: boolean;
  dateName?: string;
  cost?: number;
  playerCount?: number;
  column?: string; // Keep for backward compatibility with override flow
  nicknameRowsEntries?: Array<[string, number]>; // Serialized Map entries
  existingValuesEntries?: Array<{ nickname: string; value: string | number }>; // Store existing values for skipped tracking
  pollId?: string; // For poll-based workflow
  pollQuestion?: string; // For display
}

/**
 * Reset session helper
 */
export function resetSession(session: SessionData): void {
  session.state = 'idle';
  session.usernames = [];
  session.detectedColumn = undefined;
  session.targetColumn = undefined;
  session.isNewColumn = undefined;
  session.dateName = undefined;
  session.cost = undefined;
  session.playerCount = undefined;
  session.column = undefined;
  session.nicknameRowsEntries = undefined;
  session.existingValuesEntries = undefined;
  session.pollId = undefined;
  session.pollQuestion = undefined;
}

export type MyContext = Context & SessionFlavor<SessionData>;
