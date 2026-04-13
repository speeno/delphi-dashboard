/** GitHub Pages 등 서브 경로에서 끝 슬래시 없이 열릴 때 상대 fetch가 /data 로 가는 문제 방지 */
function dashboardBaseUrl() {
  let p = window.location.pathname;
  if (/\/[^/]+\.html?$/i.test(p)) p = p.replace(/\/[^/]+$/, '/');
  else if (!p.endsWith('/')) p += '/';
  return window.location.origin + p;
}

const DATA_PATH = dashboardBaseUrl() + 'data/';

async function loadJSON(file) {
  const url = DATA_PATH + file;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${url}`);
  }
  return res.json();
}

async function loadAll() {
  const [project, sprints, todos, todoFlow, harness, deliverables, approvals, risks, timeline, evalSummary, releaseMilestones] =
    await Promise.all([
      loadJSON('project.json'),
      loadJSON('sprints.json'),
      loadJSON('todos.json'),
      loadJSON('todo-flow.json'),
      loadJSON('harness.json'),
      loadJSON('deliverables.json'),
      loadJSON('approvals.json'),
      loadJSON('risks.json'),
      loadJSON('timeline.json'),
      loadJSON('eval-summary.json'),
      loadJSON('release-milestones.json'),
    ]);
  return { project, sprints, todos, todoFlow, harness, deliverables, approvals, risks, timeline, evalSummary, releaseMilestones };
}

function buildTaskMap(todos) {
  const map = {};
  Object.keys(todos.roles).forEach((roleKey) => {
    const role = todos.roles[roleKey];
    role.tasks.forEach((t) => {
      map[t.id] = { ...t, roleCode: roleKey, roleName: role.name };
    });
  });
  return map;
}

function statusBadge(status) {
  const map = {
    '진행중': 'badge-progress',
    '완료': 'badge-done',
    '예정': 'badge-wait',
    '지연': 'badge-danger',
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

function parseYMD(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const p = iso.split('-').map(Number);
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function compareYMD(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function initialCalendarYM(project) {
  const anchor = parseYMD(project.startDate);
  const now = new Date();
  if (anchor) {
    return { y: anchor.getFullYear(), m: anchor.getMonth() };
  }
  return { y: now.getFullYear(), m: now.getMonth() };
}

function sprintsOnDate(iso, sprints) {
  return sprints.filter((s) => {
    if (!s.startDate || !s.endDate) return false;
    return compareYMD(s.startDate, iso) <= 0 && compareYMD(iso, s.endDate) <= 0;
  });
}

/** sprintIds의 endDate 중 최댓값을 effectiveDate로 부여. 타임라인 이벤트와 별도인 오픈 단계 마일스톤용. */
function resolveMilestonePhases(sprints, releaseMilestones) {
  if (!releaseMilestones || !Array.isArray(releaseMilestones.phases)) return [];
  const byId = {};
  (sprints || []).forEach((s) => {
    byId[s.id] = s;
  });
  const phases = [...releaseMilestones.phases].sort((a, b) => (a.order || 0) - (b.order || 0));
  return phases.map((phase) => {
    const ids = phase.sprintIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[release-milestones] phase "${phase.id || phase.name}" has empty or missing sprintIds.`);
      }
      return { ...phase, effectiveDate: null, scheduleUnresolved: true };
    }
    const ends = [];
    let anyInvalidRef = false;
    ids.forEach((sid) => {
      const sp = byId[sid];
      if (!sp || !sp.endDate) {
        anyInvalidRef = true;
        return;
      }
      ends.push(sp.endDate);
    });
    if (!ends.length) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[release-milestones] phase "${phase.id || phase.name}" has no valid sprint end dates.`);
      }
      return { ...phase, effectiveDate: null, scheduleUnresolved: true };
    }
    if (anyInvalidRef && typeof console !== 'undefined' && console.warn) {
      console.warn(`[release-milestones] phase "${phase.id || phase.name}" references missing or invalid sprint id(s); date uses valid sprints only.`);
    }
    const effectiveDate = ends.reduce((a, b) => (compareYMD(a, b) >= 0 ? a : b));
    return { ...phase, effectiveDate, scheduleUnresolved: false };
  });
}

function releaseMilestonesOnDate(iso, resolvedPhases) {
  return resolvedPhases.filter((p) => p.effectiveDate === iso);
}

function buildCalendarGridHTML(data, year, monthIndex) {
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const todayYMD = toYMD(new Date());

  const headerRow = dayLabels.map((d) => `<div class="cal-head-cell">${d}</div>`).join('');
  const resolvedReleaseMilestones = resolveMilestonePhases(data.sprints, data.releaseMilestones);

  const cells = [];
  let day = 1 - startPad;
  for (let i = 0; i < 42; i += 1) {
    const cellDate = new Date(year, monthIndex, day);
    const iso = toYMD(cellDate);
    const inMonth = day >= 1 && day <= daysInMonth;

    if (!inMonth) {
      cells.push(
        `<div class="cal-cell cal-cell-muted" aria-hidden="true"><span class="cal-day-num">${cellDate.getDate()}</span></div>`
      );
    } else {
      const onSprints = sprintsOnDate(iso, data.sprints);
      const events = data.timeline.filter((e) => e.date === iso);
      const gates = data.approvals.filter((g) => g.plannedDate === iso);
      const onReleaseMilestones = releaseMilestonesOnDate(iso, resolvedReleaseMilestones);

      let cellClass = 'cal-cell';
      if (iso === todayYMD) cellClass += ' cal-cell-today';
      if (onSprints.length) cellClass += ' cal-cell-sprint';
      onSprints.forEach((s) => {
        if (s.status === '진행중') cellClass += ' cal-cell-active-sprint';
        if (s.status === '완료') cellClass += ' cal-cell-done-sprint';
      });
      if (onReleaseMilestones.length) cellClass += ' cal-cell-release-milestone';

      const dots = [];
      events.forEach((e) => dots.push(`<span class="cal-dot cal-dot-${e.type}" title="${e.title.replace(/"/g, '&quot;')}"></span>`));
      gates.forEach(() => dots.push('<span class="cal-dot cal-dot-gate" title="승인 게이트 예정"></span>'));
      onReleaseMilestones.forEach((p) =>
        dots.push(`<span class="cal-dot cal-dot-release" title="오픈 마일스톤: ${String(p.name || p.id).replace(/"/g, '&quot;')}"></span>`)
      );

      cells.push(`
        <button type="button" class="${cellClass}" data-date="${iso}">
          <span class="cal-day-num">${day}</span>
          <span class="cal-dots">${dots.join('')}</span>
        </button>`);
    }
    day += 1;
  }

  const title = `${year}년 ${monthIndex + 1}월`;
  return { title, headerRow, cells: cells.join('') };
}

function formatCalendarDayDetail(data, iso) {
  const onSprints = sprintsOnDate(iso, data.sprints);
  const events = data.timeline.filter((e) => e.date === iso);
  const gates = data.approvals.filter((g) => g.plannedDate === iso);
  const resolvedMilestones = resolveMilestonePhases(data.sprints, data.releaseMilestones);
  const onReleaseMilestones = releaseMilestonesOnDate(iso, resolvedMilestones);

  if (!onSprints.length && !events.length && !gates.length && !onReleaseMilestones.length) {
    return `<p class="cal-detail-empty">이 날짜에 등록된 스프린트·이벤트·승인·오픈 마일스톤 일정이 없습니다.</p>`;
  }

  let html = `<div class="cal-detail-date">${iso}</div>`;
  if (onSprints.length) {
    html += '<div class="cal-detail-block"><strong>스프린트</strong><ul>';
    onSprints.forEach((s) => {
      html += `<li>${s.name} (${s.startDate} ~ ${s.endDate}) ${statusBadge(s.status)}</li>`;
    });
    html += '</ul></div>';
  }
  if (events.length) {
    html += '<div class="cal-detail-block"><strong>타임라인</strong><ul>';
    events.forEach((e) => {
      html += `<li><span class="log-type log-type-${e.type}">${e.type}</span> ${e.title}</li>`;
    });
    html += '</ul></div>';
  }
  if (gates.length) {
    html += '<div class="cal-detail-block"><strong>승인 게이트 (예정)</strong><ul>';
    gates.forEach((g) => {
      html += `<li>#${g.id} ${g.name} ${statusBadge(g.status)}</li>`;
    });
    html += '</ul></div>';
  }
  if (onReleaseMilestones.length) {
    html += '<div class="cal-detail-block"><strong>오픈 단계 마일스톤 (계획 완료일)</strong><ul>';
    onReleaseMilestones.forEach((p) => {
      html += `<li>${p.name} <code class="cal-milestone-id">${p.id}</code> ${statusBadge(p.status)}</li>`;
    });
    html += '</ul></div>';
  }
  return html;
}

function renderCalendarSection(data) {
  const { y, m } = initialCalendarYM(data.project);
  const { title, headerRow, cells } = buildCalendarGridHTML(data, y, m);

  return `
    <div class="section" id="calendar-section" data-cal-year="${y}" data-cal-month="${m}">
      <div class="section-title">일정·진행 달력</div>
      <div class="card cal-card">
        <p class="cal-intro">스프린트 기간·타임라인 마일스톤·오픈 단계 마일스톤(스프린트 종료일 연동)·승인 예정일을 한 달 단위로 확인합니다. 날짜를 누르면 상세가 아래에 표시됩니다.</p>
        <div class="cal-toolbar">
          <button type="button" class="cal-nav-btn" data-cal-nav="prev" aria-label="이전 달">◀</button>
          <div class="cal-month-title" id="cal-month-title">${title}</div>
          <button type="button" class="cal-nav-btn" data-cal-nav="next" aria-label="다음 달">▶</button>
        </div>
        <div class="cal-grid" id="cal-grid">
          ${headerRow}
          ${cells}
        </div>
        <div class="cal-legend">
          <span><i class="cal-legend-swatch cal-legend-sprint"></i> 스프린트 기간</span>
          <span><i class="cal-legend-swatch cal-legend-active"></i> 진행 중 스프린트</span>
          <span><i class="cal-dot cal-dot-milestone"></i> 타임라인 마일스톤</span>
          <span><i class="cal-dot cal-dot-release"></i> 오픈 단계 마일스톤</span>
          <span><i class="cal-dot cal-dot-decision"></i> 의사결정</span>
          <span><i class="cal-dot cal-dot-asset"></i> 자산·기타</span>
          <span><i class="cal-dot cal-dot-gate"></i> 승인 예정</span>
        </div>
        <div class="cal-detail" id="cal-detail">
          <div class="cal-detail-placeholder">날짜를 선택하세요.</div>
        </div>
      </div>
    </div>`;
}

function refreshCalendarMonth(data) {
  const section = document.getElementById('calendar-section');
  if (!section) return;
  const y = parseInt(section.dataset.calYear, 10);
  const m = parseInt(section.dataset.calMonth, 10);
  const { title, headerRow, cells } = buildCalendarGridHTML(data, y, m);
  document.getElementById('cal-month-title').textContent = title;
  document.getElementById('cal-grid').innerHTML = headerRow + cells;
}

function bindCalendarEvents(data) {
  const section = document.getElementById('calendar-section');
  if (!section) return;

  section.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-cal-nav]');
    if (nav) {
      let y = parseInt(section.dataset.calYear, 10);
      let m = parseInt(section.dataset.calMonth, 10);
      if (nav.dataset.calNav === 'prev') {
        m -= 1;
        if (m < 0) {
          m = 11;
          y -= 1;
        }
      } else {
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
      }
      section.dataset.calYear = String(y);
      section.dataset.calMonth = String(m);
      refreshCalendarMonth(data);
      return;
    }

    const cell = e.target.closest('.cal-cell[data-date]:not(.cal-cell-muted)');
    if (!cell) return;
    const iso = cell.dataset.date;
    document.getElementById('cal-detail').innerHTML = formatCalendarDayDetail(data, iso);
    section.querySelectorAll('.cal-cell-selected').forEach((el) => el.classList.remove('cal-cell-selected'));
    cell.classList.add('cal-cell-selected');
  });
}

function renderOverview(data) {
  const { project, sprints } = data;
  const current = sprints.find(s => s.status === '진행중') || sprints[0];
  const assetsHTML = Object.entries(project.assets)
    .map(
      ([, v]) =>
        `<div class="overview-asset-row">
          <span class="overview-asset-desc">${v.description}</span>
          <span class="overview-asset-badge">${statusBadge(v.status)}</span>
        </div>`
    )
    .join('');
  const teamHTML = project.team
    .map(t => `<div style="font-size:13px;padding:4px 0"><strong>${t.role}</strong> (${t.harnessRole}) &times;${t.count}</div>`)
    .join('');
  const sourceLoc =
    project.legacySourceRoot && project.legacySourceNote
      ? `<div class="card" style="grid-column:1/-1;margin-top:12px">
          <div class="card-label">레거시 소스 위치 (1차 확보)</div>
          <div style="font-size:14px;font-weight:600;margin-bottom:6px"><code style="font-size:13px">${project.legacySourceRoot}</code></div>
          <p style="font-size:12px;color:var(--text-muted);margin:0;line-height:1.5">${project.legacySourceNote}</p>
        </div>`
      : '';

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
        ${sourceLoc}
      </div>
    </div>`;
}

function renderReleaseMilestones(data) {
  const rm = data.releaseMilestones;
  if (!rm || !Array.isArray(rm.phases) || rm.phases.length === 0) return '';
  const phases = resolveMilestonePhases(data.sprints, rm);
  const byId = {};
  (data.sprints || []).forEach((s) => {
    byId[s.id] = s;
  });

  const stepsRow = phases
    .map((p, i) => {
      const last = i === phases.length - 1;
      return `
        <div class="milestone-step${last ? ' milestone-step-last' : ''}" data-phase="${p.id}">
          <div class="milestone-step-row">
            <div class="milestone-step-circle" aria-hidden="true">${i + 1}</div>
            ${last ? '' : '<div class="milestone-step-connector" aria-hidden="true"></div>'}
          </div>
          <div class="milestone-step-label">${p.name}</div>
        </div>`;
    })
    .join('');

  const cards = phases
    .map((p) => {
      const planDate = p.effectiveDate
        ? `<span class="milestone-plan-date">${p.effectiveDate}</span>`
        : '<span class="milestone-plan-date milestone-plan-date-unknown">미정</span>';
      const sprintLines = (p.sprintIds || [])
        .map((sid) => {
          const s = byId[sid];
          if (s) return `<li><span class="milestone-sprint-ref">#${sid}</span> ${s.name} <span class="milestone-sprint-end">~ ${s.endDate}</span></li>`;
          return `<li><span class="milestone-sprint-ref">#${sid}</span> <em class="milestone-sprint-missing">스프린트 목록에 없음</em></li>`;
        })
        .join('');
      const goals =
        Array.isArray(p.goals) && p.goals.length
          ? `<ul class="milestone-goals">${p.goals.map((g) => `<li>${g}</li>`).join('')}</ul>`
          : '';
      const exit =
        p.exitCriteria && String(p.exitCriteria).trim()
          ? `<div class="milestone-exit"><strong>완료 기준</strong> ${p.exitCriteria}</div>`
          : '';
      const summary = p.summary ? `<p class="milestone-summary">${p.summary}</p>` : '';
      const foot =
        p.scheduleUnresolved || !p.effectiveDate
          ? '<p class="milestone-footnote">계획 완료일은 sprintIds와 sprints.json의 endDate로 계산됩니다. 미정이면 sprintIds·id를 확인하세요.</p>'
          : '';

      return `
        <article class="milestone-card" data-phase="${p.id}">
          <div class="milestone-card-head">
            <h3 class="milestone-card-title">${p.name}</h3>
            ${statusBadge(p.status)}
          </div>
          ${summary}
          <div class="milestone-card-meta">
            <span class="milestone-meta-label">계획 완료일</span>
            ${planDate}
          </div>
          <div class="milestone-card-meta">
            <span class="milestone-meta-label">연결 스프린트</span>
            <ul class="milestone-sprint-list">${sprintLines || '<li class="milestone-sprint-empty">없음</li>'}</ul>
          </div>
          ${goals}
          ${exit}
          ${foot}
        </article>`;
    })
    .join('');

  return `
    <div class="section" id="release-milestones-section">
      <div class="section-title">${rm.title || '오픈 단계 마일스톤'}</div>
      ${rm.description ? `<p class="milestone-section-desc">${rm.description}</p>` : ''}
      <div class="milestone-track">
        <div class="milestone-steps" role="list">${stepsRow}</div>
        <div class="milestone-cards">${cards}</div>
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

function renderTodoFlow(data) {
  const { todoFlow, todos } = data;
  if (!todoFlow || !todoFlow.phases) return '';

  const taskMap = buildTaskMap(todos);
  const gateMap = {};
  (todoFlow.gates || []).forEach((g) => {
    gateMap[g.id] = g;
  });

  const legendHTML = `
    <div class="flow-legend card">
      <div class="flow-legend-title">범례</div>
      <div class="flow-legend-grid">
        <div><span class="flow-badge flow-badge-parallel">병렬</span> ${todoFlow.legend?.parallel || ''}</div>
        <div><span class="flow-badge flow-badge-serial">직렬</span> ${todoFlow.legend?.serial || ''}</div>
      </div>
      <p class="flow-desc">${todoFlow.description || ''}</p>
    </div>`;

  const gatesHTML =
    (todoFlow.gates || []).length > 0
      ? `<div class="flow-gates card">
      <div class="flow-gates-title">마일스톤 게이트</div>
      <ul class="flow-gates-list">
        ${todoFlow.gates
          .map(
            (g) => `
        <li><strong>${g.id}</strong> — ${g.name}<br><span class="flow-gate-note">${g.note || ''}</span></li>`
          )
          .join('')}
      </ul>
    </div>`
      : '';

  const phasesHTML = todoFlow.phases
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((phase) => {
      const gateLabel = phase.gateAfter && gateMap[phase.gateAfter]
        ? `<div class="flow-phase-gate">선행 조건: <strong>${gateMap[phase.gateAfter].name}</strong></div>`
        : '';

      const stagesHTML = (phase.stages || [])
        .map((stage) => {
          const modeLabel =
            stage.mode === 'parallel'
              ? '<span class="flow-badge flow-badge-parallel">병렬</span>'
              : '<span class="flow-badge flow-badge-serial">직렬</span>';
          const cards = (stage.taskIds || [])
            .map((tid) => {
              const t = taskMap[tid];
              const title = t ? t.task : `(정의 없음: ${tid})`;
              const done = t?.done ? ' flow-task-done' : '';
              const roleShort = t?.roleCode || '?';
              return `
            <div class="flow-task${done}">
              <div class="flow-task-meta"><span class="flow-task-id">${tid}</span><span class="flow-task-role">${roleShort}</span></div>
              <div class="flow-task-title">${title}</div>
            </div>`;
            })
            .join('');
          const wrapClass = stage.mode === 'parallel' ? 'flow-stage flow-stage-parallel' : 'flow-stage flow-stage-serial';
          return `
        <div class="${wrapClass}">
          <div class="flow-stage-head">${modeLabel} <span class="flow-stage-label">${stage.label || ''}</span></div>
          <div class="flow-task-row">${cards}</div>
        </div>`;
        })
        .join('');

      return `
    <div class="flow-phase card">
      <div class="flow-phase-head">
        <span class="flow-phase-order">${phase.order}</span>
        <div>
          <div class="flow-phase-name">${phase.name}</div>
          ${gateLabel}
        </div>
      </div>
      <div class="flow-phases-stages">${stagesHTML}</div>
    </div>`;
    })
    .join('');

  const depHTML =
    (todoFlow.dependencyNotes || []).length > 0
      ? `<div class="card flow-deps">
      <div class="section-title" style="margin-bottom:12px">선행 관계 요약</div>
      <ul class="flow-deps-list">
        ${todoFlow.dependencyNotes
          .map(
            (d) => `
        <li><strong>${(d.taskIds || []).join(', ')}</strong> — ${d.requires}</li>`
          )
          .join('')}
      </ul>
    </div>`
      : '';

  return `
    <div class="section">
      <div class="section-title">${todoFlow.title || '전체 To-Do 흐름'}</div>
      ${legendHTML}
      ${gatesHTML}
      <div class="flow-timeline">${phasesHTML}</div>
      ${depHTML}
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
          <div class="gate-desc">${g.description} | 승인: ${g.approvers.join(', ')}${g.plannedDate ? ' | 예정: ' + g.plannedDate : ''}${g.approvedDate ? ' | 승인일: ' + g.approvedDate : ''}</div>
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
        <div style="font-size:13px;margin-bottom:8px"><strong>기간:</strong> ${sprint.weeks}${sprint.startDate && sprint.endDate ? ` (${sprint.startDate} ~ ${sprint.endDate})` : ''}</div>
        <div style="font-size:13px;margin-bottom:8px"><strong>목표:</strong> ${sprint.goal}</div>
        <div style="font-size:13px;margin-bottom:8px"><strong>완료 기준:</strong> ${sprint.exitCriteria}</div>
        <div class="progress-bar"><div class="fill fill-primary" style="width:${sprint.progress}%"></div></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">진행률: ${sprint.progress}%</div>
      `;
    });
  });
}

async function init() {
  const app = document.getElementById('app');
  try {
    const data = await loadAll();
    app.innerHTML = [
      renderOverview(data),
      renderCalendarSection(data),
      renderReleaseMilestones(data),
      renderTimeline(data),
      renderTodos(data),
      renderTodoFlow(data),
      renderHarness(data),
      renderDeliverables(data),
      renderApprovals(data),
      renderEval(data),
      renderRisks(data),
      renderLog(data),
    ].join('');
    bindEvents(data);
    bindCalendarEvents(data);
  } catch (err) {
    app.innerHTML = `
      <div class="section">
        <div class="card" style="border-color:var(--danger)">
          <div class="section-title" style="margin-bottom:8px">데이터 로드 실패</div>
          <p style="font-size:13px;margin-bottom:8px">JSON 파일을 불러오지 못했습니다. GitHub Pages는 저장소 이름이 경로에 포함됩니다. 아래 URL이 브라우저에서 열리는지 확인하세요.</p>
          <code style="font-size:11px;word-break:break-all;display:block;padding:8px;background:var(--surface-alt);border-radius:6px">${DATA_PATH}project.json</code>
          <p style="font-size:12px;color:var(--text-muted);margin-top:12px">${String(err.message || err)}</p>
        </div>
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
