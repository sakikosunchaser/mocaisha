import type { CharacterId, PublicCharacter } from "./game.js";

export const CHARACTER_CARDS: PublicCharacter[] = [
  {
    id: "emma",
    name: "樱羽艾玛",
    title: "魔女杀手",
    magicalGirlSkill: "第三轮，魔女方只能选择破解。",
    witchSkill: "魔法少女凑齐三轮破解时，可以公布自己的身份，将第三轮结果转为破坏。"
  },
  {
    id: "hiro",
    name: "二阶堂希罗",
    title: "死亡回溯",
    magicalGirlSkill: "第二轮结果作废，重新进行第二轮，仅你能查看结果。",
    witchSkill: "你可以随意说出结果，结果由你而定。"
  },
  {
    id: "anna",
    name: "夏目安安",
    title: "洗脑",
    magicalGirlSkill: "第三轮，打乱决定，你能优先查看决定并可以更改其中一个为破解后，再公布。",
    witchSkill: "既可以改为破解，也可以改为破坏，也可以不改。"
  },
  {
    id: "noah",
    name: "城崎诺亚",
    title: "液体操控",
    magicalGirlSkill: "第三轮，无需打乱决定，结果仅你能查看，若有玩家选破坏，公布该玩家。",
    witchSkill: "你可以选择公布一个无辜的人为破坏者。"
  },
  {
    id: "reia",
    name: "莲见蕾雅",
    title: "视线诱导",
    magicalGirlSkill: "第三轮所需人选减少1人，洗混决定后，由你查看并取出一个，期间玩家闭眼。",
    witchSkill: "你也可以取出两个，再放入你的决定。"
  },
  {
    id: "milia",
    name: "佐伯米莉亚",
    title: "灵魂互换",
    magicalGirlSkill: "开始侵染时，宣言发动，将自己与任意一人调换身份，也可不换，直到指认结束。",
    witchSkill: "调换身份后，你可以说出自己现在的身份。"
  },
  {
    id: "maga",
    name: "宝生玛格",
    title: "声音模仿（7人局开放）",
    magicalGirlSkill: "第三轮，任选两人交换身份卡，但胜利条件不变，可选决定随阵营变化，持续到结束。",
    witchSkill: "若选择的是魔女跟魔法少女交换，则魔女依旧可以选择破坏。"
  },
  {
    id: "naya",
    name: "黑部奈叶香",
    title: "幻视",
    magicalGirlSkill: "选择一人，仅你可以查看她的身份卡，并可以说出。",
    witchSkill: "只是口头说明，所以如实说出，还是栽赃陷害，由你来定。"
  },
  {
    id: "arisa",
    name: "紫藤亚里沙",
    title: "火焰操控",
    magicalGirlSkill: "第三轮到第五轮选择一轮，在该轮结束时，无法进行侵染。",
    witchSkill: "禁止侵染的效果无效。"
  },
  {
    id: "shirley",
    name: "橘雪莉",
    title: "怪力",
    magicalGirlSkill: "更改第二轮的结果为破解，但更改后的结果，仅你可知。",
    witchSkill: "也可以更改为破坏。"
  },
  {
    id: "hanna",
    name: "远野汉娜",
    title: "漂浮",
    magicalGirlSkill: "第三轮，你可以视作2人，并可做2次破解决定。",
    witchSkill: "你可以做出破坏决定。"
  },
  {
    id: "coco",
    name: "泽渡可可",
    title: "窥探",
    magicalGirlSkill: "第三轮，在打乱决定前，仅你可以选择至多2人的决定进行查看，之后洗混公布，期间玩家闭眼。",
    witchSkill: "你可以用自己的决定代替其中之一。"
  },
  {
    id: "meruru",
    name: "冰上梅露露",
    title: "治愈再生",
    magicalGirlSkill: "查验一个角色阵营，说出是否与自身相同。",
    witchSkill: "你可以说谎。"
  }
];

export function getCharacter(id: CharacterId): PublicCharacter {
  const character = CHARACTER_CARDS.find((entry) => entry.id === id);
  if (!character) throw new Error(`Unknown character: ${id}`);
  return character;
}
