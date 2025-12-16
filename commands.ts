import type { Bot } from 'grammy';
import { MSG_USE_UPDATE_AGAIN } from './constants';
import type { MyContext } from './session';
import { resetSession } from './session';
import { startColumnDetectionFlow } from './workflow';

/**
 * Register all command handlers
 */
export function registerCommands(bot: Bot<MyContext>): void {
  /**
   * Start command handler - shows help/welcome message
   */
  bot.command('start', async (ctx) => {
    await ctx.reply(
      `👋 Welcome to Football Poll Sheets Sync Bot!\n\n` +
        `📖 Commands:\n` +
        `• /poll - Create a trackable poll\n` +
        `• /update - Update Google Sheet with attending players\n` +
        `• /help - Show this help\n` +
        `• /cancel or /abort - Cancel current operation\n\n` +
        `💡 Tip: Forward a poll created by this bot to see voters or update the sheet!`,
    );
  });

  /**
   * Help command handler
   */
  bot.command('help', async (ctx) => {
    await ctx.reply(
      `📖 Help:\n\n` +
        `• /poll - Create a trackable poll\n` +
        `• /update - Update Google Sheet with attending players\n` +
        `• /help - Show this help\n` +
        `• /cancel or /abort - Cancel current operation\n\n` +
        `The bot will guide you through updating a column step by step.`,
    );
  });

  /**
   * Update command handler - main workflow (column detection)
   */
  bot.command('update', async (ctx) => {
    resetSession(ctx.session);
    await startColumnDetectionFlow(ctx);
  });

  /**
   * Cancel command handler
   */
  bot.command('cancel', async (ctx) => {
    resetSession(ctx.session);
    await ctx.reply(`✅ Operation cancelled. ${MSG_USE_UPDATE_AGAIN}`);
  });

  /**
   * Abort command handler (alias for cancel)
   */
  bot.command('abort', async (ctx) => {
    resetSession(ctx.session);
    await ctx.reply(`✅ Operation aborted. ${MSG_USE_UPDATE_AGAIN}`);
  });
}
