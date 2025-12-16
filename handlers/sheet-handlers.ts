import { handleApiError, parseYesNo, replyErrorAndReset } from '../bot-helpers';
import {
  ERR_INVALID_YES_NO,
  ERR_SESSION_DATA_LOST,
  ERR_TARGET_COLUMN_NOT_SET,
} from '../constants';
import type { MyContext } from '../session';
import { initSheetsClient } from '../sheets';
import {
  checkOverridesAndWrite,
  proceedWithPlayerCountCheck,
  writeZerosAndRespond,
} from '../workflow';

/**
 * Parse usernames from text input
 * Handles formats like: @user1 @user2, user1, user2, user1;user2, or one per line
 * Supports separators: spaces, commas, semicolons, newlines
 */
export function parseUsernames(text: string): string[] {
  // Split by spaces, commas, semicolons, or newlines
  // This regex handles: spaces, tabs, commas, semicolons, newlines, and combinations
  const parts = text
    .split(/[\s,;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  // Normalize: ensure @ prefix (works with or without @)
  return parts
    .map((part) => {
      const cleaned = part.trim();
      // Remove @ if present, then add it back (normalizes @@user to @user)
      const withoutAt = cleaned.replace(/^@+/, '');
      return withoutAt.length > 0 ? `@${withoutAt}` : '';
    })
    .filter((part) => part.length > 0);
}

/**
 * Handle awaiting_usernames state
 */
export async function handleUsernames(
  ctx: MyContext,
  rawText: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_usernames') {
    return false;
  }

  const usernames = parseUsernames(rawText);

  if (usernames.length === 0) {
    await ctx.reply('❌ Failed to recognize usernames. Try again or use /help');
    return true;
  }

  if (!ctx.session.targetColumn) {
    await replyErrorAndReset(ctx, ERR_TARGET_COLUMN_NOT_SET);
    return true;
  }

  ctx.session.usernames = usernames;
  await proceedWithPlayerCountCheck(ctx);
  return true;
}

/**
 * Handle awaiting_player_count_confirmation state
 */
export async function handlePlayerCountConfirmation(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_player_count_confirmation') {
    return false;
  }

  const answer = parseYesNo(text);

  if (answer === null) {
    await ctx.reply(ERR_INVALID_YES_NO);
    return true;
  }

  if (!ctx.session.targetColumn || !ctx.session.nicknameRowsEntries) {
    await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
    return true;
  }

  const nicknameRows = new Map<string, number>(ctx.session.nicknameRowsEntries);
  const recognizedCount = nicknameRows.size;

  if (answer === 'yes') {
    ctx.session.playerCount = recognizedCount;

    try {
      const sheetsClient = await initSheetsClient();
      await sheetsClient.writeColumnMetadata(
        ctx.session.targetColumn,
        undefined,
        undefined,
        ctx.session.playerCount,
      );

      // Check for existing values and handle override
      await checkOverridesAndWrite(ctx, nicknameRows);
    } catch (error) {
      await handleApiError(
        ctx,
        error,
        'writing player count or checking overrides',
        false,
      );
    }
  } else {
    ctx.session.state = 'awaiting_player_count';
    await ctx.reply('How many players attended the match?');
  }

  return true;
}

/**
 * Handle awaiting_player_count state
 */
export async function handlePlayerCount(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_player_count') {
    return false;
  }

  const count = parseInt(text, 10);
  if (Number.isNaN(count) || count < 0) {
    await ctx.reply(
      '❌ Please provide a valid positive integer for the player count',
    );
    return true;
  }

  ctx.session.playerCount = count;

  if (!ctx.session.targetColumn || !ctx.session.nicknameRowsEntries) {
    await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
    return true;
  }

  try {
    const sheetsClient = await initSheetsClient();
    await sheetsClient.writeColumnMetadata(
      ctx.session.targetColumn,
      undefined,
      undefined,
      ctx.session.playerCount,
    );

    const nicknameRows = new Map<string, number>(
      ctx.session.nicknameRowsEntries,
    );
    await checkOverridesAndWrite(ctx, nicknameRows);
  } catch (error) {
    await handleApiError(ctx, error, 'writing player count', false);
  }

  return true;
}

/**
 * Handle awaiting_override_confirmation state
 */
export async function handleOverrideConfirmation(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_override_confirmation') {
    return false;
  }

  const answer = parseYesNo(text);

  if (answer === null) {
    await ctx.reply(ERR_INVALID_YES_NO);
    return true;
  }

  const columnToUse = ctx.session.column || ctx.session.targetColumn;
  if (!columnToUse || !ctx.session.nicknameRowsEntries) {
    await replyErrorAndReset(
      ctx,
      '❌ Error: session data lost. Start over with /update',
    );
    return true;
  }

  const nicknameRows = new Map<string, number>(ctx.session.nicknameRowsEntries);
  const overrideExisting = answer === 'yes';

  const skippedNicknames: string[] =
    !overrideExisting && ctx.session.existingValuesEntries
      ? ctx.session.existingValuesEntries.map((ev) => ev.nickname)
      : [];

  try {
    await writeZerosAndRespond(
      ctx,
      nicknameRows,
      columnToUse,
      overrideExisting,
      skippedNicknames,
    );
  } catch (error) {
    await handleApiError(ctx, error, 'updating sheet');
  }

  return true;
}
