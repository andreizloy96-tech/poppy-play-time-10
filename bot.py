import discord
from discord.ext import commands
from discord import app_commands
import firebase_admin
from firebase_admin import credentials, db
import random
import os
from datetime import datetime

# ---------- ТОКЕН ИЗ ПЕРЕМЕННОЙ ОКРУЖЕНИЯ ----------
BOT_TOKEN = os.getenv('BOT_TOKEN')
if not BOT_TOKEN:
    raise ValueError("❌ BOT_TOKEN не задан в переменных окружения!")

# ---------- ПОДКЛЮЧЕНИЕ К FIREBASE ----------
try:
    cred = credentials.Certificate("serviceAccountKey.json")
except FileNotFoundError:
    # Если файла нет — пробуем взять из переменной окружения (для безопасности)
    firebase_creds_str = os.getenv('FIREBASE_CREDS')
    if firebase_creds_str:
        import json
        firebase_creds = json.loads(firebase_creds_str)
        cred = credentials.Certificate(firebase_creds)
    else:
        raise FileNotFoundError("Нет serviceAccountKey.json и нет FIREBASE_CREDS в окружении")

firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://nexusclicker-11c93-default-rtdb.firebaseio.com'
})

commands_ref = db.reference('/discord_commands')
players_ref = db.reference('/players')
daily_ref = db.reference('/daily_claims')

# ---------- НАСТРОЙКА БОТА ----------
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

# ⚠️ ЗАМЕНИТЕ НА ВАШИ ДАННЫЕ (ID канала и сервера)
ALLOWED_CHANNEL_ID = 1491811274097430538   # ID канала, где работают команды
GUILD_ID = 1194999947955814452              # ID вашего Discord-сервера
ADMIN_IDS = [1187805883149865053]           # Ваш Discord ID (администратор)

# ---------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ----------
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

# ---------- КНОПКИ (ГЛАВНАЯ ПАНЕЛЬ) ----------
class ControlButtons(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="⚡ Оверклок", style=discord.ButtonStyle.primary)
    async def overclock_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.channel_id != ALLOWED_CHANNEL_ID:
            await interaction.response.send_message("❌ Команды разрешены только в специальном канале.", ephemeral=True)
            return
        commands_ref.push({
            "type": "overclock",
            "issued_by": str(interaction.user),
            "timestamp": datetime.utcnow().isoformat()
        })
        await interaction.response.send_message("⚡ **ОВЕРКЛОК АКТИВИРОВАН!** x2 дохода на 60 сек.", ephemeral=False)

    @discord.ui.button(label="📦 Выпадение данных", style=discord.ButtonStyle.success)
    async def datadrop_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.channel_id != ALLOWED_CHANNEL_ID:
            await interaction.response.send_message("❌ Команды разрешены только в специальном канале.", ephemeral=True)
            return
        commands_ref.push({
            "type": "data_drop",
            "issued_by": str(interaction.user),
            "timestamp": datetime.utcnow().isoformat()
        })
        await interaction.response.send_message("📦 **ВЫПАДЕНИЕ ДАННЫХ!** В игре появился сундук с бонусом.", ephemeral=False)

    @discord.ui.button(label="🛡️ Файервол", style=discord.ButtonStyle.danger)
    async def firewall_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.channel_id != ALLOWED_CHANNEL_ID:
            await interaction.response.send_message("❌ Команды разрешены только в специальном канале.", ephemeral=True)
            return
        commands_ref.push({
            "type": "firewall",
            "issued_by": str(interaction.user),
            "timestamp": datetime.utcnow().isoformat()
        })
        await interaction.response.send_message("🛡️ **ФАЙЕРВОЛ АКТИВИРОВАН!** -50% дохода на 45 сек.", ephemeral=False)

class ExtraButtons(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="📊 Моя статистика", style=discord.ButtonStyle.secondary)
    async def my_stats_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        key = get_player_key(interaction.user.id)
        data = players_ref.child(key).get() or {}
        embed = discord.Embed(title="📊 Ваша статистика", color=0x00ffff)
        embed.add_field(name="📦 Накоплено Data", value=data.get('data', 0), inline=True)
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
        commands_ref.push({
            "type": "personal_bonus",
            "user_id": str(interaction.user.id),
            "amount": bonus,
            "timestamp": datetime.utcnow().isoformat()
        })
        daily_ref.child(claim_key).set(True)
        await update_player_data(interaction.user.id, data_delta=bonus)
        await interaction.response.send_message(f"🎁 Вы получили ежедневный бонус **{bonus} Data**!", ephemeral=False)

# ---------- СЛЕШ-КОМАНДЫ ----------
@bot.tree.command(name="control", description="Панель управления Нексусом (кнопки)")
async def control_panel(interaction: discord.Interaction):
    if interaction.channel_id != ALLOWED_CHANNEL_ID:
        await interaction.response.send_message(f"❌ Команда разрешена только в канале <#{ALLOWED_CHANNEL_ID}>.", ephemeral=True)
        return
    embed = discord.Embed(title="🌐 ПАНЕЛЬ УПРАВЛЕНИЯ НЕКСУСОМ", color=0x00ffff,
                          description="⚡ **Оверклок** – x2 доход на 60с\n📦 **Выпадение данных** – сундук с бонусом\n🛡️ **Файервол** – глобальный дебафф -50% дохода 45с")
    await interaction.response.send_message(embed=embed, view=ControlButtons())

@bot.tree.command(name="extra", description="Дополнительные кнопки (статистика, бонусы)")
async def extra_panel(interaction: discord.Interaction):
    if interaction.channel_id != ALLOWED_CHANNEL_ID:
        await interaction.response.send_message(f"❌ Команда разрешена только в канале <#{ALLOWED_CHANNEL_ID}>.", ephemeral=True)
        return
    embed = discord.Embed(title="🛠️ Дополнительные возможности", color=0x88ff88,
                          description="• **Моя статистика** – посмотреть ранг и накопления\n• **Ежедневный бонус** – получите случайную сумму Data раз в день")
    await interaction.response.send_message(embed=embed, view=ExtraButtons())

@bot.tree.command(name="stats", description="Показать топ игроков по Data")
async def top_stats(interaction: discord.Interaction):
    top = await get_top_players(10)
    if not top:
        await interaction.response.send_message("Пока нет данных об игроках.", ephemeral=True)
        return
    embed = discord.Embed(title="🏆 Топ игроков Nexus Clicker", color=0xffaa44)
    desc = ""
    for idx, (uid, data_amt) in enumerate(top, 1):
        user = bot.get_user(uid)
        name = user.display_name if user else f"User {uid}"
        desc += f"{idx}. **{name}** – {data_amt} Data\n"
    embed.description = desc
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="daily", description="Получить ежедневный бонус Data")
async def daily_command(interaction: discord.Interaction):
    today = datetime.utcnow().date().isoformat()
    claim_key = f"{interaction.user.id}_{today}"
    claimed = daily_ref.child(claim_key).get()
    if claimed:
        await interaction.response.send_message("❌ Вы уже получали бонус сегодня!", ephemeral=True)
        return
    bonus = random.randint(500, 1500)
    commands_ref.push({
        "type": "personal_bonus",
        "user_id": str(interaction.user.id),
        "amount": bonus
    })
    daily_ref.child(claim_key).set(True)
    await update_player_data(interaction.user.id, data_delta=bonus)
    await interaction.response.send_message(f"🎁 Вы получили ежедневный бонус **{bonus} Data**!", ephemeral=False)

@bot.tree.command(name="give", description="[ADMIN] Выдать Data игроку")
async def give_data(interaction: discord.Interaction, member: discord.Member, amount: int):
    if interaction.user.id not in ADMIN_IDS:
        await interaction.response.send_message("❌ Недостаточно прав.", ephemeral=True)
        return
    commands_ref.push({
        "type": "personal_bonus",
        "user_id": str(member.id),
        "amount": amount,
        "issued_by": str(interaction.user)
    })
    await update_player_data(member.id, data_delta=amount)
    await interaction.response.send_message(f"✅ Выдано {amount} Data игроку {member.mention}.")

@bot.tree.command(name="reset", description="[ADMIN] Сбросить прогресс игрока")
async def reset_player(interaction: discord.Interaction, member: discord.Member):
    if interaction.user.id not in ADMIN_IDS:
        await interaction.response.send_message("❌ Недостаточно прав.", ephemeral=True)
        return
    key = get_player_key(member.id)
    players_ref.child(key).delete()
    commands_ref.push({
        "type": "reset_player",
        "user_id": str(member.id)
    })
    await interaction.response.send_message(f"🔄 Прогресс игрока {member.mention} сброшен.")

# ---------- ЗАПУСК БОТА ----------
@bot.event
async def on_ready():
    print(f'✅ Бот запущен как {bot.user}')
    try:
        guild = discord.Object(id=GUILD_ID)
        bot.tree.copy_global_to(guild=guild)
        synced = await bot.tree.sync(guild=guild)
        print(f"Синхронизировано {len(synced)} команд для сервера {GUILD_ID}.")
    except Exception as e:
        print(f"Ошибка синхронизации: {e}")

if __name__ == "__main__":
    bot.run("BOT_TOKEN")
