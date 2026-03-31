"use client";

import { useEffect, useState, Suspense } from "react";
import { TrendingUp, Target, Phone, BookOpen, Lightbulb, MessageSquare } from "lucide-react";
import Link from "next/link";
import StudentOnboarding from "@/components/student/StudentOnboarding";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";

interface TopicEntry {
  topic: string;
  lastMentioned: string;
}

interface ProgressData {
  profile: {
    parameterValues: Record<string, number>;
    lastUpdated: string | null;
    callsAnalyzed: number;
  } | null;
  goals: {
    id: string;
    name: string;
    type: string;
    progress: number;
    description: string | null;
  }[];
  totalCalls: number;
  classroom: string | null;
  classrooms?: Array<{ id: string; name: string; teacher: string | null }>;
  domain: string | null;
  teacherName: string | null;
  institutionName: string | null;
  institutionLogo: string | null;
  welcomeMessage: string | null;
  topTopics: TopicEntry[];
  topicCount: number;
  keyFactCount: number;
}

export default function StudentProgressPage() {
  return (
    <Suspense fallback={<div className="p-6"><div className="animate-pulse h-8 w-48 rounded bg-[var(--surface-secondary)]" /></div>}>
      <StudentProgressContent />
    </Suspense>
  );
}

function StudentProgressContent() {
  const { isAdmin, hasSelection, buildUrl } = useStudentCallerId();
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSurveyBanner, setShowSurveyBanner] = useState(false);
  const [surveyBannerMsg, setSurveyBannerMsg] = useState<string>('');

  useEffect(() => {
    if (isAdmin && !hasSelection) { setLoading(false); return; }
    fetch(buildUrl("/api/student/progress"))
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setData(d);
          // Show onboarding for first-run students (not for admin preview)
          if (!isAdmin) {
            const onboardingSeen = localStorage.getItem("onboarding-seen");
            if (d.totalCalls === 0 && !onboardingSeen) {
              setShowOnboarding(true);
            }
            // Check if post-survey banner should show (triggerAfterCalls+ calls, not yet submitted)
            if (d.totalCalls > 0) {
              Promise.all([
                fetch(buildUrl("/api/student/survey?scope=POST_SURVEY")).then((r) => r.json()),
                fetch(buildUrl("/api/student/survey-config")).then((r) => r.json()).catch(() => null),
              ]).then(([surveyData, configData]) => {
                const threshold = configData?.ok
                  ? configData.offboarding?.triggerAfterCalls ?? 5
                  : 5;
                if (d.totalCalls >= threshold && !surveyData?.submitted_at) {
                  const defaultMsg = `You\u2019ve completed ${d.totalCalls} practice sessions! Tell us how it went \u2014 it takes 30 seconds.`;
                  const bannerTpl = configData?.offboarding?.bannerMessage;
                  setSurveyBannerMsg(
                    bannerTpl ? bannerTpl.replace(/\{n\}/g, String(d.totalCalls)) : defaultMsg,
                  );
                  setShowSurveyBanner(true);
                }
              }).catch(() => {});
            }
          }
        }
      })
      .finally(() => setLoading(false));
  }, [isAdmin, hasSelection, buildUrl]);

  if (isAdmin && !hasSelection) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Select a learner above to view their progress.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-[var(--surface-secondary)]" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-[var(--surface-secondary)]" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--text-muted)" }}>Unable to load progress data.</p>
      </div>
    );
  }

  // Show onboarding wizard for first-run students
  if (showOnboarding) {
    return (
      <StudentOnboarding
        goals={data.goals}
        teacherName={data.teacherName}
        institutionName={data.institutionName}
        institutionLogo={data.institutionLogo}
        welcomeMessage={data.welcomeMessage}
        domain={data.domain}
        onComplete={() => setShowOnboarding(false)}
      />
    );
  }

  const paramEntries = data.profile
    ? Object.entries(data.profile.parameterValues).sort(([, a], [, b]) => b - a)
    : [];

  return (
    <div data-tour="welcome" className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-1 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
        My Progress
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", padding: "2px 6px", borderRadius: 4, background: "color-mix(in srgb, var(--status-success-text) 15%, transparent)", color: "var(--status-success-text)", border: "1px solid color-mix(in srgb, var(--status-success-text) 25%, transparent)" }}>GF</span>
      </h1>
      {data.classroom && (
        <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
          {data.classroom}{data.domain ? ` \u2014 ${data.domain}` : ""}
        </p>
      )}

      {/* Post-survey banner */}
      {showSurveyBanner && (
        <div className="hf-banner hf-banner-info" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <MessageSquare size={18} />
          <span style={{ flex: 1 }}>
            {surveyBannerMsg}
          </span>
          <Link href="/x/student/survey/post" className="hf-btn hf-btn-primary" style={{ whiteSpace: "nowrap" }}>
            Share Feedback &rarr;
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        <StatCard icon={Phone} label="Total Calls" value={data.totalCalls} />
        <StatCard icon={Target} label="Active Goals" value={data.goals.length} />
        <StatCard
          icon={TrendingUp}
          label="Calls Analyzed"
          value={data.profile?.callsAnalyzed ?? 0}
        />
        <StatCard icon={BookOpen} label="Topics Covered" value={data.topicCount} />
        <StatCard icon={Lightbulb} label="Key Facts" value={data.keyFactCount} />
      </div>

      {/* Goals */}
      {data.goals.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
            Active Goals
          </h2>
          <div className="space-y-3">
            {data.goals.map((goal) => (
              <div
                key={goal.id}
                className="rounded-lg border p-4"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--surface-primary)",
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
                    {goal.name}
                  </span>
                  <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                    {Math.round(goal.progress * 100)}%
                  </span>
                </div>
                {goal.description && (
                  <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
                    {goal.description}
                  </p>
                )}
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: "var(--surface-secondary)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.round(goal.progress * 100)}%`,
                      background: "var(--accent-primary)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Topics Covered */}
      {data.topTopics.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
            Topics Covered
          </h2>
          <div
            className="rounded-lg border p-4"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--surface-primary)",
            }}
          >
            <div className="flex flex-wrap gap-2">
              {data.topTopics.map((t) => (
                <div
                  key={t.topic}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
                  style={{
                    background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)",
                  }}
                >
                  <BookOpen size={12} style={{ color: "var(--accent-primary)" }} />
                  <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                    {t.topic}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {formatTopicDate(t.lastMentioned)}
                  </span>
                </div>
              ))}
            </div>
            {data.topicCount > data.topTopics.length && (
              <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
                +{data.topicCount - data.topTopics.length} more topics discussed across your calls
              </p>
            )}
          </div>
        </section>
      )}

      {/* Personality Profile */}
      {paramEntries.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
            Learning Profile
          </h2>
          <div
            className="rounded-lg border p-4"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--surface-primary)",
            }}
          >
            <div className="space-y-3">
              {paramEntries.map(([key, value]) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      {key.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {typeof value === "number" ? value.toFixed(2) : String(value)}
                    </span>
                  </div>
                  <div
                    className="h-1 rounded-full overflow-hidden"
                    style={{ background: "var(--surface-secondary)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, Number(value) * 100))}%`,
                        background: "var(--accent-primary)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {data.profile?.lastUpdated && (
              <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
                Last updated: {new Date(data.profile.lastUpdated).toLocaleDateString()}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function formatTopicDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--surface-primary)",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} style={{ color: "var(--text-muted)" }} />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      </div>
      <span className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
    </div>
  );
}
