// Error messages
export const ERR_TARGET_COLUMN_NOT_SET =
  '❌ Error: target column not set. Start over with /update';
export const ERR_SESSION_DATA_LOST =
  '❌ Error: session data lost. Start over with /update';
export const ERR_INVALID_YES_NO = '❌ Please answer "yes" or "no"';

// Recovery instructions
export const MSG_USE_UPDATE_AGAIN = 'Use /update to begin again.';

// Google Sheets constants
export const SHEET_NAME = 'Sheet1';
export const SHEET_DATA_FIRST_ROW = 7; // Data starts from row 7
export const SHEET_DATA_FIRST_COLUMN = 'F'; // Date columns start from column F
export const SHEET_NICKNAME_COLUMN = 'B'; // Column B contains Telegram nicknames
export const SHEET_DATE_ROW = 1; // Row 1 contains date
export const SHEET_COST_ROW = 2; // Row 2 contains cost
export const SHEET_PLAYER_COUNT_ROW = 3; // Row 3 contains player count
export const SHEET_EXCLUDE_COLUMN_PATTERN = /^баланс\s+/i; // Exclude columns starting with "Баланс "
