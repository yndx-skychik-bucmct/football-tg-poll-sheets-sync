import { handleApiError, parseYesNo, replyErrorAndReset } from '../bot-helpers';
import {
  ERR_INVALID_YES_NO,
  ERR_SESSION_DATA_LOST,
  ERR_TARGET_COLUMN_NOT_SET,
  MSG_USE_UPDATE_AGAIN,
  SHEET_DATA_FIRST_COLUMN,
} from '../constants';
import type { MyContext } from '../session';
import { resetSession } from '../session';
import { getNextColumnLetter, initSheetsClient } from '../sheets';
import { proceedWithMetadataCollection } from '../workflow';

/**
 * Start new column creation flow - ask for date name
 */
async function askForDateName(ctx: MyContext, column: string): Promise<void> {
  ctx.session.targetColumn = column;
  ctx.session.isNewColumn = true;
  ctx.session.state = 'awaiting_date_name';
  await ctx.reply(
    `📅 Please provide the date name for column ${column} (row 1):`,
  );
}

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

  const trimmedText = text.trim();

  // Check for yes/no first
  const answer = parseYesNo(trimmedText);

  if (answer !== null) {
    if (!ctx.session.targetColumn) {
      await replyErrorAndReset(ctx, ERR_TARGET_COLUMN_NOT_SET);
      return true;
    }

    if (answer === 'yes') {
      await proceedWithMetadataCollection(ctx);
    } else {
      // Calculate next column and go directly to date name
      const nextColumn = getNextColumnLetter(ctx.session.targetColumn);
      await askForDateName(ctx, nextColumn);
    }
    return true;
  }

  // Check if input is a column letter (A-Z, AA-ZZ)
  const columnLetterPattern = /^[A-Z]{1,2}$/i;
  if (columnLetterPattern.test(trimmedText)) {
    ctx.session.targetColumn = trimmedText.toUpperCase();
    ctx.session.isNewColumn = false;
    await proceedWithMetadataCollection(ctx);
    return true;
  }

  // Otherwise, treat as date text search
  try {
    const sheetsClient = await initSheetsClient();
    const result = await sheetsClient.findColumnByDateText(trimmedText);

    if (!result.success) {
      if (result.error === 'not_found') {
        await ctx.reply(
          `❌ No column found with date text "${trimmedText}".\n\n` +
            `Please try again with a different date text, column letter, or answer yes/no.`,
        );
        return true;
      }
    } else {
      // Check if multiple matches found
      if ('multiple' in result && result.multiple === true) {
        ctx.session.columnMatches = result.matches;
        ctx.session.state = 'awaiting_column_selection';

        let message = `📋 Multiple columns found matching "${trimmedText}":\n\n`;
        result.matches.forEach((match, index) => {
          message += `${index + 1}. Column ${match.column}: ${match.date}\n`;
        });
        message += `\nPlease choose a column by typing its number (1-${result.matches.length}) or column letter:`;

        await ctx.reply(message);
        return true;
      }

      // Single match found (result has 'column' property)
      if ('column' in result) {
        ctx.session.targetColumn = result.column;
        ctx.session.isNewColumn = false;
        await proceedWithMetadataCollection(ctx);
        return true;
      }
    }
  } catch (error) {
    await handleApiError(ctx, error, 'searching for column');
    return true;
  }

  // If we get here, input wasn't recognized
  await ctx.reply(
    `${ERR_INVALID_YES_NO}\n\n` +
      `You can also type a column letter (e.g., "F", "G") or date text to search.`,
  );
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
    // targetColumn is already set from workflow.ts
    const column = ctx.session.targetColumn || SHEET_DATA_FIRST_COLUMN;
    await askForDateName(ctx, column);
  } else {
    resetSession(ctx.session);
    await ctx.reply(`✅ Operation cancelled. ${MSG_USE_UPDATE_AGAIN}`);
  }

  return true;
}

/**
 * Handle awaiting_column_selection state
 */
export async function handleColumnSelection(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_column_selection') {
    return false;
  }

  if (!ctx.session.columnMatches || ctx.session.columnMatches.length === 0) {
    await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
    return true;
  }

  const trimmedText = text.trim();

  // Check if user typed a number (1-based index)
  const numberMatch = /^(\d+)$/.exec(trimmedText);
  if (numberMatch) {
    const index = parseInt(numberMatch[1], 10) - 1; // Convert to 0-based
    if (index >= 0 && index < ctx.session.columnMatches.length) {
      const selectedMatch = ctx.session.columnMatches[index];
      ctx.session.targetColumn = selectedMatch.column;
      ctx.session.isNewColumn = false;
      ctx.session.columnMatches = undefined;
      await proceedWithMetadataCollection(ctx);
      return true;
    } else {
      await ctx.reply(
        `❌ Invalid selection. Please choose a number between 1 and ${ctx.session.columnMatches.length}, or type a column letter.`,
      );
      return true;
    }
  }

  // Check if user typed a column letter
  const columnLetterPattern = /^[A-Z]{1,2}$/i;
  if (columnLetterPattern.test(trimmedText)) {
    const columnLetter = trimmedText.toUpperCase();
    const match = ctx.session.columnMatches.find(
      (m) => m.column === columnLetter,
    );
    if (match) {
      ctx.session.targetColumn = match.column;
      ctx.session.isNewColumn = false;
      ctx.session.columnMatches = undefined;
      await proceedWithMetadataCollection(ctx);
      return true;
    } else {
      await ctx.reply(
        `❌ Column ${columnLetter} is not in the list. Please choose from the options above.`,
      );
      return true;
    }
  }

  // Invalid input
  await ctx.reply(
    `❌ Please choose a column by typing its number (1-${ctx.session.columnMatches.length}) or column letter.`,
  );
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
