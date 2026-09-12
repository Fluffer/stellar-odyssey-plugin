// Overlay strings in English and Simplified Chinese.
//
// English text is the key; the Chinese catalogue maps each key to its
// translation. Missing keys fall back to English, so nothing ever renders
// blank. "{name}" placeholders are filled from the second argument of t().
//
// The Chinese wording follows the game's own zh-CN locale where a term
// exists there (跃迁舱, 宇宙尘, 量子核心, 信用点, 机器人, 克隆体, 中队, 探索者,
// 星际副本, 传感器, 探测器 ...), taken from the advisor's catalogue.
//
// ES2017, no Node APIs: concatenated into the injected script and the
// extension; also loaded by the tests through module.exports.

var SO_ZH = {
  // pill and language button
  "Engine alert ON": "引擎提醒 开",
  "Engine alert OFF": "引擎提醒 关",
  "ready in {t}": "{t} 后就绪",
  "engine ready": "引擎已就绪",
  "Engine cooldown alert - click to switch on/off, drag to move": "引擎冷却提醒 — 点击开关，拖动移动",
  "Switch language": "切换语言",

  // shared
  "reset": "重置",
  "clear": "清除",
  "center": "居中",
  "route": "路线",
  "none": "无",
  "here": "此处",
  "now": "现在",
  "never": "永远",
  "idle": "空闲",
  "{d}d {h}h": "{d}天{h}小时",
  "{h}h": "{h}小时",
  "{m}m": "{m}分钟",

  // galaxy panel
  "Nearest unexplored": "最近未探索",
  "{n} cell": "{n} 格",
  "{n} cells": "{n} 格",
  "{n} ly": "{n} 光年",
  "fuel {n}": "燃料 {n}",
  "{n} unexplored in view or loaded": "视野或已加载区域内有 {n} 格未探索",
  "most unexplored: {dir} ({n})": "未探索最多的方向：{dir}（{n}）",
  "none in view or loaded": "视野或已加载区域内没有",
  "Fuel": "燃料",
  "avg jump {n}": "平均每跳 {n}",
  "~{n} jump left": "约剩 {n} 跳",
  "~{n} jumps left": "约剩 {n} 跳",
  "⚠ low": "⚠ 不足",
  "Rune": "符文",
  "on {body}": "位于 {body}",
  "expires in {t}": "{t} 后失效",
  "expired": "已失效",
  "Session": "本次",
  "{n} jump": "{n} 跳",
  "{n} jumps": "{n} 跳",
  "{n} new": "新发现 {n}",
  "dust {n}": "宇宙尘 {n}",
  "({h}/h · {j}/jump)": "（{h}/小时 · {j}/跳）",
  "XP {n}": "经验 {n}",
  "◆ Nodes ≥{q}%": "◆ 节点 ≥{q}%",
  "nearest known [{x}, {y}] ({q}%)": "已知最近 [{x}, {y}]（{q}%）",
  "{a} in view, {b} known": "视野内 {a} 个，已知 {b} 个",
  "none known yet: quality is learned from systems you visit and your bookmarks": "尚无记录：节点品质来自你到访过的星系和书签",
  "Route": "路线",
  "right-click (or Shift+click) any cell on the map to plan a route there, or use a <u>route</u> link above": "右键（或 Shift+点击）地图上任意格子规划路线，或使用上方的<u>路线</u>链接",
  "to [{x}, {y}]": "至 [{x}, {y}]",
  "→ {n} left": "→ 剩余 {n}",
  "(not enough)": "（不足）",
  "~{t} at {s}s per jump": "约 {t}，每跳 {s} 秒",
  "Marks:": "标记：",
  "discoveries": "发现",
  "points of interest": "兴趣点",
  "nodes ≥{q}%": "节点 ≥{q}%",
  "session trail": "本次轨迹",
  "mine": "我的",
  "squadron": "中队",
  "habitable": "宜居",
  "portal": "传送门",
  "dungeon": "星际副本",
  "starter": "新手",
  "rich nodes": "富矿节点",
  "Bookmarks": "书签",
  "Squadron stations": "中队空间站",
  "{n} in range": "{n} 个在范围内",
  "in range": "在范围内",
  "range {n} ly": "范围 {n} 光年",
  "… {n} more": "… 还有 {n} 个",

  // galaxy hover tag
  "Unexplored": "未探索",
  "discovered by you": "由你发现",
  "by {name}": "由 {name} 发现",
  "(squadron)": "（中队）",
  "bodies: {list}": "天体：{list}",
  "(seen {t} ago)": "（{t} 前记录）",
  "no gathering nodes": "无采集节点",
  "nodes: {list}": "节点：{list}",
  "{n} gathering body": "{n} 个采集天体",
  "{n} gathering bodies": "{n} 个采集天体",
  "no gathering bodies": "无采集天体",
  "(details unknown until visited)": "（到访后才知详情）",
  "you are here · fuel {n}": "你在此处 · 燃料 {n}",
  "{ly} ly {dir} · fuel {cost} → {left} left": "{ly} 光年 {dir} · 燃料 {cost} → 剩余 {left}",
  "not enough fuel": "燃料不足",
  "{n} jumps like this": "可跳 {n} 次这样的距离",
  "over {n} ly, needs confirm": "超过 {n} 光年，需要确认",

  // pets
  "next level in {t}": "{t} 后升级",
  "if equipped: {n} XP/h": "装备后：{n} 经验/小时",
  "+1 boost saves {t} · {c} each": "+1 增益节省 {t} · 每种 {c}",
  "✓ affordable": "✓ 可负担",
  "✗ short": "✗ 不足",
  "Pet food": "宠物食物",
  "burn {n}/day": "消耗 {n}/天",
  "{n} days": "{n} 天",
  "Boost upgrades": "增益升级",
  "capped by {r} ({n} in stock)": "受 {r} 限制（库存 {n}）",
  "pet tech skill {s}%": "宠物科技 {s}%",
  "premium +10%": "高级订阅 +10%",
  "Best boost now": "当前最佳增益",
  "{name}: +1 saves {t} for {c} of each resource": "{name}：+1 节省 {t}，每种资源 {c}",
  "No affordable boost on an equipped pet right now": "当前没有可负担的已装备宠物增益",

  // laboratory
  "Queue": "队列",
  "{a} / {b} slots": "{a} / {b} 槽位",
  "⚠ {n} idle": "⚠ {n} 个空闲",
  "all busy": "全部忙碌",
  "collect {n}": "可领取 {n}",
  "claim ready": "可领取",
  "claim in {t}": "{t} 后可领取",
  "finished": "已完成",
  "ends in {t}": "{t} 后结束",
  "Plan": "计划",
  "warp capsules on top of {s} in stock": "个跃迁舱（在库存 {s} 之上）",
  "resources cover it": "资源足够",
  "binding:": "瓶颈：",
  "covers {p}%": "覆盖 {p}%",
  "short: {list}": "缺口：{list}",
  "time {a} pipelined (claim + re-queue every 10 min) · {b} sequential": "耗时 {a}（每 10 分钟领取并重新排队）· 顺序执行 {b}",
  "critical: {name}": "关键建筑：{name}",
  "runs: {list}": "运行：{list}",

  // battling
  "Battling": "战斗",
  "next action in {t}": "下次行动 {t}",
  "offline actions expire in {t}": "离线行动 {t} 后到期",
  "Last fight": "上次战斗",
  "WIN": "胜利",
  "LOSS": "失败",
  "+{n} credits": "+{n} 信用点",
  "+{n} XP": "+{n} 经验",
  "clones {a}/{b}": "克隆体 {a}/{b}",
  "lowest HP {p}%": "最低生命 {p}%",
  "NPC hit {a}% / dodge {b}%": "NPC 命中 {a}% / 闪避 {b}%",
  "Since {t}": "自 {t} 起",
  "{n} fight": "{n} 场",
  "{n} fights": "{n} 场",
  "win rate {p}": "胜率 {p}",
  "{n} credits/h": "{n} 信用点/小时",
  "{n} XP/h": "{n} 经验/小时",
  "{n} fights/h": "{n} 场/小时",

  // gathering
  "Gathering": "采集",
  "Last haul": "上次收获",
  "droids back {a}/{b}": "机器人返回 {a}/{b}",
  "Droids": "机器人",
  "expected back {n} per action": "每次行动预计返回 {n}",
  "dodge {p}%": "闪避 {p}%",
  "{n} at the 100% cap": "{n} 个已达 100% 上限",
  "dodge mods +{n}%": "闪避词条 +{n}%",
  "maneuverability cap {n}": "机动性上限 {n}",
  "(all droids past it: a dodge mod recraft to 'Rare Resource drop chance' costs nothing)": "（所有机器人均已超过上限：把闪避词条重铸为“稀有资源掉落几率”没有损失）",
  "{n} action": "{n} 次行动",
  "{n} actions": "{n} 次行动",
  "{n} {res}/h": "{n} {res}/小时",
  "droids lost {n}": "损失机器人 {n}",

  // crafting
  "Crafting": "制造",
  "{a} of {b} blueprints craftable now with what you hold": "以当前库存可立即制造 {a} / {b} 张蓝图",
  "most blocking:": "主要缺口：",
  "{n} blueprint": "{n} 张蓝图",
  "{n} blueprints": "{n} 张蓝图",
  "up to {n} short": "最多缺 {n}",
  "farm {where}": "刷取：{where}",
  "Selected": "已选",
  "craftable": "可制造",
  "missing {list}": "缺少 {list}",

  // voyager
  "Voyager": "探索者",
  "~{a} of {b} jumps of fuel": "燃料约够 {a} / {b} 跳",
  "{t} per jump": "每跳 {t}",
  "reward bonus +{n}%": "奖励加成 +{n}%",
  "(tech +{n}%)": "（科技 +{n}%）",
  "Planned": "已规划",
  "Queued": "已排队",
  "(more than you have)": "（超出持有量）",
  "No expedition planned. Fuel refills from warp capsules; a Korin pet makes enhanced ones.": "未规划远征。燃料由跃迁舱补充；Korin 宠物可制作强化跃迁舱。",

  // player
  "Ship items": "飞船装备",
  "item level is set at craft time from the matching skill; value cap = 10 × (1.3 + crafting/100) × rarity × level": "装备等级在制造时取自对应技能；数值上限 = 10 × (1.3 + 制造/100) × 稀有度 × 等级",
  "{n} level behind {skill} {lvl}; recraft cap {cap}": "落后{skill} {lvl} 共 {n} 级；重铸上限 {cap}",
  "{n} levels behind {skill} {lvl}; recraft cap {cap}": "落后{skill} {lvl} 共 {n} 级；重铸上限 {cap}",
  "at skill level": "与技能同级",
  "dodge mod adds nothing: droids are past the cap, recraft to 'Rare Resource drop chance'": "闪避词条已无作用：机器人已超过上限，请重铸为“稀有资源掉落几率”",
  "value {v} / cap {c} ({p}%)": "数值 {v} / 上限 {c}（{p}%）",
  "mods: {list}": "词条：{list}",
  "weapon": "武器",
  "shield": "护盾",
  "engine": "引擎",
  "sensors": "传感器",
  "laser": "激光",
  "probes": "探测器",
  "battling": "战斗",
  "gathering": "采集",
  "exploring": "探索",

  // tech
  "Tech": "科技",
  "{n} quantum cores": "{n} 量子核心",
  "{n} to max every unlocked skill": "全部已解锁技能满级需 {n}",
  "next level costs 2 × (level + 1)": "下一级花费 2 × (等级 + 1)",
  "cheapest next levels:": "最便宜的下一级：",
  "Your cores buy": "你的核心可买",
  "(cheapest levels first)": "（优先最便宜的等级）",
  "Not enough cores for the cheapest next level": "核心不足以购买最便宜的下一级",
  "furthest from max:": "距满级最远：",
  "({n} cores)": "（{n} 核心）",
};

// createI18n(storageKey) -> { t, lang, setLang, toggle, langs }
//   lang comes from localStorage[storageKey], else from the browser
//   language (zh* -> "zh"), else "en".
function createI18n(storageKey) {
  var current = null;
  function detect() {
    try { var v = localStorage.getItem(storageKey); if (v === "en" || v === "zh") return v; } catch (e) {}
    try { if (typeof navigator !== "undefined" && /^zh/i.test(navigator.language || "")) return "zh"; } catch (e) {}
    return "en";
  }
  function lang() { if (!current) current = detect(); return current; }
  function setLang(l) {
    current = l === "zh" ? "zh" : "en";
    try { localStorage.setItem(storageKey, current); } catch (e) {}
    return current;
  }
  function sub(s, vars) {
    if (!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; });
  }
  function t(key, vars) {
    var s = lang() === "zh" && Object.prototype.hasOwnProperty.call(SO_ZH, key) ? SO_ZH[key] : key;
    return sub(s, vars);
  }
  return { t: t, lang: lang, setLang: setLang, toggle: function () { return setLang(lang() === "zh" ? "en" : "zh"); }, langs: ["en", "zh"] };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SO_ZH: SO_ZH, createI18n: createI18n };
}
