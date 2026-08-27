"use client";

export type TabId = "lesson" | "audiobook" | "podcast";

interface LessonTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string; emoji: string }[] = [
  { id: "lesson", label: "Lesson", emoji: "📄" },
  { id: "audiobook", label: "Audiobook", emoji: "🎧" },
  { id: "podcast", label: "Podcast", emoji: "🎙️" },
];

export default function LessonTabs({ activeTab, onTabChange }: LessonTabsProps) {
  return (
    <div className="flex border-b border-card-border bg-sidebar/50 sticky top-16 z-20">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex items-center justify-center gap-1.5 px-4 py-3 border-b-2 transition-all text-sm font-medium flex-1 sm:flex-none sm:px-6 ${
            activeTab === tab.id
              ? "border-primary text-primary bg-primary-soft/30 dark:bg-primary-soft/10"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-card"
          }`}
        >
          <span className="text-base">{tab.emoji}</span>
          <span className="hidden sm:inline">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
