import discord
from discord.ext import commands
from discord import app_commands
import firebase_admin
from firebase_admin import credentials, db
import random
from datetime import datetime
import os

BOT_TOKEN = os.getenv('BOT_TOKEN')
if not BOT_TOKEN:
    raise ValueError("❌ Нет BOT_TOKEN в переменных окружения!")

cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://nexusclicker-11c93-default-rtdb.firebaseio.com'
})

commands_ref = db.reference('/discord_commands')
players_ref = db.reference('/players')
daily_ref = db.reference('/daily_claims')

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

ALLOWED_CHANNEL_ID = 1491811274097430538   # ЗАМЕНИТЕ
GUILD_ID = 1194999947955814452              # ЗАМЕНИТЕ
ADMIN_IDS = [1187805883149865053]           # ЗАМЕНИТЕ

def get_player_key(user_id: int) -> str:
    return f"player_{user_id}"

async def update_player_data(user_id: int, data_delta: int = 0, clicks_delta: int = 0):
    key = get_player_key(user_id)
    ref = players_ref.child(key)
    player = ref.get() or {}
    player['data'] = player.get('data', 0) + data_delta
    player['clicks'] = player.get('clicks', 0) + clicks_delta
    player['last_seen'] = datetime.utcnow().isoformat()
    ref.set(player)

async def get_top_players(limit=10):
    all_players = players_ref.get() or {}
    players_list = []
    for key, data in all_players.items():
        if key.startswith('player_'):
            user_id = int(key.split('_')[1])
            players_list.append((user_id, data.get('data', 0)))
    players_list.sort(key=lambda x: x[1], reverse=True)
    return players_list[:limit]

def get_rank(data_amount):
    if data_amount < 1000: return "🟢 Хакер-стажёр"
    elif data_amount < 5000: return "🔵 Сетевой взломщик"
    elif data_amount < 20000: return "🟣 Кибер-рейдер"
    elif data_amount < 100000: return "🟠 Повелитель данных"
    else: return "🔴 Нексус-архитектор"

class ControlButtons(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="⚡ Оверклок", style=discord.ButtonStyle.primary)
    async def overclock_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.channel_id != ALLOWED_CHANNEL_ID:
            await interaction.response.send_message("❌ Не тот канал.", ephemeral=True)
            return
        commands_ref.push({"type": "overclock", "issued_by": str(interaction.user), "timestamp": datetime.utcnow().isoformat()})
        await interaction.response.send_message("⚡ Оверклок активирован!", ephemeral=False)

    @discord.ui.button(label="📦 Выпадение данных", style=discord.ButtonStyle.success)
    async def datadrop_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.channel_id != ALLOWED_CHANNEL_ID:
            await interaction.response.send_message("❌ Не тот канал.", ephemeral=True)
            return
        commands_ref.push({"type": "data_drop", "issued_by": str(interaction.user), "timestamp": datetime.utcnow().isoformat()})
        await interaction.response.send_message("📦 Сундук с данными появился!", ephemeral=False)

    @discord.ui.button(label="🛡️ Файервол", style=discord.ButtonStyle.danger)
    async def firewall_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.channel_id != ALLOWED_CHANNEL_ID:
            await interaction.response.send_message("❌ Не тот канал.", ephemeral=True)
            return
        commands_ref.push({"type": "firewall", "issued_by": str(interaction.user), "timestamp": datetime.utcnow().isoformat()})
        await interaction.response.send_message("🛡️ Файервол активирован! -50% дохода.", ephemeral=False)

class ExtraButtons(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="📊 Моя статистика", style=discord.ButtonStyle.secondary)
    async def my_stats_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        key = get_player_key(interaction.user.id)
        data = players_ref.child(key).get() or {}
        embed = discord.Embed(title="📊 Ваша статистика", color=0x00ffff)
        embed.add_field(name="📦 Data", value=data.get('data', 0), inline=True)
        embed.add_field(name="🖱️ Кликов", value=data.get('clicks', 0), inline=True)
        embed.add_field(name="🏆 Ранг", value=get_rank(data.get('data', 0)), inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @discord.ui.button(label="🎁 Ежедневный бонус", style=discord.ButtonStyle.success)
    async def daily_bonus_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        today = datetime.utcnow().date().isoformat()
        claim_key = f"{interaction.user.id}_{today}"
        claimed = daily_ref.child(claim_key).get()
        if claimed:
            await interaction.response.send_message("❌ Вы уже получали бонус сегодня!", ephemeral=True)
            return
        bonus = random.randint(500, 1500)
        commands_ref.push({"type": "personal_bonus", "user_id": str(interaction.user.id), "amount": bonus, "timestamp": datetime.utcnow().isoformat()})
        daily_ref.child(claim_key).set(True)
        await update_player_data(interaction.user.id, data_delta=bonus)
        await interaction.response.send_message(f"🎁 Вы получили {bonus} Data!", ephemeral=False)

@bot.tree.command(name="control", description="Панель управления")
async def control_panel(interaction: discord.Interaction):
    if interaction.channel_id != ALLOWED_CHANNEL_ID:
        await interaction.response.send_message(f"❌ Разрешён только канал <#{ALLOWED_CHANNEL_ID}>.", ephemeral=True)
        return
    await interaction.response.send_message(embed=discord.Embed(title="🌐 Управление", color=0x00ffff), view=ControlButtons())

@bot.tree.command(name="extra", description="Дополнительные кнопки")
async def extra_panel(interaction: discord.Interaction):
    if interaction.channel_id != ALLOWED_CHANNEL_ID:
        await interaction.response.send_message(f"❌ Разрешён только канал <#{ALLOWED_CHANNEL_ID}>.", ephemeral=True)
        return
    await interaction.response.send_message(embed=discord.Embed(title="🛠️ Дополнительно", color=0x88ff88), view=ExtraButtons())

@bot.tree.command(name="stats", description="Топ игроков")
async def top_stats(interaction: discord.Interaction):
    top = await get_top_players(10)
    if not top:
        await interaction.response.send_message("Нет данных.", ephemeral=True)
        return
    embed = discord.Embed(title="🏆 Топ игроков", color=0xffaa44)
    desc = ""
    for idx, (uid, data_amt) in enumerate(top, 1):
        user = bot.get_user(uid)
        name = user.display_name if user else f"User {uid}"
        desc += f"{idx}. **{name}** – {data_amt} Data\n"
    embed.description = desc
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="daily", description="Ежедневный бонус")
async def daily_command(interaction: discord.Interaction):
    today = datetime.utcnow().date().isoformat()
    claim_key = f"{interaction.user.id}_{today}"
    claimed = daily_ref.child(claim_key).get()
    if claimed:
        await interaction.response.send_message("❌ Бонус уже получен сегодня.", ephemeral=True)
        return
    bonus = random.randint(500, 1500)
    commands_ref.push({"type": "personal_bonus", "user_id": str(interaction.user.id), "amount": bonus})
    daily_ref.child(claim_key).set(True)
    await update_player_data(interaction.user.id, data_delta=bonus)
    await interaction.response.send_message(f"🎁 +{bonus} Data!", ephemeral=False)

@bot.tree.command(name="give", description="[ADMIN] Выдать Data")
async def give_data(interaction: discord.Interaction, member: discord.Member, amount: int):
    if interaction.user.id not in ADMIN_IDS:
        await interaction.response.send_message("❌ Нет прав.", ephemeral=True)
        return
    commands_ref.push({"type": "personal_bonus", "user_id": str(member.id), "amount": amount})
    await update_player_data(member.id, data_delta=amount)
    await interaction.response.send_message(f"✅ Выдано {amount} Data {member.mention}.")

@bot.tree.command(name="reset", description="[ADMIN] Сброс прогресса игрока")
async def reset_player(interaction: discord.Interaction, member: discord.Member):
    if interaction.user.id not in ADMIN_IDS:
        await interaction.response.send_message("❌ Нет прав.", ephemeral=True)
        return
    key = get_player_key(member.id)
    players_ref.child(key).delete()
    commands_ref.push({"type": "reset_player", "user_id": str(member.id)})
    await interaction.response.send_message(f"🔄 Прогресс {member.mention} сброшен.")

@bot.event
async def on_ready():
    print(f'✅ Бот {bot.user} готов')
    guild = discord.Object(id=GUILD_ID)
    bot.tree.copy_global_to(guild=guild)
    synced = await bot.tree.sync(guild=guild)
    print(f"Синхронизировано {len(synced)} команд.")

if __name__ == "__main__":
    bot.run("MTQ5MTUwODMwMDI3NjMwNjEzNA.GbR_43.cA-8elWpSXtoHyJVj7RTLyBQLM6fFr2o-7eO-w")
