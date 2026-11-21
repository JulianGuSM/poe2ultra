import { obj, objs, str } from '@/lib/data/coerce';
import type { QuestAct, QuestRewardCategory } from './model';
import type { StaticIndex } from './static-index';

/** `questRewards.quests[]`: each quest with the reward the author picked (null when none). */
export function parseQuestRewards(raw: unknown, index?: StaticIndex): QuestAct[] {
  const acts = new Map<string, QuestAct>();
  for (const entry of objs(obj(raw)?.quests)) {
    const quest = obj(entry.quest);
    const act = str(quest?.act);
    const name = str(quest?.name);
    const reward = str(obj(entry.reward)?.bakedDescription);
    if (!quest || !act || !name || !reward) continue;

    if (!acts.has(act)) acts.set(act, { act, quests: [] });
    const choices = Array.isArray(quest.rewards) ? quest.rewards.length : 0;
    const categories: QuestRewardCategory[] = index?.questCategories(name, act, str(quest.slug)) ?? [];
    // Static quest metadata is sometimes unavailable or out of sync with the build page.
    // The reward text itself is a reliable fallback for passive skill point rewards.
    if (/\bpassive skill points?\b/i.test(reward) && !categories.includes('skill-points')) categories.push('skill-points');
    if (choices > 1 && !categories.includes('choices')) categories.push('choices');
    acts.get(act)!.quests.push({ name, area: str(quest.area), reward, isChoice: choices > 1, categories });
  }
  return [...acts.values()];
}
