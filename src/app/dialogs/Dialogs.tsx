import { useStudio, studio } from '@/store';
import { SettingsDialog } from './SettingsDialog';
import { ImportDialog } from './ImportDialog';
import { SimulateUrlDialog } from './SimulateUrlDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { DeviceManagerDialog } from '@/modules/device-simulator/DeviceManagerDialog';

export function Dialogs() {
  const d = useStudio((st) => st.dialogs);
  return (
    <>
      <SettingsDialog open={d.settings} onOpenChange={(o) => studio().setDialog('settings', o)} />
      <ImportDialog open={d.importProject} onOpenChange={(o) => studio().setDialog('importProject', o)} />
      <SimulateUrlDialog open={d.simulateUrl} onOpenChange={(o) => studio().setDialog('simulateUrl', o)} />
      <ShortcutsDialog open={d.shortcuts} onOpenChange={(o) => studio().setDialog('shortcuts', o)} />
      <DeviceManagerDialog open={d.deviceManager} onOpenChange={(o) => studio().setDialog('deviceManager', o)} />
    </>
  );
}
