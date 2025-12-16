import {
    buildUpdateResultMessage,
    handleApiError,
    replyErrorAndReset,
} from './bot-helpers';
import {
    ERR_TARGET_COLUMN_NOT_SET,
    SHEET_DATA_FIRST_COLUMN,
} from './constants';
import type { MyContext } from './session';
import { resetSession } from './session';
import { initSheetsClient } from './sheets';

/**
 * Start the column detection flow
 * Used by /update command and poll option selection
 */
export async function startColumnDetectionFlow(ctx: MyContext): Promise<void> {
  await ctx.reply('⏳ Detecting last date column...');

  try {
    const sheetsClient = await initSheetsClient();
    const lastDateColumn = await sheetsClient.findLastDateColumn();

    if (!lastDateColumn) {
      await ctx.reply(
        `❌ No date columns found. Starting from column ${SHEET_DATA_FIRST_COLUMN}.\n\n` +
          'Would you like to create a new column? (yes/no)',
      );
      ctx.session.state = 'awaiting_new_column_choice';
      ctx.session.targetColumn = SHEET_DATA_FIRST_COLUMN;
      ctx.session.isNewColumn = true;
      return;
    }

    ctx.session.detectedColumn = lastDateColumn.column;
    ctx.session.targetColumn = lastDateColumn.column;
    ctx.session.state = 'awaiting_column_confirmation';

    await ctx.reply(
      `📅 I detected column ${lastDateColumn.column} (${lastDateColumn.date}).\n\n` +
        `Update this column? (yes/no)`,
    );
  } catch (error) {
    await handleApiError(ctx, error, 'detecting column');
  }
}

/**
 * Check for existing values and either write directly or ask for override confirmation
 * Shared logic between player count confirmation and direct write flows
 */
export async function checkOverridesAndWrite(
  ctx: MyContext,
  nicknameRows: Map<string, number>,
): Promise<void> {
  const column = ctx.session.targetColumn;
  if (!column) {
    await replyErrorAndReset(ctx, ERR_TARGET_COLUMN_NOT_SET);
    return;
  }

  const sheetsClient = await initSheetsClient();

  const existingValues = await sheetsClient.checkExistingValues(
    nicknameRows,
    column,
  );

  if (existingValues.length > 0) {
    ctx.session.column = column;
    ctx.session.nicknameRowsEntries = Array.from(nicknameRows.entries());
    ctx.session.existingValuesEntries = existingValues;
    ctx.session.state = 'awaiting_override_confirmation';

    let message = `⚠️ These users already have values in column ${column}:\n\n`;
    existingValues.forEach((ev) => {
      message += `• ${ev.nickname}: ${ev.value}\n`;
    });
    message += `\nOverwrite? (yes/no)`;

    await ctx.reply(message);
  } else {
    await writeZerosAndRespond(ctx, nicknameRows, column, true, []);
  }
}

/**
 * Write zeros to sheet and send response message
 * Common logic for final write step
 */
export async function writeZerosAndRespond(
  ctx: MyContext,
  nicknameRows: Map<string, number>,
  column: string,
  overrideExisting: boolean,
  skippedNicknames: string[],
): Promise<void> {
  await ctx.reply('⏳ Updating sheet...');

  const sheetsClient = await initSheetsClient();

  console.log(
    `[SHEET UPDATE] Column: ${column}, Users: ${Array.from(nicknameRows.keys()).join(', ')}, Override: ${overrideExisting}, Skipped: ${skippedNicknames.join(', ') || 'none'}, Chat ID: ${ctx.chat?.id || 'unknown'}, User: @${ctx.from?.username || 'unknown'}`,
  );

  const result = await sheetsClient.writeZeros(
    nicknameRows,
    column,
    overrideExisting,
  );

  console.log(
    `[SHEET UPDATE COMPLETE] Column: ${column}, Updated: ${result.updated}, Not found: ${result.notFound.length}`,
  );

  const allFoundNicknames = Array.from(nicknameRows.keys());
  const updatedNicknames = allFoundNicknames.filter(
    (n) => !skippedNicknames.includes(n),
  );
  const notFoundNicknames = ctx.session.usernames.filter(
    (u) => !allFoundNicknames.includes(u),
  );

  const response = buildUpdateResultMessage(
    column,
    result.updated,
    updatedNicknames,
    skippedNicknames,
    notFoundNicknames,
  );

  await ctx.reply(response);
  resetSession(ctx.session);
}

/**
 * Helper function to process usernames and check player count
 */
export async function proceedWithPlayerCountCheck(
  ctx: MyContext,
): Promise<void> {
  if (
    !ctx.session.targetColumn ||
    !ctx.session.usernames ||
    ctx.session.usernames.length === 0
  ) {
    await replyErrorAndReset(
      ctx,
      '❌ Error: missing usernames or target column. Start over with /update',
    );
    return;
  }

  await ctx.reply('⏳ Checking sheet...');

  try {
    const sheetsClient = await initSheetsClient();
    const nicknameRows = await sheetsClient.findNicknameRows(
      ctx.session.usernames,
    );

    if (nicknameRows.size === 0) {
      await ctx.reply(
        '❌ No matches found in the sheet.\n\n' +
          `Sent usernames: ${ctx.session.usernames.join(', ')}\n\n` +
          `Check that usernames in the sheet (column B) match the ones you sent.`,
      );
      resetSession(ctx.session);
      return;
    }

    // Check if player count needs to be set
    if (ctx.session.playerCount === undefined) {
      const recognizedCount = nicknameRows.size;
      ctx.session.state = 'awaiting_player_count_confirmation';
      await ctx.reply(
        `👥 I found ${recognizedCount} recognized username(s).\n\n` +
          `Is ${recognizedCount} the total number of players who attended? (yes/no)`,
      );
      ctx.session.nicknameRowsEntries = Array.from(nicknameRows.entries());
      return;
    }

    // Player count already set, proceed to override check
    await checkOverridesAndWrite(ctx, nicknameRows);
  } catch (error) {
    await handleApiError(ctx, error, 'processing usernames');
  }
}

/**
 * Helper function to proceed with metadata collection and then usernames
 */
export async function proceedWithMetadataCollection(
  ctx: MyContext,
): Promise<void> {
  if (!ctx.session.targetColumn) {
    await replyErrorAndReset(ctx, ERR_TARGET_COLUMN_NOT_SET);
    return;
  }

  try {
    const sheetsClient = await initSheetsClient();
    const metadata = await sheetsClient.getColumnMetadata(
      ctx.session.targetColumn,
    );

    // Check date (row 1)
    if (!metadata.date) {
      ctx.session.state = 'awaiting_date_name';
      await ctx.reply(
        `📅 Column ${ctx.session.targetColumn} has no date name.\n\nPlease provide the date name for row 1:`,
      );
      return;
    }
    ctx.session.dateName = metadata.date;

    // Check cost (row 2)
    if (metadata.cost === undefined) {
      ctx.session.state = 'awaiting_cost';
      await ctx.reply(
        `💰 Column ${ctx.session.targetColumn} has no cost specified.\n\nPlease provide the field cost for row 2:`,
      );
      return;
    }
    ctx.session.cost = metadata.cost;

    // Store player count if it exists, but don't ask for it yet
    if (metadata.playerCount !== undefined) {
      ctx.session.playerCount = metadata.playerCount;
    }

    // Check if usernames are already set (from poll)
    if (ctx.session.usernames && ctx.session.usernames.length > 0) {
      await proceedWithPlayerCountCheck(ctx);
      return;
    }

    // All metadata complete, ask for usernames
    ctx.session.state = 'awaiting_usernames';
    let metadataMsg =
      `✅ Column ${ctx.session.targetColumn} metadata:\n` +
      `• Date: ${ctx.session.dateName}\n` +
      `• Cost: ${ctx.session.cost}\n`;
    if (ctx.session.playerCount !== undefined) {
      metadataMsg += `• Players: ${ctx.session.playerCount}\n`;
    }
    metadataMsg += `\nNow send me the list of usernames who will attend (with or without @, separated by spaces or commas):`;
    await ctx.reply(metadataMsg);
  } catch (error) {
    await handleApiError(ctx, error, 'checking column metadata');
  }
}
