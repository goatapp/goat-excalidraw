export const SHORTCODES: Record<string, string> = {
  ":)": "😊",
  ":D": "😀",
  "XD": "😂",
  ":(": "😢",
  ":P": "😛",
  ";)": "😉",
  ":O": "😮",
  "<3": "❤️",
  ":fire:": "🔥",
  ":thumbsup:": "👍",
  ":thumbsdown:": "👎",
  ":100:": "💯",
  ":check:": "✅",
  ":star:": "⭐",
  ":rocket:": "🚀",
  ":eyes:": "👀",
  ":thinking:": "🤔",
  ":pray:": "🙏",
  ":tada:": "🎉",
  ":heart:": "❤️",
  ":bug:": "🐛",
  ":bulb:": "💡",
  ":zap:": "⚡",
  ":art:": "🎨",
  ":pin:": "📌",
  ":angry:": "😡",
  ":love:": "😍",
  ":goat:": "🐐",
};

const SHORTCODE_PATTERN = new RegExp(
  "(" +
    Object.keys(SHORTCODES)
      .sort((a, b) => b.length - a.length)
      .map((k) => k.replace(/([().+*?^${}|[\]\\])/g, "\\$1"))
      .join("|") +
    ")(?=\\s|$)",
  "g",
);

export function replaceEmojiShortcodes(
  text: string,
  cursorPos: number,
): { text: string; cursorOffset: number } {
  let offset = 0;
  const result = text.replace(SHORTCODE_PATTERN, (match, _shortcode, index) => {
    const emoji = SHORTCODES[match];
    if (!emoji) return match;
    if (index < cursorPos) {
      offset += emoji.length - match.length;
    }
    return emoji;
  });
  return { text: result, cursorOffset: offset };
}
