'use client';

import React, { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { SessionProvider } from 'next-auth/react';
import SimpleSidebarNav from '@/src/components/shared/SimpleSidebarNav';
import { TopBar } from '@/components/shared/TopBar';
import { EntityProvider, ChatProvider, ThemeProvider, PaletteProvider, useChatContext, themeInitScript, MasqueradeProvider, BrandingProvider, useBranding, ViewModeProvider, StepFlowProvider, DomainScopeProvider } from '@/contexts';
import { TerminologyProvider } from '@/contexts/TerminologyContext';
import { GuidanceProvider } from '@/contexts/GuidanceContext';
import { GlobalAssistantProvider } from '@/contexts/AssistantContext';
import { ChatPanel } from '@/components/chat';
import { GlobalAssistant } from '@/components/shared/GlobalAssistant';
import { ContentJobQueueProvider, ContentJobQueue } from '@/components/shared/ContentJobQueue';
import EnvironmentBanner from '@/components/shared/EnvironmentBanner';
import DynamicFavicon from '@/components/shared/DynamicFavicon';
import { TourOverlay } from '@/src/components/shared/TourOverlay';
import { ErrorCaptureProvider } from '@/contexts/ErrorCaptureContext';
import { BugReportButton } from '@/components/shared/BugReportButton';
import { StatusBar } from '@/components/shared/StatusBar';
import { useResponsive } from '@/hooks/useResponsive';
import { Menu, PanelLeft } from 'lucide-react';
import './globals.css';

/** Error boundary to catch page-level crashes while keeping floating widgets alive */
class PageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, textAlign: "center" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "var(--text-primary)" }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--border-default)",
              background: "var(--surface-primary)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Try again
          </button>
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 12 }}>
            Use the Bug Report button to send this error to Claude for diagnosis.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

const SIDEBAR_WIDTH_KEY = 'hf.sidebar.width';
const DEFAULT_SIDEBAR_WIDTH = 180;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 320;
const COLLAPSED_WIDTH = 56;


function LayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);
  const { isOpen, chatLayout } = useChatContext();
  const { isMobile, showDesktop } = useResponsive();
  const { branding } = useBranding();

  // Embed mode - render without sidebar/chrome (for iframes)
  const isEmbed = searchParams.get('embed') === '1';

  // Auth pages (login, etc.) - render without sidebar
  const isAuthPage = pathname?.startsWith('/login');

  // Sim pages - render without sidebar/chrome (standalone WhatsApp-style app)
  const isSimPage = pathname?.startsWith('/x/sim');

  // Demo player — auto-collapse sidebar to give demos full width
  const isDemoPlayer = /^\/x\/demos\/[^/]+$/.test(pathname || '');
  const preDemoCollapsedRef = useRef<boolean | null>(null);
  const demoForcedRef = useRef(false);

  // persist sidebar state
  const storageKey = 'hf.sidebar.collapsed';

  useEffect(() => {
    const v = window.localStorage.getItem(storageKey);
    if (v === '1') setCollapsed(true);
    else setCollapsed(false);

    // Load saved width
    const savedWidth = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (savedWidth) {
      const parsed = parseInt(savedWidth, 10);
      if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
        setSidebarWidth(parsed);
      }
    }
  }, [storageKey]);

  useEffect(() => {
    // Skip persisting when demo auto-forced the collapse
    if (demoForcedRef.current) return;
    window.localStorage.setItem(storageKey, collapsed ? '1' : '0');
  }, [collapsed, storageKey]);

  // Auto-collapse when entering a demo, restore when leaving
  useEffect(() => {
    if (isDemoPlayer && preDemoCollapsedRef.current === null) {
      preDemoCollapsedRef.current = collapsed;
      demoForcedRef.current = true;
      setCollapsed(true);
    } else if (!isDemoPlayer && preDemoCollapsedRef.current !== null) {
      demoForcedRef.current = false;
      setCollapsed(preDemoCollapsedRef.current);
      preDemoCollapsedRef.current = null;
    }
  }, [isDemoPlayer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save width when it changes
  useEffect(() => {
    if (!collapsed) {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
    }
  }, [sidebarWidth, collapsed]);

  // Global Cmd+G → navigate to Get Started
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        router.push('/x/get-started-v4');
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [router]);

  // Resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Calculate main content style based on chat layout
  const getMainStyle = (): React.CSSProperties => {
    if (!isOpen) return {};

    switch (chatLayout) {
      case 'horizontal':
        return { paddingBottom: '320px' };
      case 'popout':
        return {};
      case 'vertical':
      default:
        return {};
    }
  };

  // Sidebar width config
  const effectiveSidebarWidth = collapsed ? COLLAPSED_WIDTH : sidebarWidth;

  const layoutHeight = '100vh';

  // Auth pages, embed mode, and sim pages render without sidebar/chrome
  if (isAuthPage || isEmbed || isSimPage) {
    return <>{children}</>;
  }

  // Mobile layout (< 768px, not forced desktop mode)
  if (isMobile && !showDesktop) {
    return (
      <div className="flex flex-col" style={{ height: layoutHeight }}>
        {/* Mobile header with hamburger */}
        <header
          className="h-14 border-b flex items-center px-4 gap-3 flex-shrink-0"
          style={{
            borderColor: 'var(--border-default)',
            background: 'var(--surface-primary)',
          }}
        >
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2.5 rounded-md hover:bg-[var(--hover-bg)] transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" style={{ color: 'var(--text-primary)' }} />
          </button>
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.name} style={{ height: 28 }} />
          ) : (
            <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
              {branding.name}
            </span>
          )}
        </header>

        {/* Mobile sidebar overlay */}
        {mobileMenuOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setMobileMenuOpen(false)}
            />
            {/* Sidebar */}
            <aside
              className="fixed top-0 left-0 h-full w-64 z-50 shadow-xl"
              style={{
                background: 'var(--surface-primary)',
                borderRight: '1px solid var(--border-default)',
              }}
            >
              <div className="h-full px-2 py-4">
                <SimpleSidebarNav
                  collapsed={false}
                  onNavigate={() => setMobileMenuOpen(false)}
                />
              </div>
            </aside>
          </>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-auto min-h-0">
          <div className="px-4 py-6">
            {children}
          </div>
        </main>

        <StatusBar />
      </div>
    );
  }

  // Desktop layout (current grid)
  return (
    <div style={{ height: layoutHeight, display: 'flex', flexDirection: 'column' }}>
      <div
        className="grid relative"
        style={{
          flex: 1,
          minHeight: 0,
          gridTemplateColumns: `${effectiveSidebarWidth}px 1fr`,
          gridTemplateRows: '1fr',
          transition: isResizing ? 'none' : 'grid-template-columns 200ms ease-out',
        }}
      >
        {/* Sidebar */}
        <aside
          className="relative h-full overflow-hidden"
          style={{
            background: 'var(--surface-primary)',
            borderRight: '1px solid var(--border-subtle)',
          }}
        >
          <div className="h-full px-2 py-4">
            <SimpleSidebarNav
              collapsed={collapsed}
              onToggle={() => setCollapsed((v) => !v)}
            />
          </div>
          {/* Resize handle - thin line, wider hit target */}
          {!collapsed && (
            <div
              ref={resizeRef}
              onMouseDown={handleMouseDown}
              className="absolute top-0 right-0 w-3 h-full cursor-col-resize flex justify-end"
              style={{ zIndex: 10 }}
              title="Drag to resize"
            >
              <div
                className={
                  "w-px h-full transition-all " +
                  (isResizing ? "w-0.5 bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600 hover:w-0.5 hover:bg-indigo-400")
                }
              />
            </div>
          )}
        </aside>

        {/* Main content */}
        <div className="h-full min-w-0 min-h-0 flex flex-col">
          <TopBar />
          <main
            className="flex-1 overflow-auto min-h-0 transition-all duration-200"
            style={getMainStyle()}
          >
            <div className="py-6 flex flex-col h-full min-h-0" style={{ paddingLeft: 32, paddingRight: 32 }}>
              {children}
            </div>
          </main>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent flash of wrong theme on initial load */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* PWA manifest and mobile meta tags */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1F1B4A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className="h-screen overflow-hidden bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased">
        <EnvironmentBanner />
        <DynamicFavicon />
        <ErrorCaptureProvider>
        <ThemeProvider>
          <PaletteProvider>
            <SessionProvider>
              <BrandingProvider>
              <TerminologyProvider>
              <MasqueradeProvider>
              <DomainScopeProvider>
              <StepFlowProvider>
              <ViewModeProvider>
              <EntityProvider>
                <GuidanceProvider>
                  <ChatProvider>
                    <GlobalAssistantProvider>
                      <ContentJobQueueProvider>
                        <TourOverlay />
                        <PageErrorBoundary>
                          <Suspense fallback={null}>
                            <LayoutInner>{children}</LayoutInner>
                          </Suspense>
                        </PageErrorBoundary>
                        {/* Floating widgets — outside PageErrorBoundary so they survive page crashes */}
                        <GlobalAssistant />
                        <ContentJobQueue />
                        <BugReportButton />
                      </ContentJobQueueProvider>
                    </GlobalAssistantProvider>
                  </ChatProvider>
                </GuidanceProvider>
              </EntityProvider>
              </ViewModeProvider>
              </StepFlowProvider>
              </DomainScopeProvider>
              </MasqueradeProvider>
              </TerminologyProvider>
              </BrandingProvider>
            </SessionProvider>
          </PaletteProvider>
        </ThemeProvider>
        </ErrorCaptureProvider>
      </body>
    </html>
  );
}
