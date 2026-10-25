import { FileInput, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Scenario } from '@shared/types';
import { Button, Dialog, Notice } from '@/ui';
import { studio, useStudio } from '@/store';
import { showInTimeline } from '@/modules/interaction-replayer';
import { StepIcon, useHostOwner } from './bits';
import { discardRecording, saveRecording, useRecorderUi } from './recording';
import { actionHasSecret, parseScenario } from './steps';
import s from './dialogs.module.css';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      {children}
      {hint && <span className={s.hint}>{hint}</span>}
    </label>
  );
}

function suiteOptions(scenarios: Scenario[]) {
  return [...new Set(scenarios.filter((x) => !x.builtIn).map((x) => x.suite ?? 'Recorded'))];
}

/** Name a finished recording and save it as a scenario. Hosted by whichever recorder panel is mounted. */
export function SaveRecordingDialog() {
  const owner = useHostOwner('save-recording');
  const open = useRecorderUi((u) => u.saveOpen);
  const meta = useRecorderUi((u) => u.meta);
  const steps = useStudio((st) => st.recording.steps);
  const scenarios = useStudio((st) => st.scenarios);
  const routes = useStudio((st) => st.routes);
  const routeLabel = routes.find((r) => r.path === meta?.route)?.label ?? meta?.route ?? '';
  const [name, setName] = useState('');
  const [suite, setSuite] = useState('Recorded');
  const [description, setDescription] = useState('');
  useEffect(() => {
    if (open) {
      setName(`${routeLabel || 'Recorded'} flow ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      setDescription('');
    }
  }, [open, routeLabel]);
  const masked = steps.filter((x) => actionHasSecret(x.action) || (x.action.type === 'fill' && x.action.masked)).length;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const st of steps) m.set(st.action.type, (m.get(st.action.type) ?? 0) + 1);
    return [...m.entries()];
  }, [steps]);
  if (!owner) return null;
  const suites = suiteOptions(scenarios);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && useRecorderUi.setState({ saveOpen: false })}
      title="Save recorded scenario"
      description={`${steps.length} steps recorded on ${meta?.deviceName ?? 'the canvas device'}${routeLabel ? `, starting at ${routeLabel}` : ''}.`}
      icon={<Save size={18} color="var(--accent)" />}
      width={520}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              discardRecording();
              toast('Recording discarded');
            }}
          >
            Discard
          </Button>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={() => useRecorderUi.setState({ saveOpen: false })}>
            Keep editing
          </Button>
          <Button variant="primary" disabled={!name.trim() || !steps.length} onClick={() => saveRecording({ name, suite, description })}>
            Save scenario
          </Button>
        </>
      }
    >
      <div className={s.form}>
        <Field label="Name">
          <input className={s.input} value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && saveRecording({ name, suite, description })} />
        </Field>
        <Field label="Suite" hint="Scenarios are grouped by suite in Test scenarios.">
          <input className={s.input} value={suite} list="ifdy-suites" onChange={(e) => setSuite(e.target.value)} />
          <datalist id="ifdy-suites">
            {suites.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        <Field label="Description">
          <textarea className={s.textarea} rows={2} value={description} placeholder="What this flow checks (optional)" onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className={s.chips}>
          {counts.map(([type, n]) => (
            <span key={type} className={s.chip}>
              <StepIcon type={type as never} size={11} />
              {n} {type}
            </span>
          ))}
        </div>
        {masked > 0 && (
          <Notice tone="info">
            {masked} typed value{masked === 1 ? ' was' : 's were'} masked as <code>{'{{secret:…}}'}</code> placeholders. They resolve from Settings → Fixtures at replay time and are never stored.
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

/** Rename / re-suite a user scenario. */
export function ScenarioMetaDialog({ scenario, onClose }: { scenario: Scenario | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [suite, setSuite] = useState('');
  const [description, setDescription] = useState('');
  useEffect(() => {
    if (scenario) {
      setName(scenario.name);
      setSuite(scenario.suite ?? '');
      setDescription(scenario.description);
    }
  }, [scenario]);
  const save = () => {
    if (!scenario || !name.trim()) return;
    studio().upsertScenario({ ...scenario, name: name.trim(), suite: suite.trim() || undefined, description: description.trim() });
    onClose();
  };
  return (
    <Dialog
      open={Boolean(scenario)}
      onOpenChange={(o) => !o && onClose()}
      title="Scenario details"
      width={480}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className={s.form}>
        <Field label="Name">
          <input className={s.input} value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </Field>
        <Field label="Suite">
          <input className={s.input} value={suite} onChange={(e) => setSuite(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea className={s.textarea} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Paste a scenario exported with “Copy as JSON”. */
export function ImportScenarioDialog() {
  const owner = useHostOwner('import-scenario');
  const open = useRecorderUi((u) => u.importOpen);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
    }
  }, [open]);
  if (!owner) return null;
  const parsed = (() => {
    if (!text.trim()) return null;
    try {
      return parseScenario(text);
    } catch (e) {
      return e as Error;
    }
  })();
  const doImport = () => {
    if (!parsed || parsed instanceof Error) {
      setError(parsed instanceof Error ? parsed.message : 'Paste a scenario first.');
      return;
    }
    const exists = studio().scenarios.some((x) => x.id === parsed.id);
    const sc = exists ? { ...parsed, id: `${parsed.id}-${Date.now().toString(36)}` } : parsed;
    studio().upsertScenario(sc);
    useRecorderUi.setState({ importOpen: false });
    showInTimeline({ kind: 'scenario', scenarioId: sc.id, runId: null });
    toast.success(`Imported “${sc.name}”`, { description: `${sc.steps.length} steps` });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && useRecorderUi.setState({ importOpen: false })}
      title="Import scenario"
      description="Paste JSON exported with “Copy as JSON”. Imported scenarios are editable and saved with the project."
      icon={<FileInput size={18} color="var(--accent)" />}
      width={560}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button onClick={() => useRecorderUi.setState({ importOpen: false })}>Cancel</Button>
          <Button variant="primary" disabled={!parsed || parsed instanceof Error} onClick={doImport}>
            Import
          </Button>
        </>
      }
    >
      <div className={s.form}>
        <textarea className={`${s.textarea} ${s.code}`} rows={12} spellCheck={false} placeholder='{ "format": "ifdy.scenario", "version": 1, "scenario": { … } }' value={text} onChange={(e) => setText(e.target.value)} />
        {parsed && !(parsed instanceof Error) && (
          <Notice tone="info">
            “{parsed.name}” · {parsed.steps.length} steps{parsed.route ? ` · starts at ${parsed.route}` : ''}
          </Notice>
        )}
        {(error || parsed instanceof Error) && <Notice tone="danger">{error ?? (parsed as Error).message}</Notice>}
      </div>
    </Dialog>
  );
}
