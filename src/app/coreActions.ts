import {
  Columns2,
  FolderOpen,
  Globe,
  Hand,
  LayoutGrid,
  Maximize,
  MousePointer2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plug,
  Redo2,
  RefreshCw,
  RotateCw,
  Save,
  ScanSearch,
  Settings,
  TabletSmartphone,
  Undo2,
  Box,
  Smartphone,
  MousePointerClick,
  Keyboard,
} from 'lucide-react';
import { toast } from 'sonner';
import { studio } from '@/store';
import { registerActions } from './actions';
import { closeProject, openDemoProject } from '@/modules/project-adapter/projects';
import { saveProjectNow } from '@/modules/project-storage/storage';
import { setZoom } from '@/modules/canvas/ZoomHud';
import { BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';

export function registerCoreActions() {
  const hasProject = () => Boolean(studio().project);
  registerActions([
    { id: 'project.openDemo', label: 'Open Harborline demo', group: 'Project', icon: FolderOpen, run: () => openDemoProject().catch((e) => toast.error(e.message)) },
    { id: 'project.import', label: 'Import static project…', group: 'Project', shortcut: 'Mod+O', icon: FolderOpen, run: () => studio().setDialog('importProject', true) },
    { id: 'project.connectLocal', label: 'Connect local dev server…', group: 'Project', icon: Plug, run: () => studio().setDialog('importProject', true) },
    { id: 'project.simulateUrl', label: 'Simulate a URL across devices…', group: 'Project', shortcut: 'Mod+Shift+U', icon: Globe, run: () => studio().setDialog('simulateUrl', true) },
    { id: 'project.save', label: 'Save project', group: 'Project', shortcut: 'Mod+S', icon: Save, enabled: hasProject, run: async () => {
      await saveProjectNow();
      toast.success('Project saved locally');
    } },
    { id: 'project.close', label: 'Close project (welcome screen)', group: 'Project', run: () => closeProject() },
    { id: 'app.settings', label: 'Settings…', group: 'Project', shortcut: 'Mod+,', icon: Settings, run: () => studio().setDialog('settings', true) },
    { id: 'app.shortcuts', label: 'Keyboard shortcuts', group: 'Help', shortcut: 'Mod+/', icon: Keyboard, run: () => studio().setDialog('shortcuts', true) },

    { id: 'edit.undo', label: 'Undo', group: 'Edit', shortcut: 'Mod+Z', icon: Undo2, run: () => studio().undo() },
    { id: 'edit.redo', label: 'Redo', group: 'Edit', shortcut: 'Mod+Shift+Z', icon: Redo2, run: () => studio().redo() },
    { id: 'edit.reset', label: 'Reset all edits (back to original preview)', group: 'Edit', enabled: () => studio().changes.length > 0, run: () => {
      studio().resetChanges();
      toast('All edits removed — undo to restore');
    } },

    { id: 'tool.select', label: 'Select tool', group: 'View', shortcut: 'V', icon: MousePointer2, run: () => studio().setTool('select') },
    { id: 'tool.pan', label: 'Pan tool', group: 'View', shortcut: 'H', icon: Hand, run: () => studio().setTool('pan') },
    { id: 'mode.inspect', label: 'Inspect mode', group: 'Inspect', shortcut: 'I', icon: ScanSearch, run: () => studio().setInteraction('inspect') },
    { id: 'mode.interact', label: 'Interact mode (use the page)', group: 'Inspect', shortcut: 'P', icon: MousePointerClick, run: () => studio().setInteraction('interact') },
    { id: 'mode.toggle', label: 'Toggle inspect / interact', group: 'Inspect', shortcut: 'Mod+Shift+I', run: () => studio().setInteraction(studio().interaction === 'inspect' ? 'interact' : 'inspect') },
    { id: 'view.fit', label: 'Zoom to fit', group: 'View', shortcut: 'Shift+1', icon: Maximize, run: () => studio().fitCamera() },
    { id: 'view.zoom100', label: 'Zoom to 100%', group: 'View', shortcut: 'Shift+0', run: () => setZoom(1) },
    { id: 'view.zoomIn', label: 'Zoom in', group: 'View', shortcut: 'Mod+=', run: () => setZoom(studio().camera.zoom * 1.25) },
    { id: 'view.zoomOut', label: 'Zoom out', group: 'View', shortcut: 'Mod+-', run: () => setZoom(studio().camera.zoom / 1.25) },
    { id: 'view.left', label: 'Toggle navigator', group: 'View', shortcut: 'Mod+\\', icon: PanelLeft, run: () => studio().togglePanel('left') },
    { id: 'view.right', label: 'Toggle inspector', group: 'View', shortcut: 'Mod+Alt+\\', icon: PanelRight, run: () => studio().togglePanel('right') },
    { id: 'view.bottom', label: 'Toggle debug panel', group: 'View', shortcut: 'Mod+J', icon: PanelBottom, run: () => studio().togglePanel('bottom') },
    { id: 'view.compare', label: 'Compare folded vs expanded side by side', group: 'View', shortcut: 'Mod+Shift+C', icon: Columns2, enabled: hasProject, run: () => {
      const st = studio();
      if (st.compare.enabled) return st.setCompare({ enabled: false });
      const d = st.device();
      const partner = d.expanded
        ? { deviceId: d.id, posture: st.viewport.posture === 'expanded' ? ('folded' as const) : ('expanded' as const), orientation: st.viewport.orientation }
        : { deviceId: d.category === 'desktop' ? 'iphone-16-pro' : 'desktop-1440', posture: 'folded' as const, orientation: 'portrait' as const };
      st.setCompare({ enabled: true, partner });
    } },
    { id: 'view.wall', label: 'Device wall — simulate on many devices', group: 'View', shortcut: 'Mod+Shift+W', icon: LayoutGrid, enabled: hasProject, run: () => studio().openDoc({ id: 'wall', kind: 'wall', title: 'Device wall' }) },
    { id: 'view.hierarchy', label: '3D view hierarchy (exploded layers)', group: 'View', shortcut: 'Mod+Shift+H', icon: Box, enabled: hasProject, run: () => studio().openDoc({ id: 'hierarchy', kind: 'hierarchy', title: '3D View Hierarchy' }) },
    { id: 'preview.reload', label: 'Run (reload preview, re-apply edits)', group: 'View', shortcut: 'Mod+R', icon: RefreshCw, enabled: hasProject, run: () => studio().reloadPreview() },

    { id: 'device.fold', label: 'Fold / unfold', group: 'Device', shortcut: 'F', icon: TabletSmartphone, run: () => studio().toggleFold() },
    { id: 'device.rotate', label: 'Rotate device', group: 'Device', shortcut: 'R', icon: RotateCw, run: () => {
      const st = studio();
      st.setViewport({ orientation: st.viewport.orientation === 'portrait' ? 'landscape' : 'portrait' });
    } },
    { id: 'device.manager', label: 'Device Manager…', group: 'Device', icon: Smartphone, run: () => studio().setDialog('deviceManager', true) },
    ...BUILT_IN_DEVICES.map((d) => ({
      id: `device.use.${d.id}`,
      label: `Use ${d.name}`,
      group: 'Device' as const,
      keywords: `${d.vendor ?? ''} ${d.platform} ${d.category}`,
      icon: Smartphone,
      run: () => studio().setViewport({ deviceId: d.id }),
    })),
  ]);
}
