import logging
from telegram.ext import Updater, CommandHandler
from aternos import Client

ATERNOS_EMAIL = "your-aternos-email"
ATERNOS_PASS = "your-aternos-password"
BOT_TOKEN = "your-telegram-bot-token"

def startserver(update, context):
    update.message.reply_text("Starting your Aternos server...")

    try:
        at = Client.from_credentials(ATERNOS_EMAIL, ATERNOS_PASS)
        server = at.list_servers()[0]
        server.start()
        update.message.reply_text("Server starting! It may take 2-3 minutes.")
    except Exception as e:
        update.message.reply_text(f"Error: {e}")

def main():
    updater = Updater(BOT_TOKEN, use_context=True)
    dp = updater.dispatcher

    dp.add_handler(CommandHandler("startserver", startserver))

    updater.start_polling()
    updater.idle()

if __name__ == "__main__":
    main()
