# Football Telegram Poll to Google Sheets Sync Bot

Telegram bot that syncs poll results to Google Sheets. Accepts a list of player usernames and writes zeros to the specified column for attending players.

## Bot Conversation Flow

The bot guides users through updating a Google Sheet column step by step. Here's the complete flow:

```mermaid
stateDiagram-v2
    [*] --> DetectColumn: /update or poll forwarded

    state "Poll Flow" as PollFlow {
        ForwardPoll --> AskPollIntent: Poll recognized
        AskPollIntent --> ViewVoters: User chooses "2"
        AskPollIntent --> SelectOption: User chooses "1"
        SelectOption --> DetectColumn: Usernames extracted
        ViewVoters --> [*]: Show voters, reset
    }

    state "Main Flow" as MainFlow {
        DetectColumn --> ConfirmColumn: Last column found
        DetectColumn --> AskNewColumn: No columns found
        ConfirmColumn --> CheckMetadata: User confirms
        ConfirmColumn --> AskNewColumn: User declines
        AskNewColumn --> AskDateName: User confirms new column
        AskNewColumn --> [*]: User cancels

        CheckMetadata --> AskDateName: Date missing
        CheckMetadata --> AskCost: Date exists, cost missing
        CheckMetadata --> AskUsernames: All metadata exists
        AskDateName --> CheckMetadata: Date saved
        AskCost --> CheckMetadata: Cost saved

        AskUsernames --> CheckPlayerCount: Usernames matched
        CheckPlayerCount --> ConfirmPlayerCount: Count missing
        CheckPlayerCount --> CheckOverride: Count exists
        ConfirmPlayerCount --> AskPlayerCount: User says no
        ConfirmPlayerCount --> CheckOverride: User confirms
        AskPlayerCount --> CheckOverride: Count saved

        CheckOverride --> ConfirmOverride: Conflicts found
        CheckOverride --> WriteData: No conflicts
        ConfirmOverride --> WriteData: User decides
        WriteData --> [*]: Done, reset
    }
```

### Flow Explanation

**Entry Points:**
- `/update` command - starts manual flow
- Forward a poll created by `/poll` - starts poll-based flow

**Poll Flow:**
1. **AskPollIntent**: User chooses to view voters or update sheet
2. **SelectOption**: User selects which poll option contains attendees
3. Usernames extracted automatically, continues to main flow

**Main Flow:**
1. **DetectColumn**: Bot auto-detects the last date column (starting from column F)
2. **ConfirmColumn**: Asks user to confirm detected column or create new one
3. **CheckMetadata**: Verifies date (row 1) and cost (row 2), asks if missing
4. **AskUsernames**: User provides list of attending players' usernames (skipped if from poll)
5. **CheckPlayerCount**: After matching usernames, checks if row 3 has player count
6. **ConfirmPlayerCount**: If count missing, suggests the number of recognized usernames
7. **CheckOverride**: Checks if any cells already have values
8. **WriteData**: Writes zeros to the column for all matched usernames

## Features

- **Poll creation**: Create trackable non-anonymous polls with `/poll`
- **Poll integration**: Forward polls back to extract voter usernames automatically
- **Auto-detection**: Finds last date column in Google Sheets
- **Metadata collection**: Prompts for missing date, cost, player count
- **Username matching**: Matches usernames against Google Sheet (column B)
- **Smart suggestions**: Suggests player count based on recognized usernames
- **Override protection**: Asks before overwriting existing values
- **Zeros writing**: Writes zeros to specified columns for attending players

## Prerequisites

- [Bun](https://bun.sh) runtime installed
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Google Cloud Project with Sheets API enabled
- Service Account credentials for Google Sheets

## Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Create Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow instructions
3. Copy the bot token you receive

### 3. Set Up Google Sheets API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable **Google Sheets API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"
4. Create a Service Account:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Give it a name (e.g., "sheets-bot")
   - Click "Create and Continue"
   - Skip optional steps and click "Done"
5. Create and download JSON key:
   - Click on the created service account
   - Go to "Keys" tab
   - Click "Add Key" > "Create new key"
   - Select "JSON" format
   - Download the JSON file
6. Share your spreadsheet with the service account:
   - Open your Google Sheet, i.e. https://docs.google.com/spreadsheets/d/1eX1xQFB1-TJiGHTfFL3CZ1b-nVxOJKRqfvFCHGGGXGU
   - Click "Share" button
   - Add the service account email (found in the JSON file, looks like `xxx@xxx.iam.gserviceaccount.com`)
   - Give it **Editor** access
   - Click "Send"

### 4. Configure Environment Variables

Create a `.env` file in the project root:

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Google Sheets Service Account Configuration
# Option 1: Use JSON file path
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=./path/to/service-account-key.json

# Option 2: Use individual credentials (extract from JSON file)
# GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
# GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Google Spreadsheet ID (already configured)
SPREADSHEET_ID=1eX1xQF31-T2iGHTfFL3CZ1b-nVxOJKRqfvFCvGGGXGU
```

**Note:** The `.env` file is already in `.gitignore` and won't be committed.

## Usage

### Start the Bot

```bash
bun run index.ts
```

Or for development with auto-reload:

```bash
bun run dev
```

### Using the Bot

1. Open Telegram and start a conversation with your bot
2. Send `/start` to see instructions
3. Send a list of usernames (with or without @, separated by spaces/commas):
   ```
   @user1 @user2 user3 @user4
   ```
4. Bot will confirm the parsed usernames
5. Send the column letter (e.g., `O` or `AO`) where zeros should be written
6. Bot will update the Google Sheet and report results

### Commands

- `/start` - Show welcome message and help
- `/poll` - Create a trackable non-anonymous poll
- `/update` - Start the sheet update workflow
- `/help` - Show help message
- `/cancel` or `/abort` - Cancel current operation

**Tip:** Forward a poll created with `/poll` back to the bot to extract voters and update the sheet!

## How It Works

1. Bot parses usernames from your message (normalizes @ prefix)
2. Reads column B from the Google Sheet (starting row 7) to find matching nicknames
3. For each match, writes `0` to the cell at `[column][row]`
4. Reports which usernames were found and updated, and which weren't found

## Spreadsheet Structure

- **Column B**: Contains Telegram nicknames (e.g., `@almoga`, `@aboukh`)
- **Columns E+**: Date columns (e.g., "September 7", "December 13")
- **Data starts from row 7**

To change them, proceed to `constants.ts`

## License

MIT
