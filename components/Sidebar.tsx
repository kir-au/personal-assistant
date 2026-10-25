'use client';

import { 
  Brain,
  BriefcaseBusiness,
  Car,
  ChartCandlestick,
  Dumbbell,
  HardDrive, 
  Clock, 
  ChevronRight,
  CalendarDays,
  Folder,
  Landmark,
  LayoutDashboard,
  Plane,
  Plus,
  Repeat,
  Sparkles,
  TrendingUp,
  Users,
  X
} from 'lucide-react';
import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}

interface SidebarProps {
  currentView: 'today' | 'browse' | 'planner' | 'health' | 'recent' | 'project';
  onViewChange: (view: 'today' | 'browse' | 'planner' | 'health' | 'recent' | 'project') => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface ProjectRecord {
  id: string;
  title: string;
  icon?: string;
}

function projectIcon(name?: string) {
  const className = "w-4 h-4";
  switch (name) {
    case 'health': return <Dumbbell className={className} />;
    case 'personal-vault': return <HardDrive className={className} />;
    case 'business': return <BriefcaseBusiness className={className} />;
    case 'ai': return <Sparkles className={className} />;
    case 'family': return <Users className={className} />;
    case 'wealth': return <TrendingUp className={className} />;
    case 'travel': return <Plane className={className} />;
    case 'routine': return <Repeat className={className} />;
    case 'trading': return <ChartCandlestick className={className} />;
    case 'car': return <Car className={className} />;
    case 'work': return <Folder className={className} />;
    case 'politics': return <Landmark className={className} />;
    case 'startup': return <Brain className={className} />;
    default: return <Folder className={className} />;
  }
}

export default function Sidebar({ currentView, onViewChange, mobileOpen = false, onMobileClose }: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [recentCount, setRecentCount] = useState<number | undefined>(undefined);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectCreateStatus, setProjectCreateStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const drawerCollapsed = sidebarWidth < 132 && !mobileOpen;

  useEffect(() => {
    const saved = window.localStorage.getItem('personal-dashboard-sidebar-width');
    const parsed = saved ? Number(saved) : NaN;
    if (Number.isFinite(parsed)) {
      setSidebarWidth(Math.min(320, Math.max(64, parsed)));
    }
  }, []);

  useEffect(() => {
    fetch('/api/recent?limit=1')
      .then(res => res.json())
      .then(data => {
        if (data.totalFiles !== undefined) {
          setRecentCount(data.totalFiles);
        }
      })
      .catch(() => {}); // Silent fail
  }, []);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mobileOpen) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(320, Math.max(64, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(nextWidth);
      window.localStorage.setItem('personal-dashboard-sidebar-width', String(nextWidth));
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const toggleCompactWidth = () => {
    const nextWidth = drawerCollapsed ? 256 : 72;
    setSidebarWidth(nextWidth);
    window.localStorage.setItem('personal-dashboard-sidebar-width', String(nextWidth));
  };

  useEffect(() => {
    const loadProjects = () => {
      fetch('/api/projects')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data.projects)) setProjects(data.projects);
        })
        .catch(() => {});
    };

    loadProjects();
    window.addEventListener('projects-changed', loadProjects);
    return () => window.removeEventListener('projects-changed', loadProjects);
  }, []);

  const mainItems: SidebarItem[] = [
    {
      id: 'today',
      label: 'Today',
      icon: <LayoutDashboard className="w-5 h-5" />,
      active: currentView === 'today',
      onClick: () => {
        onViewChange('today');
        onMobileClose?.();
      },
    },
    {
      id: 'planner',
      label: 'Planner',
      icon: <CalendarDays className="w-5 h-5" />,
      active: currentView === 'planner',
      onClick: () => {
        onViewChange('planner');
        onMobileClose?.();
      },
    },
    {
      id: 'vault',
      label: 'Vault',
      icon: <HardDrive className="w-5 h-5" />,
      active: currentView === 'browse',
      onClick: () => {
        onViewChange('browse');
        onMobileClose?.();
      },
    },
    {
      id: 'recent',
      label: 'Recent Changes',
      icon: <Clock className="w-5 h-5" />,
      count: recentCount,
      active: currentView === 'recent',
      onClick: () => {
        onViewChange('recent');
        onMobileClose?.();
      },
    },
  ];

  const contextItems: SidebarItem[] = projects.map((project) => ({
    id: project.id,
    label: project.title,
    icon: projectIcon(project.icon || project.id),
    active: project.id === 'health'
      ? currentView === 'health'
      : currentView === 'project' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('project') === project.id,
    onClick: () => {
      if (project.id === 'health') {
        onViewChange('health');
        onMobileClose?.();
        return;
      }
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'project');
        url.searchParams.set('project', project.id);
        window.history.replaceState(null, '', url.toString());
      }
      onViewChange('project');
      onMobileClose?.();
    },
  }));

  const createProject = async () => {
    const title = window.prompt('New project name');
    if (!title?.trim()) return;

    setProjectCreateStatus('saving');
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Failed to create project');

      window.dispatchEvent(new Event('projects-changed'));
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'project');
        url.searchParams.set('project', data.project.id);
        window.history.replaceState(null, '', url.toString());
      }
      onViewChange('project');
      onMobileClose?.();
      setProjectCreateStatus('idle');
    } catch {
      setProjectCreateStatus('error');
      window.setTimeout(() => setProjectCreateStatus('idle'), 3000);
    }
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onMobileClose}
        aria-hidden="true"
      />
      <aside
        style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
        className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-surface flex flex-col transition-[transform,width] duration-200 md:relative md:z-auto md:w-[var(--sidebar-width)] md:translate-x-0 md:flex-shrink-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      <div
        onPointerDown={startResize}
        className="absolute -right-1 top-0 hidden h-full w-2 cursor-col-resize items-center justify-center md:flex"
        title="Drag to resize navigation"
      >
        <div className="h-full w-px bg-transparent hover:bg-primary/40" />
      </div>

      <button
        onClick={toggleCompactWidth}
        className="absolute -right-3 top-6 hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-surface shadow-sm hover:bg-surface-variant md:flex"
        title={drawerCollapsed ? 'Expand navigation' : 'Compact navigation'}
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${drawerCollapsed ? '' : 'rotate-180'}`} />
      </button>

      <button
        onClick={onMobileClose}
        className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-variant md:hidden"
        title="Close navigation"
      >
        <X className="h-5 w-5 text-on-surface-variant" />
      </button>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-12 md:py-4">
        <div className="px-3">
          <h3 className={`text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-2 ${drawerCollapsed ? 'text-center' : 'px-3'}`}>
            {drawerCollapsed ? '·' : 'Navigation'}
          </h3>
          <ul className="space-y-1">
            {mainItems.map((item) => (
              <li key={item.id}>
                <button
                  onClick={item.onClick}
                  className={`w-full flex items-center ${drawerCollapsed ? 'justify-center px-3' : 'px-3'} py-2 rounded-lg text-sm transition-colors ${
                    item.active
                      ? 'bg-active text-primary font-medium'
                      : 'hover:bg-surface-variant text-on-surface'
                  }`}
                  title={drawerCollapsed ? item.label : undefined}
                >
                  <span className={`${item.active ? 'text-primary' : 'text-on-surface-variant'}`}>
                    {item.icon}
                  </span>
                  {!drawerCollapsed && (
                    <>
                      <span className="ml-3 flex-1 text-left">{item.label}</span>
                      {item.count !== undefined && (
                        <span className="text-xs bg-surface-variant text-on-surface-variant px-1.5 py-0.5 rounded">
                          {item.count}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 px-3">
          <div className={`mb-2 flex items-center ${drawerCollapsed ? 'justify-center' : 'justify-between px-3'}`}>
            <h3 className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              {drawerCollapsed ? '·' : 'Projects'}
            </h3>
            <button
              type="button"
              onClick={createProject}
              disabled={projectCreateStatus === 'saving'}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-on-surface-variant transition-colors hover:border-border hover:bg-surface-variant hover:text-primary disabled:opacity-50 ${
                drawerCollapsed ? 'hidden' : ''
              }`}
              title={projectCreateStatus === 'error' ? 'Could not create project' : 'New project'}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <ul className="space-y-1">
            {drawerCollapsed && (
              <li>
                <button
                  type="button"
                  onClick={createProject}
                  disabled={projectCreateStatus === 'saving'}
                  className="flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm text-on-surface hover:bg-surface-variant disabled:opacity-50"
                  title={projectCreateStatus === 'error' ? 'Could not create project' : 'New project'}
                >
                  <Plus className="h-4 w-4 text-on-surface-variant" />
                </button>
              </li>
            )}
            {contextItems.map((item) => (
              <li key={item.id}>
                <button
                  onClick={item.onClick}
                  className={`w-full flex items-center ${drawerCollapsed ? 'justify-center px-3' : 'px-3'} py-2 rounded-lg text-sm transition-colors ${
                    item.active ? 'bg-active text-primary font-medium' : 'hover:bg-surface-variant text-on-surface'
                  }`}
                  title={drawerCollapsed ? item.label : undefined}
                >
                  <span className={item.active ? 'text-primary' : 'text-on-surface-variant'}>{item.icon}</span>
                  {!drawerCollapsed && <span className="ml-3 flex-1 text-left">{item.label}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      </aside>
    </>
  );
}
