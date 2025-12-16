import { handleApiError, parseYesNo, replyErrorAndReset } from '../bot-helpers';
import {
  ERR_INVALID_YES_NO,
  ERR_TARGET_COLUMN_NOT_SET,
  MSG_USE_UPDATE_AGAIN,
  SHEET_DATA_FIRST_COLUMN,
} from '../constants';
import type { MyContext } from '../session';
import { resetSession } from '../session';
import { getNextColumnLetter, initSheetsClient } from '../sheets';
import { proceedWithMetadataCollection } from '../workflow';

/**
 * Handle awaiting_column_confirmation state
 */
export async function handleColumnConfirmation(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_column_confirmation') {
    return false;
  }

  const answer = parseYesNo(text);

  if (answer === null) {
    await ctx.reply(ERR_INVALID_YES_NO);
    return true;
  }

  if (!ctx.session.targetColumn) {
    await replyErrorAndReset(ctx, ERR_TARGET_COLUMN_NOT_SET);
    return true;
  }

  if (answer === 'yes') {
    await proceedWithMetadataCollection(ctx);
  } else {
    // Calculate next column
    const nextColumn = getNextColumnLetter(ctx.session.targetColumn);
    ctx.session.state = 'awaiting_new_column_choice';
    await ctx.reply(`Create new column ${nextColumn}? (yes/no)`);
  }

  return true;
}

/**
 * Handle awaiting_new_column_choice state
 */
export async function handleNewColumnChoice(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_new_column_choice') {
    return false;
  }

  const answer = parseYesNo(text);

  if (answer === null) {
    await ctx.reply(ERR_INVALID_YES_NO);
    return true;
  }

  if (answer === 'yes') {
    // Calculate next column
    if (!ctx.session.targetColumn) {
      ctx.session.targetColumn = SHEET_DATA_FIRST_COLUMN;
    } else {
      ctx.session.targetColumn = getNextColumnLetter(ctx.session.targetColumn);
    }
    ctx.session.isNewColumn = true;
    ctx.session.state = 'awaiting_date_name';
    await ctx.reply(
      `📅 Please provide the date name for column ${ctx.session.targetColumn} (row 1):`,
    );
  } else {
    resetSession(ctx.session);
    await ctx.reply(`✅ Operation cancelled. ${MSG_USE_UPDATE_AGAIN}`);
  }

  return true;
}

/**
 * Handle awaiting_date_name state
 */
export async function handleDateName(
  ctx: MyContext,
  rawText: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_date_name') {
    return false;
  }

  const trimmed = rawText.trim();
  if (!trimmed || trimmed.length === 0) {
    await ctx.reply('❌ Please provide a date name');
    return true;
  }

  ctx.session.dateName = trimmed;

  const targetColumn = ctx.session.targetColumn;
  if (!targetColumn) {
    await replyErrorAndReset(
      ctx,
      '❌ Error: target column not set. Start over with /update',
    );
    return true;
  }

  try {
    const sheetsClient = await initSheetsClient();
    await sheetsClient.writeColumnMetadata(targetColumn, ctx.session.dateName);
  } catch (error) {
    await handleApiError(ctx, error, 'writing date', false);
    return true;
  }

  // Continue to cost check
  await proceedWithMetadataCollection(ctx);
  return true;
}

/**
 * Handle awaiting_cost state
 */
export async function handleCost(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_cost') {
    return false;
  }

  const cost = parseFloat(text);
  if (Number.isNaN(cost) || cost < 0) {
    await ctx.reply('❌ Please provide a valid positive number for the cost');
    return true;
  }

  ctx.session.cost = cost;

  const targetColumn = ctx.session.targetColumn;
  if (!targetColumn) {
    await replyErrorAndReset(
      ctx,
      '❌ Error: target column not set. Start over with /update',
    );
    return true;
  }

  try {
    const sheetsClient = await initSheetsClient();
    await sheetsClient.writeColumnMetadata(
      targetColumn,
      undefined,
      ctx.session.cost,
    );
  } catch (error) {
    await handleApiError(ctx, error, 'writing cost', false);
    return true;
  }

  // Continue to player count check
  await proceedWithMetadataCollection(ctx);
  return true;
}
