# @hazel-chat/bot-sdk Examples

This directory contains example bots demonstrating how to use the `@hazel-chat/bot-sdk` package.

## Available Examples

### 1. Simple Echo Bot

**Location:** `simple-echo-bot/`

A basic bot that listens for new messages and logs them to the console. This is the perfect starting point for learning the bot SDK.

**Features:**

- Bot authentication
- Connecting to the bot gateway websocket
- Listening for message events
- Error handling
- Graceful shutdown

**What you'll learn:**

- How to set up a bot runtime
- How to register event handlers
- How to handle bot lifecycle
- Basic Effect-TS patterns

## Quick Start

### Prerequisites

Before running any example, you need:

1. **Bot Token**: Create a bot in your organization and get its authentication token
2. **Organization ID**: The ID of the organization where your bot will operate
3. **Gateway URL**: The URL of your bot gateway service (defaults to `http://localhost:3004`)

### Running an Example

1. **Navigate to the example directory:**

    ```bash
    cd libs/bot-sdk/examples/simple-echo-bot
    ```

2. **Set up environment variables:**

    ```bash
    cp .env.example .env
    ```

3. **Edit `.env` and fill in your credentials:**

    ```
    BOT_TOKEN=your_bot_token_here
    BACKEND_URL=http://localhost:3003
    GATEWAY_URL=http://localhost:3004
    ```

4. **Install dependencies** (if not already installed from the workspace root):

    ```bash
    bun install
    ```

5. **Run the bot:**

    ```bash
    bun run start
    ```

    Or, for development with auto-reload:

    ```bash
    bun run dev
    ```

6. **Stop the bot:**
   Press `Ctrl+C` to gracefully shut down the bot.

## Getting Bot Credentials

### Creating a Bot

To create a bot and get a bot token:

1. Navigate to your organization settings
2. Go to the "Bots" section
3. Click "Create Bot"
4. Give your bot a name and save
5. Copy the generated bot token (you won't be able to see it again!)

### Finding Your Organization ID

You can find your organization ID:

1. In your organization settings URL
2. Via the API
3. In your application's state/context

## Project Structure

Each example follows this structure:

```
example-name/
├── index.ts        # Main bot implementation
├── .env.example    # Environment variable template
├── package.json    # Dependencies and scripts
└── README.md       # Example-specific documentation (if needed)
```

## Common Patterns

### Environment Variables

All examples use these environment variables:

- `BOT_TOKEN` - Required. Your bot's authentication token
- `BACKEND_URL` - Optional. Backend API URL for short request/response bot APIs
- `GATEWAY_URL` - Optional. Gateway URL for inbound websocket delivery

### Error Handling

Examples demonstrate:

- Validating required configuration
- Handling bot startup errors
- Graceful shutdown on SIGINT/SIGTERM
- Effect-TS error handling patterns

### Bot Lifecycle

A typical bot lifecycle:

1. Load and validate configuration
2. Create bot runtime with config
3. Define program with event handlers
4. Start the bot
5. Process events continuously
6. Shut down gracefully on signal

## Next Steps

After exploring the examples:

1. **Read the main README:** See `packages/bot-sdk/README.md` for full API documentation
2. **Check the source code:** Explore `packages/bot-sdk/src/` to understand the implementation
3. **Build your own bot:** Use these examples as templates for your own bot applications
4. **Explore Effect-TS:** Learn more about Effect at https://effect.website

## Troubleshooting

### "BOT_TOKEN environment variable is required"

Make sure you've:

1. Copied `.env.example` to `.env`
2. Filled in your bot token in the `.env` file
3. Created a bot in your organization to get a token

### "Cannot connect to the bot gateway"

Check that:

1. Your bot gateway service is running
2. The `GATEWAY_URL` is correct
3. Your bot token is valid
4. Your network can reach the gateway endpoint

### "No events are being received"

Verify that:

1. Your bot has access to the organization
2. There are actually messages being created in channels
3. The gateway is connected to the backend event stream
4. Your bot has the necessary permissions

## Contributing

Found a bug or have an idea for a new example? Please open an issue or submit a pull request!

## License

These examples are part of the @hazel-chat/bot-sdk package and follow the same license.
