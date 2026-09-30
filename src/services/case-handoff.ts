import {
  createCase,
  createCaseItem,
  listCases,
  type CaseConfidence,
  type CaseItem,
  type CaseItemType,
  type ProjectVCase,
} from './case-desk';
import { openProjectVWorkspaceWindow } from './workspace-windows';

export interface CaseHandoffInput {
  type?: CaseItemType;
  title: string;
  detail?: string;
  confidence?: CaseConfidence;
  source?: string;
  sourceUrl?: string;
  occurredAt?: number;
  metadata?: Record<string, string>;
}

async function chooseCase(subject: string): Promise<ProjectVCase | null> {
  const cases = (await listCases()).filter((record) => record.status !== 'closed');
  if (cases.length === 0) {
    const title = window.prompt(`No active cases exist. Enter a case name for “${subject}”:`, subject.slice(0, 100));
    if (!title?.trim()) return null;
    return createCase({ title: title.trim(), description: `Created from Watchtower while filing: ${subject}` });
  }
  if (cases.length === 1) {
    return window.confirm(`Add “${subject}” to case “${cases[0]!.title}”?`) ? cases[0]! : null;
  }
  const options = cases.slice(0, 25).map((record, index) => `${index + 1}. ${record.title}`).join('\n');
  const selection = window.prompt(`Choose the case number for “${subject}”:\n\n${options}`, '1');
  if (!selection) return null;
  const index = Number.parseInt(selection, 10) - 1;
  return Number.isInteger(index) && index >= 0 && index < Math.min(cases.length, 25) ? cases[index]! : null;
}

export async function sendToCaseDesk(input: CaseHandoffInput): Promise<CaseItem | null> {
  const caseRecord = await chooseCase(input.title);
  if (!caseRecord) return null;
  const item = await createCaseItem(caseRecord.id, {
    type: input.type ?? 'note',
    title: input.title,
    detail: input.detail ?? '',
    confidence: input.confidence ?? 'analyst',
    source: input.source,
    sourceUrl: input.sourceUrl,
    occurredAt: input.occurredAt,
    metadata: input.metadata,
  });
  await openProjectVWorkspaceWindow('case-desk', { case: caseRecord.id, item: item.id });
  return item;
}
