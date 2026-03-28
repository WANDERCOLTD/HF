export function SectionHeader({ title, icon: Icon, subtitle }: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  subtitle?: string;
}) {
  return (
    <div className={subtitle ? 'hf-flex-col hf-mb-md hf-section-divider' : 'hf-flex hf-gap-sm hf-items-center hf-mb-md hf-section-divider'}>
      <div className="hf-flex hf-gap-sm hf-items-center">
        <Icon size={18} className="hf-text-muted" />
        <h2 className="hf-section-title hf-mb-0">{title}</h2>
      </div>
      {subtitle && (
        <p className="hf-text-xs hf-text-muted hf-mt-xs hf-mb-0">{subtitle}</p>
      )}
    </div>
  );
}
