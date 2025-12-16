import type { Bot } from 'grammy';
import type { MyContext } from './session';

/**
 * Poll data storage for tracking votes
 */
export interface PollData {
  question: string;
  options: string[];
  votes: Map<number, Set<string>>; // optionIndex -> Set of @usernames
}

// In-memory storage for active polls (keyed by poll ID)
export const activePolls = new Map<string, PollData>();

/**
 * Register poll command handler
 */
export function registerPollCommand(bot: Bot<MyContext>): void {
  /**
   * Poll command handler - create a trackable non-anonymous poll
   */
  bot.command('poll', async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      await ctx.reply(
        '❌ Please provide poll question and options.\n\n' +
          'Usage: /poll Question? | Option1 | Option2 | Option3\n' +
          'Separators: | or ; or newlines',
      );
      return;
    }

    // Extract question and options (remove /poll command)
    const content = text.replace(/^\/poll\s+/i, '').trim();

    // Split by |, ;, or newlines
    const parts = content
      .split(/[|;\n]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (parts.length < 2) {
      await ctx.reply(
        '❌ Please provide at least a question and one option.\n\n' +
          'Usage: /poll Question? | Option1 | Option2\n' +
          'Separators: | or ; or newlines',
      );
      return;
    }

    const question = parts[0];
    const options = parts.slice(1);

    if (options.length < 1) {
      await ctx.reply('❌ Please provide at least one option.');
      return;
    }

    try {
      // Create non-anonymous poll
      const pollMessage = await ctx.api.sendPoll(
        ctx.chat.id,
        question,
        options,
        {
          is_anonymous: false,
        },
      );

      // Store poll data
      const pollId = pollMessage.poll?.id;
      if (pollId) {
        activePolls.set(pollId, {
          question,
          options,
          votes: new Map(),
        });
        console.log(
          `[POLL CREATED] Poll ID: ${pollId}, Question: "${question}", Options: ${options.join(', ')}, Chat ID: ${ctx.chat.id}, User: @${ctx.from?.username || 'unknown'}`,
        );
      }

      await ctx.reply(
        '✅ Poll created! Forward it back to me to see voters or update the sheet.',
      );
    } catch (error) {
      console.error('Error creating poll:', error);
      await ctx.reply(
        `❌ Error creating poll: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  });
}

/**
 * Register poll answer handler
 */
export function registerPollAnswerHandler(bot: Bot<MyContext>): void {
  /**
   * Poll answer handler - track votes for non-anonymous polls
   */
  bot.on('poll_answer', async (ctx) => {
    console.log('[POLL ANSWER HANDLER] Received poll_answer event');

    const pollAnswer = ctx.pollAnswer;
    console.log(
      '[POLL ANSWER HANDLER] pollAnswer:',
      JSON.stringify(pollAnswer, null, 2),
    );

    if (!pollAnswer) {
      console.log('[POLL ANSWER HANDLER] No pollAnswer found, exiting');
      return;
    }

    const pollId = pollAnswer.poll_id;
    console.log('[POLL ANSWER HANDLER] Poll ID:', pollId);
    console.log(
      '[POLL ANSWER HANDLER] Active polls:',
      Array.from(activePolls.keys()),
    );

    const pollData = activePolls.get(pollId);
    if (!pollData) {
      console.log(
        `[POLL ANSWER HANDLER] Poll ID ${pollId} not found in activePolls, exiting`,
      );
      return; // Not our poll
    }

    console.log(`[POLL ANSWER HANDLER] Found poll data for ID ${pollId}:`, {
      question: pollData.question,
      options: pollData.options,
      currentVotes: Array.from(pollData.votes.entries()).map(
        ([id, voters]) => ({
          optionId: id,
          optionText: pollData.options[id],
          voters: Array.from(voters),
        }),
      ),
    });

    // In poll_answer updates, user is in pollAnswer.user, not ctx.from
    const user = pollAnswer.user;
    console.log(
      '[POLL ANSWER HANDLER] User from pollAnswer:',
      user ? { id: user.id, username: user.username } : 'null',
    );

    if (!user) {
      console.log(
        '[POLL ANSWER HANDLER] No user found in pollAnswer.user, exiting',
      );
      return;
    }

    // Check if user has username property (not all user types have it)
    if (!('username' in user)) {
      console.log(
        '[POLL ANSWER HANDLER] User does not have username property, exiting',
      );
      return; // Can't track users without username
    }

    const username = (user as { username?: string }).username;
    console.log('[POLL ANSWER HANDLER] Username:', username);

    if (!username) {
      console.log('[POLL ANSWER HANDLER] Username is empty, exiting');
      return;
    }

    const usernameWithAt = `@${username}`;
    console.log('[POLL ANSWER HANDLER] Username with @:', usernameWithAt);

    // Remove user from all options first (in case they changed their vote)
    console.log(
      '[POLL ANSWER HANDLER] Removing user from all options before adding to new ones',
    );
    pollData.votes.forEach((voters, optionId) => {
      const hadUser = voters.has(usernameWithAt);
      voters.delete(usernameWithAt);
      if (hadUser) {
        console.log(
          `[POLL ANSWER HANDLER] Removed ${usernameWithAt} from option ${optionId} (${pollData.options[optionId]})`,
        );
      }
    });

    // Add user to selected options
    console.log('[POLL ANSWER HANDLER] Option IDs:', pollAnswer.option_ids);
    if (pollAnswer.option_ids && pollAnswer.option_ids.length > 0) {
      const selectedOptions = pollAnswer.option_ids.map(
        (id) => pollData.options[id] || `Option ${id}`,
      );
      console.log(
        `[POLL ANSWER] Poll ID: ${pollId}, User: ${usernameWithAt}, Selected: ${selectedOptions.join(', ')}, Question: "${pollData.question}"`,
      );

      for (const optionId of pollAnswer.option_ids) {
        if (!pollData.votes.has(optionId)) {
          pollData.votes.set(optionId, new Set());
          console.log(
            `[POLL ANSWER HANDLER] Created new vote set for option ${optionId} (${pollData.options[optionId]})`,
          );
        }
        pollData.votes.get(optionId)?.add(usernameWithAt);
        console.log(
          `[POLL ANSWER HANDLER] Added ${usernameWithAt} to option ${optionId} (${pollData.options[optionId]})`,
        );
      }

      // Log final state
      console.log(
        '[POLL ANSWER HANDLER] Final vote state:',
        Array.from(pollData.votes.entries()).map(([id, voters]) => ({
          optionId: id,
          optionText: pollData.options[id],
          voters: Array.from(voters),
        })),
      );
    } else {
      console.log(
        '[POLL ANSWER HANDLER] No option_ids provided, user removed from all options',
      );
    }
  });
}
