import type { Diagnosis, DiagnoseEvent } from '../../src/modules/ai-debugger/schema';

export type Emit = (event: DiagnoseEvent) => void;

export type ProviderResult = {
  diagnosis: Diagnosis;
  repairs: string[];
  model: string;
  servedBy?: string;
  usage?: { input: number; output: number };
};

/** Errors whose message is safe to show to the user (never contains request context). */
export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
