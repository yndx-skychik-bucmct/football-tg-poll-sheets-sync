import type { Bot } from 'grammy';
import type { MyContext } from '../session';
import {
  handleColumnConfirmation,
  handleCost,
  handleDateName,
  handleNewColumnChoice,
} from './column-handlers';
import {
  handlePollIntent,
  handlePollOptionSelection,
  registerPollMessageHandler,
} from './poll-handlers';
import {
  handleOverrideConfirmation,
  handlePlayerCount,
  handlePlayerCountConfirmation,
  handleUsernames,
} from './sheet-handlers';

/**
 * Register all message handlers
 */
export function registerMessageHandlers(bot: Bot<MyContext>): void {
  // Register poll message handler (forwarded polls)
  registerPollMessageHandler(bot);

  // Register text message handler (state machine)
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim().toLowerCase();
    const rawText = ctx.message.text.trim();

    // Try each handler in order - first match wins
    // Poll handlers
    if (await handlePollIntent(ctx, text)) return;
    if (await handlePollOptionSelection(ctx, rawText)) return;

    // Column handlers
    if (await handleColumnConfirmation(ctx, text)) return;
    if (await handleNewColumnChoice(ctx, text)) return;
    if (await handleDateName(ctx, rawText)) return;
    if (await handleCost(ctx, text)) return;

    // Sheet handlers
    if (await handleUsernames(ctx, rawText)) return;
    if (await handlePlayerCountConfirmation(ctx, text)) return;
    if (await handlePlayerCount(ctx, text)) return;
    if (await handleOverrideConfirmation(ctx, text)) return;

    // Default: idle state
    await ctx.reply('👋 Use /start to begin updating a column.');
  });
}
