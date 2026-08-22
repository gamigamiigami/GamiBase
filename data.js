// ここにサイトやツールを追加していくよ！
// category: "game" | "tool" | "useful" | "event" | "other"
// zip: { url: "ファイルパス", label: "ダウンロード名" } を付けるとダウンロードボタンが出るよ
const SITE_DATA = [
  // ==== サンプル（自由に書き換え・削除してOK） ====
  {
    category: "game",
    title: "サンプル教育ゲーム",
    description: "ここに紹介文を書いてね。ワクワクする一言でOK！",
    url: "https://example.com",
    emoji: "🎮",
    tags: ["算数", "小学生"],
  },
  {
    category: "tool",
    title: "サンプル教育ツール",
    description: "授業や学習に使えるツールの説明文。",
    url: "https://example.com",
    emoji: "📚",
    tags: ["授業"],
  },
  {
    category: "useful",
    title: "サンプル便利ツール",
    description: "日常のちょっとした作業をラクにするツール。",
    url: "https://example.com",
    emoji: "🛠️",
    tags: ["時短"],
  },
  {
    category: "event",
    title: "サンプルイベント",
    description: "開催予定・開催済みのイベント情報。",
    url: "https://example.com",
    emoji: "🎉",
    tags: ["2026"],
  },
  {
    category: "other",
    title: "サンプルその他",
    description: "カテゴリに迷ったらここへ！",
    url: "https://example.com",
    emoji: "✨",
    tags: [],
    zip: { url: "./downloads/sample.zip", label: "sample.zip をダウンロード" },
  },
];

const CATEGORY_META = {
  game:   { label: "教育ゲーム", emoji: "🎮", color: "#FF6FA5" },
  tool:   { label: "教育ツール", emoji: "📚", color: "#5EC8FF" },
  useful: { label: "便利ツール", emoji: "🛠️", color: "#7CE38B" },
  event:  { label: "イベント",   emoji: "🎉", color: "#FFC24B" },
  other:  { label: "その他",     emoji: "✨", color: "#C79CFF" },
};
