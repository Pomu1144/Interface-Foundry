import { Circle } from 'lucide-react';
import { registerActions } from '@/app/actions';
import { studio } from '@/store';
import { startRecordingSync, toggleRecording } from './recording';

export * from './steps';
export { startRecording, stopRecording, toggleRecording, saveRecording, discardRecording, useRecorderUi } from './recording';

/** Interaction recorder: Mod+Shift+R, viewport/posture steps while recording, re-arming after reloads. */
export function registerInteractionRecorder() {
  startRecordingSync();
  registerActions([
    {
      id: 'record.toggle',
      label: 'Start / stop recording an interaction',
      group: 'Test',
      shortcut: 'Mod+Shift+R',
      icon: Circle,
      keywords: 'record scenario macro replay timeline',
      enabled: () => Boolean(studio().project),
      run: () => toggleRecording(),
    },
    {
      id: 'record.timeline',
      label: 'Show interaction timeline',
      group: 'Test',
      run: () => studio().setBottomTab('timeline'),
    },
    {
      id: 'record.scenarios',
      label: 'Show test scenarios',
      group: 'Test',
      run: () => studio().setLeftTab('scenarios'),
    },
  ]);
}
