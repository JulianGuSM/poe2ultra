import type { Locale } from '@/lib/translation/plan';

/** Extension-owned labels only. Guide prose and game data still use the translation cache. */
const LABELS: Record<string, [cn: string, tw: string]> = {
  'Overview': ['总览', '總覽'],
  'Build Overview': ['构筑概览', '構築概覽'],
  'How it Plays': ['玩法详情', '玩法詳情'],
  'How it Works': ['机制原理', '機制原理'],
  'Changelog': ['更新日志', '更新日誌'],
  'Change Log': ['更新日志', '更新日誌'],
  'Strengths and Weaknesses': ['优势与劣势', '優勢與劣勢'],
  'Strengths': ['优势', '優勢'],
  'Weaknesses': ['劣势', '劣勢'],
  'Skills': ['技能', '技能'],
  'Gear': ['装备', '裝備'],
  'Gear Priority': ['装备优先级', '裝備優先級'],
  'Passives': ['天赋', '天賦'],
  'Atlas Tree': ['异界天赋树', '輿圖天賦樹'],
  'Progression': ['升级路线', '升級路線'],
  'Build sections': ['攻略栏目', '攻略欄目'],
  'Additional Effects From Quality': ['品质附加效果', '品質附加效果'],
  'Skill Gem': ['技能宝石', '技能寶石'],
  'Support Gem': ['辅助宝石', '輔助寶石'],
  'Support Gems': ['辅助宝石', '輔助寶石'],
  'Grants Skill': ['赋予技能', '賦予技能'],
  'Sockets': ['插槽', '插槽'],
  'Keystone': ['核心天赋', '核心天賦'],
  'Notable': ['显著天赋', '顯著天賦'],
  'Ascendancy': ['升华天赋', '昇華天賦'],
  'Passive': ['天赋', '天賦'],
  'Jewel Socket': ['珠宝插槽', '珠寶插槽'],
  'Socketable': ['可镶嵌物', '可鑲嵌物'],
  'Requires': ['需求', '需求'],
  'Level': ['等级', '等級'],
  'Cast Time': ['施法时间', '施法時間'],
  'Mana Cost': ['魔力消耗', '魔力消耗'],
  'Mana Range': ['魔力消耗', '魔力消耗'],
  'Critical Strike Chance': ['暴击几率', '暴擊機率'],
  'Reservation': ['保留', '保留'],
  'Strength': ['力量', '力量'],
  'Dexterity': ['敏捷', '敏捷'],
  'Intelligence': ['智慧', '智慧'],
  'Str': ['力量', '力量'],
  'Dex': ['敏捷', '敏捷'],
  'Int': ['智慧', '智慧'],
  'Corrupted': ['已腐化', '已腐化'],
  'Modifier values are ranges': ['词缀数值为范围值', '詞綴數值為範圍值'],
  'Close details': ['关闭详情', '關閉詳情'],
  'Active Skills': ['主动技能', '主動技能'],
  'Gem Priority': ['宝石优先级', '寶石優先級'],
  'Passive Priority': ['天赋优先级', '天賦優先級'],
  'Helmet': ['头盔', '頭盔'],
  'Body Armour': ['护甲', '胸甲'],
  'Gloves': ['手套', '手套'],
  'Boots': ['鞋子', '鞋子'],
  'Weapon': ['武器', '武器'],
  'Offhand': ['副手', '副手'],
  'Amulet': ['项链', '項鍊'],
  'Ring 1': ['戒指 1', '戒指 1'],
  'Ring 2': ['戒指 2', '戒指 2'],
  'Ring 3': ['戒指 3', '戒指 3'],
  'Belt': ['腰带', '腰帶'],
  'Life Flask': ['生命药剂', '生命藥劑'],
  'Mana Flask': ['魔力药剂', '魔力藥劑'],
  'Charm 1': ['护符 1', '護符 1'],
  'Charm 2': ['护符 2', '護符 2'],
  'Charm 3': ['护符 3', '護符 3'],
  'Notes': ['备注', '備註'],
  "Author's Notes": ['作者备注', '作者備註'],
  'Quest Rewards': ['任务奖励', '任務獎勵'],
  'Choices': ['可选奖励', '可選獎勵'],
  'Skill Points': ['技能点', '技能點'],
  'Character Upgrades': ['角色升级', '角色升級'],
  'All': ['全部', '全部'],
};

export function uiText(label: string, locale: Locale): string {
  return uiTextIfKnown(label, locale) ?? label;
}

/** Localize a fixed UI label without sending it through guide translation; null means it is author text. */
export function uiTextIfKnown(label: string, locale: Locale): string | null {
  const key = Object.keys(LABELS).find((candidate) => candidate.toLowerCase() === label.trim().toLowerCase());
  if (!key) return null;
  const translation = LABELS[key];
  return locale === 'en' ? key : translation[locale === 'cn' ? 0 : 1];
}

export function uiRequirements(requirements: string, locale: Locale): string {
  if (locale === 'en') return `Requires: ${requirements}`;
  const localized = requirements.replace(/\b(Level|Strength|Dexterity|Intelligence)\b/g, label => uiText(label, locale));
  return `${uiText('Requires', locale)}：${localized}`;
}
