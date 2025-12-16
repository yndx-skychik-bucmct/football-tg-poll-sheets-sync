import { Bot, session } from 'grammy';
import { registerCommands } from './commands';
import { registerMessageHandlers } from './handlers';
import { registerPollAnswerHandler, registerPollCommand } from './poll';
import type { MyContext, SessionData } from './session';

// Bun automatically loads .env files, so no additional setup needed

// Initialize bot
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
}

const bot = new Bot<MyContext>(BOT_TOKEN);

// Session middleware
bot.use(
  session({
    initial: (): SessionData => ({
      state: 'idle',
      usernames: [],
      detectedColumn: undefined,
      targetColumn: undefined,
      isNewColumn: undefined,
      dateName: undefined,
      cost: undefined,
      playerCount: undefined,
      column: undefined,
      nicknameRowsEntries: undefined,
      existingValuesEntries: undefined,
      pollId: undefined,
      pollQuestion: undefined,
    }),
  }),
);

// Register all handlers
registerCommands(bot);
registerPollCommand(bot);
registerPollAnswerHandler(bot);
registerMessageHandlers(bot);

// Error handling
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof Error) {
    console.error('Error details:', e.message);
  }
});

// Start bot
console.log('🤖 Bot starting...');
bot
  .start()
  .then(() => {
    console.log('✅ Bot is running!');
  })
  .catch((error) => {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  });
