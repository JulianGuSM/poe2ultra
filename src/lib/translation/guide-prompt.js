/** Full-guide prompts live only here. Do not append selection templates or terminology rules. */
export const GUIDE_SYSTEM_PROMPT = `你是《流放之路 2》（Path of Exile 2 / POE2）的游戏本地化与 Build 攻略翻译专家。

你需要结合 ARPG 的技能、装备、天赋、属性词缀、防御机制、资源恢复和构筑联动理解原文。忠实翻译作者的攻略，不替作者纠正玩法，不新增原文没有的机制或效果，不把 POE1 或其他游戏的知识当作 POE2 的已知事实。
简中和繁中是两套独立本地化：分别优先使用提供的 cn / tw 术语、poe2db 来源和上下文，不用字形转换替代另一地区的译名。没有可靠译名的专有名称保留英文，不根据字面意义编造物品、技能或天赋名。
根据句子判断数字含义：涉及补丁、更新、加强、削弱时，in 0.5 通常是“在 0.5 版本中”，不是属性值；有秒数或倍率等单位时则按原文单位理解。保留版本号 0.5 / 0.5.5，不扩写或猜测版本内容。6K Energy Shield 中的 6K 是带 K 缩写的数值，保留 6K，不擅自换算成 6000；百分比、符号、区间和数值单位也原样保留。`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translations'],
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'cn', 'tw', 'widget_labels'],
        properties: {
          id: { type: 'integer' },
          cn: { type: 'string' },
          tw: { type: 'string' },
          widget_labels: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['index', 'cn', 'tw'],
              properties: { index: { type: 'integer' }, cn: { type: 'string' }, tw: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

/** User content includes the exact response contract to complement API JSON mode. */
export function buildGuidePrompt(segments, context = {}) {
  return {
    systemText: GUIDE_SYSTEM_PROMPT,
    userText: JSON.stringify({
      segments,
      terminology: (context.terms ?? []).map(term => ({ en: term.en || term.matched || '', cn: term.zh_cn || '', tw: term.zh_tw || '' })),
      poe2db: context.direct ?? [],
      sources: context.sources ?? [],
      output_format: {
        type: 'json_object',
        rules: [
          'Return exactly one JSON object and no markdown or surrounding prose.',
          'The root object must contain exactly one property: translations.',
          'translations must contain exactly one row per input segment, in the same order.',
          'Copy each segment id exactly as a JSON integer. Each row must contain exactly id, cn, tw, and widget_labels.',
          'cn and tw must each be complete translated strings for the full segment, not arrays or per-fragment translations.',
          'widget_labels must contain one entry per input entity, in the same order, copying each index exactly. Translate each label independently for cn and tw, and use that exact translated name inside the corresponding full cn/tw sentence so its icon can be positioned correctly.',
          'When there are no input entities, widget_labels must be an empty array. Do not add cn_parts, tw_parts, widgetIndices, comments, or any other fields.',
        ],
        schema: OUTPUT_SCHEMA,
        example: { translations: segments.map(({ id, entities = [] }) => ({ id, cn: '完整简中译文', tw: '完整繁中譯文',
          widget_labels: entities.map(({ index }) => ({ index, cn: '对应简中实体名', tw: '對應繁中實體名' })) })) },
      },
    }),
  };
}
