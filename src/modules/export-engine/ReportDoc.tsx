import { Download, FileText, Printer, RefreshCw } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button, Checkbox, IconButton, Tooltip } from '@/ui';
import { studio, useStudio, type DocTab } from '@/store';
import { EmptyPanel } from './EmptyPanel';
import { downloadText, recordExport, slugify } from './engine';
import { buildReportHtml, collectReport } from './report';
import s from './report.module.css';

export default function ReportDoc({ doc: _doc }: { doc: DocTab }) {
  const project = useStudio((st) => st.project);
  const changes = useStudio((st) => st.changes);
  const responsive = useStudio((st) => st.responsiveIssues);
  const a11y = useStudio((st) => st.a11yIssues);
  const runs = useStudio((st) => st.runs);
  const captures = useStudio((st) => st.captures);
  const deviceName = useStudio((st) => st.device().name);
  const [opts, setOpts] = useState({ captures: true, passedRuns: true });
  const [nonce, setNonce] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  const model = useMemo(
    () => collectReport({ ...studio(), project, changes, responsiveIssues: responsive, a11yIssues: a11y, runs, captures, deviceName }, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, changes, responsive, a11y, runs, captures, deviceName, opts, nonce],
  );
  const html = useMemo(() => buildReportHtml(model), [model]);

  if (!project) return <EmptyPanel icon={FileText} title="No project">Open a project to generate its QA report.</EmptyPanel>;

  const download = () => {
    downloadText(`${slugify(project.name)}-qa-report.html`, html, 'text/html');
    recordExport({ kind: 'report', label: 'Downloaded responsive QA report', detail: `${model.changes.length} changes · ${model.responsive.length + model.a11y.length} findings · ${model.runs.length} runs · ${model.captures.length} screenshots`, changeCount: model.changes.length });
  };

  return (
    <div className={s.wrap} data-testid="report-doc">
      <div className={s.toolbar}>
        <FileText size={14} />
        <span className={s.title}>Responsive QA report</span>
        <span className={s.meta}>
          {model.viewports.length} viewport profile{model.viewports.length === 1 ? '' : 's'} · {model.changes.length} changes · {model.responsive.length + model.a11y.length} findings · {model.runs.length} runs
        </span>
        <span style={{ flex: 1 }} />
        <Checkbox checked={opts.captures} onChange={(captures) => setOpts((o) => ({ ...o, captures }))} label="Screenshots" />
        <Checkbox checked={opts.passedRuns} onChange={(passedRuns) => setOpts((o) => ({ ...o, passedRuns }))} label="Passed runs" />
        <IconButton size="sm" label="Regenerate" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw size={13} />
        </IconButton>
        <Tooltip content="Print or save as PDF">
          <span>
            <IconButton size="sm" label="Print" onClick={() => frame.current?.contentWindow?.print()}>
              <Printer size={13} />
            </IconButton>
          </span>
        </Tooltip>
        <Button size="sm" variant="primary" icon={<Download size={12} />} onClick={download} data-testid="report-download">
          Download HTML
        </Button>
      </div>
      <iframe ref={frame} className={s.frame} title="QA report preview" srcDoc={html} sandbox="allow-same-origin allow-modals" />
    </div>
  );
}
