import {
  Camera,
  ChevronDown,
  CircleAlert,
  Columns2,
  FlaskConical,
  Hand,
  Moon,
  MousePointer2,
  MousePointerClick,
  Play,
  Redo2,
  RotateCw,
  ScanSearch,
  Settings,
  Share,
  Sparkles,
  Square,
  Sun,
  SunMoon,
  TabletSmartphone,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { IconButton, Menu, Segmented, Spinner, Tooltip } from '@/ui';
import { studio, useStudio } from '@/store';
import { runAction } from '@/app/actions';
import { art, deviceArt } from '@/app/art';
import { describeSource } from '@/modules/project-adapter/source';
import { DevicePicker } from './DevicePicker';
import s from '../shell.module.css';

export function Toolbar() {
  return (
    <header className={s.toolbar}>
      <LeftCluster />
      <ActivityCenter />
      <RightCluster />
    </header>
  );
}

function LeftCluster() {
  const project = useStudio((st) => st.project);
  const source = useStudio((st) => st.source);
  const routes = useStudio((st) => st.routes);
  const route = useStudio((st) => st.currentRoute);
  const canUndo = useStudio((st) => st.undoStack.length > 0);
  const canRedo = useStudio((st) => st.redoStack.length > 0);
  const tool = useStudio((st) => st.tool);
  const interaction = useStudio((st) => st.interaction);
  const currentRoute = routes.find((r) => r.path === route);
  return (
    <div className={s.toolbarGroup}>
      <Menu
        width={260}
        trigger={
          <button className={s.brand} aria-label="Project menu">
            <img src={art.appIcon} className={s.brandIcon} alt="" />
            <span className={s.brandText}>
              <span className={s.brandProject}>{project?.name ?? 'IFDY'}</span>
              <span className={s.brandSource}>{describeSource(source)}</span>
            </span>
            <ChevronDown size={12} color="var(--text-3)" />
          </button>
        }
        items={[
          { type: 'label', label: 'Project' },
          { label: 'Open Harborline demo', onSelect: () => runAction('project.openDemo') },
          { label: 'Import static project…', shortcut: 'Mod+O', onSelect: () => runAction('project.import') },
          { label: 'Simulate a URL across devices…', shortcut: 'Mod+Shift+U', onSelect: () => runAction('project.simulateUrl') },
          { label: 'Save', shortcut: 'Mod+S', onSelect: () => runAction('project.save') },
          { type: 'separator' },
          { label: 'Welcome screen', onSelect: () => runAction('project.close') },
          { label: 'Settings…', shortcut: 'Mod+,', onSelect: () => studio().setDialog('settings', true) },
        ]}
      />
      {routes.length > 0 && (
        <Menu
          width={280}
          trigger={
            <button className={s.scheme} style={{ maxWidth: 220 }} aria-label="Current page">
              <span style={{ color: 'var(--text-3)' }}>/</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentRoute?.label ?? (route || 'index')}</span>
              <ChevronDown size={12} color="var(--text-3)" />
            </button>
          }
          items={routes.map((r) => ({ label: r.label, hint: r.path.length > 24 ? r.path.slice(0, 24) + '…' : r.path, checked: r.path === route, onSelect: () => studio().setCurrentRoute(r.path) }))}
        />
      )}
      <span className={s.toolbarDivider} />
      <IconButton label="Undo" shortcut="Mod+Z" disabled={!canUndo} onClick={() => studio().undo()}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton label="Redo" shortcut="Mod+Shift+Z" disabled={!canRedo} onClick={() => studio().redo()}>
        <Redo2 size={15} />
      </IconButton>
      <span className={s.toolbarDivider} />
      <IconButton label="Select" shortcut="V" active={tool === 'select'} onClick={() => studio().setTool('select')}>
        <MousePointer2 size={15} />
      </IconButton>
      <IconButton label="Pan (hold Space)" shortcut="H" active={tool === 'pan'} onClick={() => studio().setTool('pan')}>
        <Hand size={15} />
      </IconButton>
      <span className={s.toolbarDivider} />
      <Segmented
        ariaLabel="Preview mode"
        value={interaction}
        onChange={(v) => studio().setInteraction(v)}
        options={[
          { value: 'inspect', label: 'Inspect', icon: <ScanSearch size={12} />, title: 'Click elements to select them (I)' },
          { value: 'interact', label: 'Interact', icon: <MousePointerClick size={12} />, title: 'Use the page normally (P)' },
        ]}
      />
    </div>
  );
}

function ActivityCenter() {
  const project = useStudio((st) => st.project);
  const device = useStudio((st) => st.device());
  const viewport = useStudio((st) => st.viewport);
  const transition = useStudio((st) => st.transition);
  const primary = useStudio((st) => st.instances.primary);
  const errors = useStudio((st) => st.console.filter((c) => c.level === 'error').length);
  const warnings = useStudio((st) => st.console.filter((c) => c.level === 'warn').length);
  const issues = useStudio((st) => st.a11yIssues.length + st.responsiveIssues.length);
  const runs = useStudio((st) => st.runs);
  const running = runs.some((r) => r.status === 'running');
  const status = primary?.status ?? 'idle';
  const vp = primary?.viewport;
  const cat = deviceArt(device.category);
  const stateText = (() => {
    if (!project) return <>No project open</>;
    if (running) return <><b>Running tests</b> on {device.name}…</>;
    if (transition.playing) return <><b>{transition.direction === 1 ? 'Unfolding' : 'Folding'}</b> {device.name} · {Math.round(transition.progress * 100)}%</>;
    switch (status) {
      case 'loading':
        return <><b>Loading</b> {project.name}…</>;
      case 'ready':
        return (
          <>
            <b>Running</b> {project.name} on {device.name}
            {device.expanded ? ` · ${viewport.posture}` : ''} {vp ? `· ${vp.width}×${vp.height}` : ''}
          </>
        );
      case 'crashed':
        return <><b>Not responding</b> · edits are safe</>;
      case 'error':
      case 'blocked':
        return <><b>Preview unavailable</b> · {primary?.error?.slice(0, 60)}</>;
      default:
        return <>Ready</>;
    }
  })();
  return (
    <div className={s.activity} style={{ position: 'relative' }}>
      <Tooltip content="Run (reload preview, re-apply edits)" shortcut="Mod+R">
        <button className={s.runButton} data-running={status === 'ready' ? 'true' : undefined} onClick={() => studio().reloadPreview()} aria-label="Run">
          <Play size={14} fill="currentColor" />
        </button>
      </Tooltip>
      <Tooltip content="Stop running tests">
        <button className={s.runButton} onClick={() => runAction('test.stop')} aria-label="Stop" disabled={!running}>
          <Square size={11} fill="currentColor" />
        </button>
      </Tooltip>
      <DevicePicker
        trigger={
          <button className={s.scheme} aria-label="Device">
            {cat ? <img src={cat} className={s.schemeIcon} alt="" /> : <TabletSmartphone size={14} />}
            {device.name}
            <ChevronDown size={11} color="var(--text-3)" />
          </button>
        }
      />
      <div className={s.activityStatus}>
        {(status === 'loading' || running) && <Spinner size={11} />}
        <span className={s.activityText}>{stateText}</span>
        <span className={s.counts}>
          {errors > 0 && (
            <button className={s.count} data-tone="danger" onClick={() => studio().setBottomTab('errors')} title="Errors">
              <CircleAlert size={12} />
              {errors}
            </button>
          )}
          {warnings > 0 && (
            <button className={s.count} data-tone="warning" onClick={() => studio().setBottomTab('console')} title="Warnings">
              <TriangleAlert size={12} />
              {warnings}
            </button>
          )}
          {issues > 0 && (
            <button className={s.count} data-tone="warning" onClick={() => studio().setBottomTab('responsive')} title="Audit findings">
              <ScanSearch size={12} />
              {issues}
            </button>
          )}
        </span>
      </div>
      {status === 'loading' && <span className={s.activityProgress} style={{ width: '60%' }} />}
    </div>
  );
}

function RightCluster() {
  const device = useStudio((st) => st.device());
  const viewport = useStudio((st) => st.viewport);
  const compare = useStudio((st) => st.compare.enabled);
  const colorScheme = useStudio((st) => st.colorScheme);
  const saveStatus = useStudio((st) => st.saveStatus);
  const project = useStudio((st) => st.project);
  return (
    <div className={`${s.toolbarGroup} ${s.toolbarRight}`}>
      {device.expanded && (
        <IconButton label={viewport.posture === 'expanded' ? 'Fold' : 'Unfold'} shortcut="F" tone="molten" active={viewport.posture === 'expanded'} onClick={() => studio().toggleFold()}>
          <TabletSmartphone size={15} />
        </IconButton>
      )}
      <IconButton
        label="Rotate"
        shortcut="R"
        active={viewport.orientation === 'landscape'}
        onClick={() => studio().setViewport({ orientation: viewport.orientation === 'portrait' ? 'landscape' : 'portrait' })}
      >
        <RotateCw size={15} />
      </IconButton>
      <IconButton label="Compare side by side" shortcut="Mod+Shift+C" active={compare} onClick={() => runAction('view.compare')}>
        <Columns2 size={15} />
      </IconButton>
      <Menu
        align="end"
        trigger={
          <span>
            <IconButton label="Preview color scheme" active={colorScheme !== null}>
              {colorScheme === 'dark' ? <Moon size={15} /> : colorScheme === 'light' ? <Sun size={15} /> : <SunMoon size={15} />}
            </IconButton>
          </span>
        }
        items={[
          { type: 'label', label: 'prefers-color-scheme' },
          { label: 'Follow system', checked: colorScheme === null, onSelect: () => studio().setColorScheme(null) },
          { label: 'Light', checked: colorScheme === 'light', onSelect: () => studio().setColorScheme('light') },
          { label: 'Dark', checked: colorScheme === 'dark', onSelect: () => studio().setColorScheme('dark') },
          { type: 'separator' },
          { type: 'label', label: 'Dynamic type / font scale' },
          ...[0.85, 1, 1.15, 1.3, 1.6, 2].map((f) => ({ label: `${Math.round(f * 100)}%`, checked: studio().fontScale === f, onSelect: () => studio().setFontScale(f) })),
        ]}
      />
      <span className={s.toolbarDivider} />
      <IconButton label="Capture screenshot" shortcut="Mod+Shift+S" disabled={!project} onClick={() => runAction('capture.screenshot')}>
        <Camera size={15} />
      </IconButton>
      <IconButton label="Run tests & audits" shortcut="Mod+Enter" tone="accent" disabled={!project} onClick={() => runAction('test.runAll')}>
        <FlaskConical size={15} />
      </IconButton>
      <IconButton label="AI diagnosis" shortcut="Mod+Shift+D" tone="violet" disabled={!project} onClick={() => runAction('ai.diagnose')}>
        <Sparkles size={15} />
      </IconButton>
      <IconButton label="Export changes" shortcut="Mod+E" disabled={!project} onClick={() => runAction('export.open')}>
        <Share size={15} />
      </IconButton>
      <span className={s.toolbarDivider} />
      {project && (
        <Tooltip content={saveStatus === 'saved' ? 'All changes saved locally' : saveStatus === 'error' ? 'Saving failed' : 'Saving…'} shortcut="Mod+S">
          <span className={s.saveDot} data-status={saveStatus}>
            {saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : 'Saving'}
          </span>
        </Tooltip>
      )}
      <IconButton label="Settings" shortcut="Mod+," onClick={() => studio().setDialog('settings', true)}>
        <Settings size={15} />
      </IconButton>
    </div>
  );
}
