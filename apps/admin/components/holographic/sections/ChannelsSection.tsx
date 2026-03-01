"use client";

/**
 * Channels Section — Delivery channel configuration per domain.
 * Shows which channels (sim, whatsapp, sms) are enabled.
 */

import { useHolo } from "@/hooks/useHolographicState";
import { Phone, ArrowUpRight, Monitor, MessageSquare, Smartphone } from "lucide-react";
import Link from "next/link";

interface ChannelRow {
  id: string;
  channelType: string;
  isEnabled: boolean;
  priority: number;
}

const CHANNEL_META: Record<string, { icon: React.ReactNode; label: string; description: string }> = {
  sim: {
    icon: <Monitor size={16} />,
    label: "Simulator",
    description: "Browser-based testing",
  },
  whatsapp: {
    icon: <Smartphone size={16} />,
    label: "WhatsApp",
    description: "WhatsApp Business",
  },
  sms: {
    icon: <MessageSquare size={16} />,
    label: "SMS",
    description: "Text message delivery",
  },
};

export function ChannelsSection() {
  const { state } = useHolo();
  const domain = state.domainDetail as Record<string, any> | null;

  if (!domain) {
    return <div className="hp-section-empty">No domain data loaded.</div>;
  }

  const channels: ChannelRow[] = domain.channelConfigs || [];
  const active = channels.filter((c) => c.isEnabled);

  if (channels.length === 0) {
    return (
      <div className="hp-section-empty">
        <Phone size={24} className="hp-section-empty-icon" />
        <div>No delivery channels configured.</div>
        <div className="hp-section-empty-hint">
          Add voice, SMS, or web channels on the Settings page.
        </div>
      </div>
    );
  }

  return (
    <div className="hp-section-channels">
      <div className="hp-channel-summary">
        {active.length} of {channels.length} channel{channels.length !== 1 ? "s" : ""} active
      </div>

      <div className="hp-channel-list">
        {channels.map((ch) => {
          const meta = CHANNEL_META[ch.channelType] || {
            icon: <Phone size={16} />,
            label: ch.channelType,
            description: "Custom channel",
          };

          return (
            <div key={ch.id} className="hp-channel-card">
              <div className="hp-channel-icon">{meta.icon}</div>
              <div className="hp-channel-info">
                <div className="hp-channel-type">{meta.label}</div>
                <div className="hp-channel-hint">{meta.description}</div>
              </div>
              <span
                className={`hp-channel-badge ${
                  ch.isEnabled ? "hp-channel-badge-active" : "hp-channel-badge-inactive"
                }`}
              >
                {ch.isEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Manage link */}
      <Link href="/x/settings" className="hp-section-link">
        Manage channels
        <ArrowUpRight size={12} />
      </Link>
    </div>
  );
}
