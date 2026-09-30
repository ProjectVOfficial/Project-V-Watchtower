import { Panel } from './Panel';
import { createResearchMission, listResearchMissions, subscribeResearchMissions } from '@/services/multi-agent-research';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';
import { escapeHtml } from '@/utils/sanitize';

export class MultiAgentResearchPanel extends Panel {
  private cleanup: (() => void) | null = null;

  constructor() {
    super({
      id: 'multi-agent-research',
      title: 'AI RESEARCH LAB',
      showCount: true,
      className: 'v-multi-agent-research-panel',
      infoTooltip: 'Coordinate several local Ollama analyst roles in a separate Analysis Room. Agents use the same source-aware Watchtower, Research Library, map, alert, and optional Case Desk context.',
    });
    const element = this.getElement();
    element.dataset.moduleDefaultW = '4';
    element.dataset.moduleDefaultH = '4';
    element.dataset.moduleMinW = '3';
    element.dataset.moduleMinH = '3';
    element.dataset.moduleCategory = 'ai';
    element.dataset.moduleDescription = 'Local multi-agent research missions with collector, verifier, timeline, contradiction, geospatial, and briefing roles.';
    this.cleanup = subscribeResearchMissions(() => this.render());
    this.render();
  }

  private render(): void {
    const missions = listResearchMissions();
    const active = missions.filter((mission) => mission.status === 'running').length;
    const complete = missions.filter((mission) => mission.status === 'complete').length;
    const latest = missions[0];
    this.setCount(active || missions.length);
    this.content.innerHTML = `
      <div class="v-research-lab-summary">
        <div><strong>${active}</strong><span>ACTIVE MISSIONS</span></div>
        <div><strong>${complete}</strong><span>COMPLETED</span></div>
        <div><strong>6</strong><span>ANALYST ROLES</span></div>
      </div>
      <div class="v-research-lab-agents" aria-label="Multi-agent roles">
        <span>COLLECTOR</span><span>VERIFIER</span><span>TIMELINE</span><span>CONTRADICTIONS</span><span>GEOSPATIAL</span><span>BRIEFING</span>
      </div>
      <div class="v-desk-recent">
        <span>LATEST MISSION</span>
        <strong>${escapeHtml(latest?.title ?? 'NO MISSIONS CREATED')}</strong>
        <small>${latest ? `${latest.status.toUpperCase()} · ${new Date(latest.updatedAt).toLocaleString()}` : 'Start a source-aware local research mission.'}</small>
      </div>
      <div class="v-desk-actions">
        <button type="button" data-action="open">OPEN ANALYSIS ROOM</button>
        <button type="button" data-action="new">NEW MISSION</button>
      </div>
      <div class="v-research-lab-foot">LOCAL OLLAMA · AGENT OUTPUTS REMAIN SEPARATE · ORIGINAL SOURCES REQUIRED</div>
    `;
    this.content.querySelector<HTMLButtonElement>('[data-action="open"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('analysis-room'));
    this.content.querySelector<HTMLButtonElement>('[data-action="new"]')?.addEventListener('click', () => {
      const title = window.prompt('Research mission title:', 'New Intelligence Research Mission')?.trim();
      if (!title) return;
      const mission = createResearchMission({ title });
      void openProjectVWorkspaceWindow('analysis-room', { mission: mission.id });
    });
  }

  public override destroy(): void {
    this.cleanup?.();
    this.cleanup = null;
    super.destroy();
  }
}
