import type { Locale } from '@/lib/translation/plan';

/** Extension-owned labels only. Guide prose and game data still use the translation cache. */
const LABELS: Record<string, [cn: string, tw: string]> = {
  'Overview': ['总览', '總覽'],
  'Skills': ['技能', '技能'],
  'Gear': ['装备', '裝備'],
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
  'Strength': ['力量', '力量'],
  'Dexterity': ['敏捷', '敏捷'],
  'Intelligence': ['智慧', '智慧'],
  'Corrupted': ['已腐化', '已腐化'],
  'Modifier values are ranges': ['词缀数值为范围值', '詞綴數值為範圍值'],
  'Close details': ['关闭详情', '關閉詳情'],
  'Active Skills': ['主动技能', '主動技能'],
  'Gem Priority': ['宝石优先顺序', '寶石優先順序'],
  "Author's Notes": ['作者备注', '作者備註'],
};

export function uiText(label: string, locale: Locale): string {
  const translation = LABELS[label];
  return locale === 'en' || !translation ? label : translation[locale === 'cn' ? 0 : 1];
}

export function uiRequirements(requirements: string, locale: Locale): string {
  if (locale === 'en') return `Requires: ${requirements}`;
  const localized = requirements.replace(/\b(Level|Strength|Dexterity|Intelligence)\b/g, label => uiText(label, locale));
  return `${uiText('Requires', locale)}：${localized}`;
}
