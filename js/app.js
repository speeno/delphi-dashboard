const DATA_PATH = 'data/';

async function loadJSON(file) {
  const res = await fetch(DATA_PATH + file);
  return res.json();
}

async function loadAll() {
  const [project, sprints, todos, harness, deliverables, approvals, risks, timeline, evalSummary] =
    await Promise.all([
      loadJSON('project.json'),
      loadJSON('sprints.json'),
      loadJSON('todos.json'),
      loadJSON('harness.json'),
      loadJSON('deliverables.json'),
      loadJSON('approvals.json'),
      loadJSON('risks.json'),
      loadJSON('timeline.json'),
      loadJSON('eval-summary.json'),
    ]);
  return { project, sprints, todos, harness, deliverables, approvals, risks, timeline, evalSummary };
}

function statusBadge(status) {
  const map = {
    '진행중': 'badge-progress',
    '완료': 'badge-done',
    '미시작': 'badge-wait',
    '대기': 'badge-wait',
    '통과': 'badge-done',
    '거부': 'badge-danger',
    '감시중': 'badge-progress',
    '발생함': 'badge-danger',
    '해소됨': 'badge-done',
  };
  return `<span class="badge ${map[status] || 'badge-wait'}">${status}</span>`;
}

function riskClass(level) {
  const map = { '높음': 'risk-high', '중간': 'risk-mid', '낮음': 'risk-low' };
  return map[level] || '';
}

function renderOverview(data) {
  const { project, sprints } = data;
  const current = sprints.find(s => s.status === '진행중') || sprints[0];
  const assetsHTML = Object.entries(project.assets)
    .map(([, v]) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span>${v.description}</span>${statusBadge(v.status)}</div>`)
    .join('');
  const teamHTML = project.team
    .map(t => `<div style="font-size:13px;padding:4px 0"><strong>${t.role}</strong> (${t.harnessRole}) &times;${t.count}</div>`)
    .join('');

  return `
    <div class="section">
      <div class="grid grid-4">
        <div class="card">
          <div class="card-label">전체 진행률</div>
          <div class="card-value">${project.overallProgress}%</div>
          <div class="progress-bar"><div class="fill fill-primary" style="width:${project.overallProgress}%"></div></div>
        </div>
        <div class="card">
          <div class="card-label">현재 스프린트</div>
          <div class="card-value" style="font-size:18px">${current.name}</div>
          <div class="card-label">${current.weeks}</div>
        </div>
        <div class="card">
          <div class="card-label">팀 구성</div>
          ${teamHTML}
        </div>
        <div class="card">
          <div class="card-label">확보 현황</div>
          ${assetsHTML}
        </div>
      </div>
    </div>`;
}

function renderTimeline(data) {
  const { sprints } = data;
  const items = sprints.map(s => {
    let cls = '';
    if (s.status === '진행중') cls = 'active';
    else if (s.status === '완료') cls = 'completed';
    return `
      <div class="timeline-item ${cls}" data-sprint="${s.id}">
        <div class="sprint-name">${s.name}</div>
        <div class="sprint-weeks">${s.weeks}</div>
        <div class="progress-bar"><div class="fill ${s.status === '완료' ? 'fill-success' : 'fill-primary'}" style="width:${s.progress}%"></div></div>
        <div class="sprint-status">${statusBadge(s.status)}</div>
      </div>`;
  }).join('');

  return `
    <div class="section">
      <div class="section-title">스프린트 타임라인</div>
      <div class="timeline">${items}</div>
      <div id="sprint-detail" class="card" style="margin-top:12px;display:none"></div>
    </div>`;
}

function renderTodos(data) {
  const { todos } = data;
  const roles = Object.keys(todos.roles);
  const tabsHTML = roles.map((r, i) =>
    `<button class="tab ${i === 0 ? 'active' : ''}" data-role="${r}">${todos.roles[r].name}</button>`
  ).join('');

  const panelsHTML = roles.map((r, i) => {
    const tasks = todos.roles[r].tasks;
    const done = tasks.filter(t => t.done).length;
    const listHTML = tasks.map(t =>
      `<li><span class="check-icon ${t.done ? 'done' : ''}">${t.done ? '✓' : ''}</span><span>${t.task}</span></li>`
    ).join('');
    return `
      <div class="todo-panel" data-role="${r}" style="${i !== 0 ? 'display:none' : ''}">
        <div style="margin-bottom:8px;font-size:13px;color:var(--text-muted)">완료: ${done}/${tasks.length}</div>
        <div class="progress-bar" style="margin-bottom:12px"><div class="fill fill-success" style="width:${tasks.length ? (done/tasks.length*100) : 0}%"></div></div>
        <ul class="checklist">${listHTML}</ul>
      </div>`;
  }).join('');

  return `
    <div class="section">
      <div class="section-title">역할별 To-Do (Sprint ${todos.currentSprint})</div>
      <div class="card">
        <div class="tabs" id="todo-tabs">${tabsHTML}</div>
        ${panelsHTML}
      </div>
    </div>`;
}

function renderHarness(data) {
  const { harness } = data;
  const cards = harness.layers.map(l => {
    const coverageHTML = Object.entries(l.coverage)
      .map(([k, v]) => `<div style="font-size:11px;color:var(--text-muted)">${k}: <strong>${v}</strong></div>`)
      .join('');
    return `
      <div class="harness-card">
        <div class="layer-id">${l.id}</div>
        <div class="layer-name">${l.name}</div>
        <div class="layer-desc">${l.description}</div>
        <span class="maturity-badge maturity-${l.maturity}">${l.maturity}</span>
        <div style="margin-top:8px">${coverageHTML}</div>
      </div>`;
  }).join('');

  return `
    <div class="section">
      <div class="section-title">8계층 하네스 대시보드</div>
      <div class="grid grid-4">${cards}</div>
    </div>`;
}

function renderDeliverables(data) {
  const { deliverables } = data;
  const items = deliverables.map(d => `
    <div class="deliverable-item">
      <span class="deliverable-num">#${d.id}</span>
      <span class="deliverable-name">${d.nameKr} (${d.name})</span>
      <span class="deliverable-status">${statusBadge(d.status)}</span>
    </div>
  `).join('');

  const done = deliverables.filter(d => d.status === '완료').length;
  return `
    <div class="section">
      <div class="section-title">10대 표준 산출물 (${done}/${deliverables.length} 완료)</div>
      <div class="card">${items}</div>
    </div>`;
}

function renderApprovals(data) {
  const { approvals } = data;
  const items = approvals.map(g => {
    const cls = g.status === '통과' ? 'gate-pass' : g.status === '거부' ? 'gate-fail' : 'gate-wait';
    return `
      <div class="gate-item">
        <div class="gate-num ${cls}">${g.id}</div>
        <div class="gate-info">
          <div class="gate-name">${g.name}</div>
          <div class="gate-desc">${g.description} | 승인: ${g.approvers.join(', ')}${g.approvedDate ? ' | ' + g.approvedDate : ''}</div>
        </div>
        ${statusBadge(g.status)}
      </div>`;
  }).join('');

  const passed = approvals.filter(g => g.status === '통과').length;
  return `
    <div class="section">
      <div class="section-title">승인 게이트 (${passed}/${approvals.length} 통과)</div>
      <div class="card">${items}</div>
    </div>`;
}

function renderEval(data) {
  const { evalSummary } = data;
  if (!evalSummary.activated) {
    return `
      <div class="section">
        <div class="section-title">5축 평가 대시보드</div>
        <div class="card eval-inactive">Sprint ${evalSummary.activationSprint} 이후 활성화됩니다</div>
      </div>`;
  }
  const cards = evalSummary.axes.map(a => `
    <div class="eval-card">
      <div style="font-size:12px;color:var(--text-muted)">${a.nameKr}</div>
      <div class="eval-value">${a.passRate !== null ? a.passRate + '%' : '-'}</div>
      <div style="font-size:11px;color:var(--text-muted)">${a.passedCases}/${a.totalCases}</div>
    </div>
  `).join('');

  return `
    <div class="section">
      <div class="section-title">5축 평가 대시보드</div>
      <div class="eval-grid">${cards}</div>
    </div>`;
}

function renderRisks(data) {
  const { risks } = data;
  const rows = risks.map(r => `
    <tr>
      <td>${r.name}</td>
      <td class="${riskClass(r.probability)}">${r.probability}</td>
      <td class="${riskClass(r.impact)}">${r.impact}</td>
      <td>${r.response}</td>
      <td>${r.owner}</td>
      <td>${statusBadge(r.status)}</td>
    </tr>
  `).join('');

  return `
    <div class="section">
      <div class="section-title">위험 관리</div>
      <div class="card" style="overflow-x:auto">
        <table class="risk-table">
          <thead><tr><th>위험</th><th>확률</th><th>영향</th><th>대응</th><th>담당</th><th>상태</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderLog(data) {
  const { timeline } = data;
  const sorted = [...timeline].sort((a, b) => b.date.localeCompare(a.date));
  const items = sorted.map(e => `
    <div class="log-item">
      <div class="log-date">${e.date}</div>
      <div class="log-type log-type-${e.type}">${e.type}</div>
      <div class="log-content">
        <div class="log-title">${e.title}</div>
        <div class="log-desc">${e.description}</div>
      </div>
    </div>
  `).join('');

  return `
    <div class="section">
      <div class="section-title">변경 이력 / 의사결정 기록</div>
      <div class="card">${items}</div>
    </div>`;
}

function bindEvents(data) {
  document.querySelectorAll('#todo-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#todo-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const role = tab.dataset.role;
      document.querySelectorAll('.todo-panel').forEach(p => {
        p.style.display = p.dataset.role === role ? '' : 'none';
      });
    });
  });

  document.querySelectorAll('.timeline-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = parseInt(item.dataset.sprint);
      const sprint = data.sprints[id];
      const detail = document.getElementById('sprint-detail');
      detail.style.display = '';
      detail.innerHTML = `
        <div class="card-header">
          <div class="card-title">${sprint.name}</div>
          ${statusBadge(sprint.status)}
        </div>
        <div style="font-size:13px;margin-bottom:8px"><strong>기간:</strong> ${sprint.weeks}</div>
        <div style="font-size:13px;margin-bottom:8px"><strong>목표:</strong> ${sprint.goal}</div>
        <div style="font-size:13px;margin-bottom:8px"><strong>완료 기준:</strong> ${sprint.exitCriteria}</div>
        <div class="progress-bar"><div class="fill fill-primary" style="width:${sprint.progress}%"></div></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">진행률: ${sprint.progress}%</div>
      `;
    });
  });
}

async function init() {
  const data = await loadAll();
  const app = document.getElementById('app');
  app.innerHTML = [
    renderOverview(data),
    renderTimeline(data),
    renderTodos(data),
    renderHarness(data),
    renderDeliverables(data),
    renderApprovals(data),
    renderEval(data),
    renderRisks(data),
    renderLog(data),
  ].join('');
  bindEvents(data);
}

document.addEventListener('DOMContentLoaded', init);
