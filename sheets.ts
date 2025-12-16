import type { JWT } from 'google-auth-library';
import { google } from 'googleapis';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SHEET_DATA_FIRST_COLUMN,
  SHEET_COST_ROW,
  SHEET_DATE_ROW,
  SHEET_PLAYER_COUNT_ROW,
  SHEET_NAME,
  SHEET_NICKNAME_COLUMN,
  SHEET_DATA_FIRST_ROW,
} from './constants';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEETS_API_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

if (!SPREADSHEET_ID) {
  throw new Error('SPREADSHEET_ID environment variable is required');
}

/**
 * Convert column letter to index (0-based)
 * "A" -> 0, "Z" -> 25, "AA" -> 26
 */
function columnLetterToIndex(letter: string): number {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Convert index to column letter (0-based)
 * 0 -> "A", 25 -> "Z", 26 -> "AA"
 */
function indexToColumnLetter(index: number): string {
  let result = '';
  index++;
  while (index > 0) {
    index--;
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26);
  }
  return result;
}

/**
 * Get next column letter
 * "O" -> "P", "Z" -> "AA"
 */
function getNextColumnLetter(letter: string): string {
  const index = columnLetterToIndex(letter);
  return indexToColumnLetter(index + 1);
}

interface ExistingValue {
  nickname: string;
  value: string | number;
}

interface ColumnMetadata {
  date?: string;
  cost?: number;
  playerCount?: number;
}

interface SheetsClient {
  findNicknameRows: (nicknames: string[]) => Promise<Map<string, number>>;
  checkExistingValues: (
    nicknameRows: Map<string, number>,
    column: string,
  ) => Promise<ExistingValue[]>;
  writeZeros: (
    nicknameRows: Map<string, number>,
    column: string,
    overrideExisting?: boolean,
  ) => Promise<{ updated: number; notFound: string[] }>;
  findLastDateColumn: () => Promise<{ column: string; date: string } | null>;
  getColumnMetadata: (column: string) => Promise<ColumnMetadata>;
  writeColumnMetadata: (
    column: string,
    date?: string,
    cost?: number,
    playerCount?: number,
  ) => Promise<void>;
}

/**
 * Initialize Google Sheets client using Service Account authentication
 */
async function initSheetsClient(): Promise<SheetsClient> {
  let auth: JWT;

  // Priority 1: Use JSON file path from env
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH) {
    const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
    if (!existsSync(jsonPath)) {
      throw new Error(`Service account JSON file not found: ${jsonPath}`);
    }
    auth = new google.auth.JWT({
      keyFile: jsonPath,
      scopes: [SHEETS_API_SCOPE],
    });
  }
  // Priority 2: Try to find JSON file in current directory
  else {
    // Look for service account JSON files (pattern: *-*.json or common names)
    const possibleFiles = [
      'cosmic-flux-383910-d8f7992822ad.json', // Your specific file
      'service-account-key.json',
      'google-credentials.json',
      'credentials.json',
    ];

    let jsonPath: string | undefined;
    for (const file of possibleFiles) {
      const fullPath = join(process.cwd(), file);
      if (existsSync(fullPath)) {
        // Verify it's a valid service account JSON
        try {
          const content = JSON.parse(readFileSync(fullPath, 'utf8'));
          if (content.type === 'service_account' && content.private_key) {
            jsonPath = fullPath;
            break;
          }
        } catch {
          // Not a valid JSON, continue
        }
      }
    }

    if (jsonPath) {
      auth = new google.auth.JWT({
        keyFile: jsonPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      // Priority 3: Use individual credentials from env vars
      const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

      if (!email || !key) {
        throw new Error(
          'Missing Google Service Account credentials. Provide one of:\n' +
            '  - GOOGLE_SERVICE_ACCOUNT_JSON_PATH environment variable pointing to JSON file\n' +
            '  - A service account JSON file in the project directory\n' +
            '  - Both GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY environment variables',
        );
      }

      // Validate private key format
      if (
        !key.includes('BEGIN PRIVATE KEY') ||
        !key.includes('END PRIVATE KEY')
      ) {
        throw new Error(
          'Invalid private key format. The private key should include BEGIN PRIVATE KEY and END PRIVATE KEY markers.',
        );
      }

      auth = new google.auth.JWT({
        email,
        key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
  }

  const sheets = google.sheets({ version: 'v4', auth });

  /**
   * Find row numbers for given nicknames in column B
   * Returns a map of nickname -> row number
   */
  async function findNicknameRows(
    nicknames: string[],
  ): Promise<Map<string, number>> {
    // Normalize nicknames: remove @ and convert to lowercase for matching
    const normalizedNicknames = new Map<string, string>();
    nicknames.forEach((nick) => {
      const normalized = nick.replace(/^@/, '').toLowerCase();
      normalizedNicknames.set(normalized, nick);
    });

    // Read column B starting from row 7
    const range = `${SHEET_NICKNAME_COLUMN}${SHEET_DATA_FIRST_ROW}:${SHEET_NICKNAME_COLUMN}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });

    const rows = response.data.values || [];
    const nicknameToRow = new Map<string, number>();

    rows.forEach((row, index) => {
      if (row[0]) {
        // Normalize the nickname from sheet (remove @, lowercase)
        const sheetNickname = String(row[0]).replace(/^@/, '').toLowerCase();
        const originalNickname = normalizedNicknames.get(sheetNickname);
        if (originalNickname) {
          const actualRow = SHEET_DATA_FIRST_ROW + index;
          nicknameToRow.set(originalNickname, actualRow);
        }
      }
    });

    return nicknameToRow;
  }

  /**
   * Check existing values in specified column for given nickname rows
   * Returns list of nicknames that already have non-empty values
   */
  async function checkExistingValues(
    nicknameRows: Map<string, number>,
    column: string,
  ): Promise<ExistingValue[]> {
    if (nicknameRows.size === 0) {
      return [];
    }

    // Build range for all cells we want to check
    const ranges: string[] = [];
    nicknameRows.forEach((row) => {
      ranges.push(`'${SHEET_NAME}'!${column}${row}`);
    });

    // Read all values at once using batchGet
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges,
    });

    const existingValues: ExistingValue[] = [];
    const rowsArray = Array.from(nicknameRows.entries());

    response.data.valueRanges?.forEach((valueRange, index) => {
      const [nickname, _row] = rowsArray[index];
      const values = valueRange.values || [];

      // Check if cell has a value (not empty)
      // Empty cells may return empty array or array with empty string
      if (values.length > 0 && values[0] && values[0].length > 0) {
        const cellValue = values[0][0];
        // Consider empty string, null, undefined, or just whitespace as empty
        if (
          cellValue !== null &&
          cellValue !== undefined &&
          String(cellValue).trim() !== ''
        ) {
          existingValues.push({
            nickname,
            value: cellValue,
          });
        }
      }
    });

    return existingValues;
  }

  /**
   * Write zeros to specified column for given nickname rows
   * @param overrideExisting - if false, skip cells that already have values
   */
  async function writeZeros(
    nicknameRows: Map<string, number>,
    column: string,
    overrideExisting: boolean = true,
  ): Promise<{ updated: number; notFound: string[] }> {
    if (nicknameRows.size === 0) {
      return { updated: 0, notFound: [] };
    }

    // If not overriding, check existing values first
    let rowsToUpdate = nicknameRows;
    if (!overrideExisting) {
      const existingValues = await checkExistingValues(nicknameRows, column);
      const existingNicknames = new Set(
        existingValues.map((ev) => ev.nickname),
      );

      // Filter out rows with existing values
      rowsToUpdate = new Map<string, number>();
      nicknameRows.forEach((row, nickname) => {
        if (!existingNicknames.has(nickname)) {
          rowsToUpdate.set(nickname, row);
        }
      });
    }

    if (rowsToUpdate.size === 0) {
      return { updated: 0, notFound: [] };
    }

    // Prepare batch update
    const updates: Array<{ range: string; values: (string | number)[][] }> = [];

    rowsToUpdate.forEach((row, _nickname) => {
      const range = `'${SHEET_NAME}'!${column}${row}`;
      updates.push({
        range,
        values: [[0]], // Use number 0, not string '0'
      });
    });

    // Batch write all zeros
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });

    const updated = rowsToUpdate.size;
    const notFound: string[] = [];

    return { updated, notFound };
  }

  /**
   * Find the last date column by scanning row 1 from column F until empty cell
   * Returns column letter and date value, or null if no date columns found
   */
  async function findLastDateColumn(): Promise<{
    column: string;
    date: string;
  } | null> {
    // Start from column F and read row 1 until we find an empty cell
    const _currentColumn = SHEET_DATA_FIRST_COLUMN;
    let lastDateColumn: { column: string; date: string } | null = null;

    // Read a large range to find the last non-empty cell
    // Read row 1 from column F to column ZZ (max reasonable range)
    const range = `'${SHEET_NAME}'!${SHEET_DATA_FIRST_COLUMN}${SHEET_DATE_ROW}:ZZ${SHEET_DATE_ROW}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });

    const values = response.data.values?.[0] || [];

    // Find the last non-empty cell until there is an empty cell
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      const prevIndex = i - 1;
      const prevValue = values[prevIndex];
      if (value == null || value === undefined || String(value).trim() === '') {
        const columnIndex =
          columnLetterToIndex(SHEET_DATA_FIRST_COLUMN) + prevIndex;
        const columnLetter = indexToColumnLetter(columnIndex);
        lastDateColumn = {
          column: columnLetter,
          date: String(prevValue).trim(),
        };
        break;
      }
    }

    return lastDateColumn;
  }

  /**
   * Get metadata for a column (date, cost, player count from rows 1-3)
   */
  async function getColumnMetadata(column: string): Promise<ColumnMetadata> {
    const range = `'${SHEET_NAME}'!${column}${SHEET_DATE_ROW}:${column}${SHEET_PLAYER_COUNT_ROW}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });

    const rows = response.data.values || [];
    const metadata: ColumnMetadata = {};

    // Row 1: Date
    if (
      rows[0] &&
      rows[0][0] !== null &&
      rows[0][0] !== undefined &&
      String(rows[0][0]).trim() !== ''
    ) {
      metadata.date = String(rows[0][0]).trim();
    }

    // Row 2: Cost
    if (
      rows[1] &&
      rows[1][0] !== null &&
      rows[1][0] !== undefined &&
      String(rows[1][0]).trim() !== ''
    ) {
      const costValue = rows[1][0];
      const costNum =
        typeof costValue === 'number'
          ? costValue
          : parseFloat(String(costValue));
      if (!Number.isNaN(costNum)) {
        metadata.cost = costNum;
      }
    }

    // Row 3: Player count
    if (
      rows[2] &&
      rows[2][0] !== null &&
      rows[2][0] !== undefined &&
      String(rows[2][0]).trim() !== ''
    ) {
      const countValue = rows[2][0];
      const countNum =
        typeof countValue === 'number'
          ? countValue
          : parseInt(String(countValue), 10);
      if (!Number.isNaN(countNum)) {
        metadata.playerCount = countNum;
      }
    }

    return metadata;
  }

  /**
   * Write metadata to column (rows 1-3)
   */
  async function writeColumnMetadata(
    column: string,
    date?: string,
    cost?: number,
    playerCount?: number,
  ): Promise<void> {
    const updates: Array<{ range: string; values: (string | number)[][] }> = [];

    if (date !== undefined) {
      updates.push({
        range: `'${SHEET_NAME}'!${column}${SHEET_DATE_ROW}`,
        values: [[date]],
      });
    }

    if (cost !== undefined) {
      updates.push({
        range: `'${SHEET_NAME}'!${column}${SHEET_COST_ROW}`,
        values: [[cost]],
      });
    }

    if (playerCount !== undefined) {
      updates.push({
        range: `'${SHEET_NAME}'!${column}${SHEET_PLAYER_COUNT_ROW}`,
        values: [[playerCount]],
      });
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates,
        },
      });
    }
  }

  return {
    findNicknameRows,
    checkExistingValues,
    writeZeros,
    findLastDateColumn,
    getColumnMetadata,
    writeColumnMetadata,
  };
}

export {
  columnLetterToIndex,
  getNextColumnLetter,
  indexToColumnLetter,
  initSheetsClient,
  type ColumnMetadata,
  type ExistingValue,
  type SheetsClient
};

