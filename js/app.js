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
  const [
    project,
    sprints,
    todos,
    todoFlow,
    harness,
    deliverables,
    approvals,
    risks,
    timeline,
    evalSummary,
    releaseMilestones,
    dbStatus,
    dbSchemaAnalysis,
    webPortingProgress,
    humanActionItems,
    portingScreens,
  ] = await Promise.all([
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
    loadJSON('db-status.json'),
    loadJSON('db-schema-analysis.json'),
    loadJSON('web-porting-progress.json'),
    loadJSON('human-action-items.json'),
    loadJSON('porting-screens.json'),
  ]);
  return {
    project,
    sprints,
    todos,
    todoFlow,
    harness,
    deliverables,
    approvals,
    risks,
    timeline,
    evalSummary,
    releaseMilestones,
    dbStatus,
    dbSchemaAnalysis,
    webPortingProgress,
    humanActionItems,
    portingScreens,
  };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    '연결됨': 'badge-done',
    '실패': 'badge-danger',
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

function renderDbStatusCard(dbStatus) {
  if (!dbStatus || !Array.isArray(dbStatus.hosts) || !dbStatus.hosts.length) return '';
  const meta = [
    dbStatus.checkedAt ? `측정 시각: ${dbStatus.checkedAt}` : '',
    dbStatus.pocStatus ? `POC: ${dbStatus.pocStatus}` : '',
    dbStatus.mysqlPort != null ? `MySQL/MariaDB 포트: ${dbStatus.mysqlPort}` : '',
    dbStatus.clientCharset ? `클라이언트 문자집합: ${dbStatus.clientCharset}` : '',
    dbStatus.sshPortNote || '',
    dbStatus.charsetNote || '',
    dbStatus.implementationNote || '',
  ]
    .filter(Boolean)
    .map((line) => `<div class="db-status-meta-line">${line}</div>`)
    .join('');
  const summary = `<div class="db-status-summary">${dbStatus.successCount ?? 0} / ${dbStatus.totalHosts ?? dbStatus.hosts.length}대 연결 성공</div>`;
  const rows = dbStatus.hosts
    .map((h) => {
      const st = h.reachable ? '연결됨' : '실패';
      const detail = h.detail ? `<div class="db-status-detail">${h.detail}</div>` : '';
      return `<div class="overview-asset-row db-status-host-row">
        <span class="overview-asset-desc"><code class="db-status-ip">${h.host}</code>${detail}</span>
        <span class="overview-asset-badge">${statusBadge(st)}</span>
      </div>`;
    })
    .join('');
  return `<div class="card db-status-card" style="grid-column:1/-1;margin-top:12px">
    <div class="card-label">MariaDB 접속 점검 (호스트별)</div>
    ${summary}
    <div class="db-status-meta">${meta}</div>
    <div class="db-status-host-list">${rows}</div>
  </div>`;
}

function renderDbSchemaAnalysisCard(schema) {
  if (!schema || !Array.isArray(schema.servers) || !schema.servers.length) return '';
  const meta = [
    schema.updatedAt ? `갱신: ${schema.updatedAt}` : '',
    schema.tooling && schema.tooling.extractScript
      ? `추출: <code style="font-size:11px">${schema.tooling.extractScript}</code>`
      : '',
    schema.tooling && schema.tooling.localOutput
      ? `로컬 산출: <code style="font-size:11px">${schema.tooling.localOutput}</code>`
      : '',
  ]
    .filter(Boolean)
    .map((line) => `<div class="db-status-meta-line">${line}</div>`)
    .join('');
  const rows = schema.servers
    .map(
      (s) =>
        `<div class="overview-asset-row db-status-host-row">
        <span class="overview-asset-desc"><code class="db-status-ip">${s.id}</code> · ${s.label || ''}<br/><span style="font-size:11px;color:var(--text-muted)">${s.extractionMode} · 테이블 ${s.tableCount}</span></span>
        <span class="overview-asset-badge">${statusBadge('연결됨')}</span>
      </div>`
    )
    .join('');
  const diffLines = (schema.diffPairs || [])
    .map(
      (d) =>
        `<li style="margin:4px 0;font-size:12px"><strong>${d.label || d.left + ' vs ' + d.right}</strong>: 공통 ${d.commonTables}, 우측만 +${d.onlyInRight || 0}, 좌측만 ${d.onlyInLeft || 0}, 컬럼 이슈 ${d.columnIssues}${d.ddlDiffs != null ? `, DDL차 ${d.ddlDiffs}` : ''}</li>`
    )
    .join('');
  const bullets = (schema.executiveSummary || [])
    .map((t) => `<li style="margin:4px 0;font-size:12px;line-height:1.45">${t}</li>`)
    .join('');
  return `<div class="card db-status-card" style="grid-column:1/-1;margin-top:0">
    <div class="card-label">DB 스키마 메타 분석 (포팅 대비)</div>
    <div class="db-status-meta">${meta}</div>
    <div class="db-status-host-list">${rows}</div>
    <div style="margin-top:10px;font-size:12px;color:var(--text-muted)"><strong>주요 diff</strong><ul style="margin:6px 0;padding-left:18px">${diffLines || '<li>—</li>'}</ul></div>
    <div style="margin-top:8px;font-size:12px;color:var(--text-muted)"><strong>요약</strong><ul style="margin:6px 0;padding-left:18px">${bullets || '<li>—</li>'}</ul></div>
    <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">전체 리포트: 저장소 docs/db-schema-porting-readiness.md</div>
  </div>`;
}

function renderWebPortingProgressSection(data) {
  const p = data.webPortingProgress;
  const dbHtml = renderDbSchemaAnalysisCard(data.dbSchemaAnalysis);
  const blocks = p && Array.isArray(p.blocks) ? p.blocks : [];
  const hasPorting = blocks.length > 0;
  if (!hasPorting && !dbHtml) return '';

  let portingBody = '';
  if (hasPorting) {
    const meta = [p.updatedAt ? `갱신: ${escapeHtml(p.updatedAt)}` : '', p.phase ? escapeHtml(p.phase) : '']
      .filter(Boolean)
      .join(' · ');
    const metaLine = meta ? `<p style="font-size:12px;color:var(--text-muted);margin:0 0 8px">${meta}</p>` : '';
    const note = p.productNote
      ? `<p style="font-size:12px;color:var(--text-muted);margin:0 0 12px;line-height:1.5">${escapeHtml(p.productNote)}</p>`
      : '';
    const docLinks = (p.docLinks || [])
      .map((l) => `<li style="margin:4px 0;font-size:12px"><code style="font-size:11px">${escapeHtml(l.path)}</code> — ${escapeHtml(l.label)}</li>`)
      .join('');
    const docBlock = docLinks
      ? `<div style="margin-top:12px;font-size:12px;color:var(--text-muted)"><strong>참고 문서</strong><ul style="margin:6px 0;padding-left:18px">${docLinks}</ul></div>`
      : '';
    const cards = blocks
      .map((block) => {
        const items = (block.items || [])
          .map((item) => `<li style="margin:6px 0">${escapeHtml(item)}</li>`)
          .join('');
        return `<div class="card">
          <div class="card-label">${escapeHtml(block.title)}</div>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--text-muted)">${items}</ul>
        </div>`;
      })
      .join('');
    portingBody = `
      <div class="section-title">웹 제품(도서물류) 포팅 진행 현황</div>
      ${metaLine}
      ${note}
      <div class="grid grid-4">${cards}</div>
      ${docBlock}`;
  }

  const dbTitle = dbHtml
    ? `<div class="section-title" style="margin-top:${hasPorting ? '24px' : '0'}">DB 스키마 메타 분석 (포팅 대비)</div>`
    : '';

  return `
    <div class="section" id="web-porting-progress-section">
      ${portingBody}
      ${dbTitle}
      ${dbHtml || ''}
    </div>`;
}

function renderHumanActionItems(data) {
  const ha = data.humanActionItems;
  if (!ha || !Array.isArray(ha.categories) || ha.categories.length === 0) return '';

  const allItems = ha.categories.flatMap((c) => c.items || []);
  const total = allItems.length;
  const counts = { '대기': 0, '진행중': 0, '완료': 0, '지연': 0 };
  allItems.forEach((it) => { if (counts[it.status] != null) counts[it.status] += 1; });
  const doneRate = total ? Math.round((counts['완료'] / total) * 100) : 0;

  const summaryHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-label">사람 처리 진행 요약</div>
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:6px 0 10px">
        <div style="font-size:24px;font-weight:700">${counts['완료']} / ${total}</div>
        <div style="font-size:12px;color:var(--text-muted)">완료 ${counts['완료']} · 진행중 ${counts['진행중']} · 대기 ${counts['대기']}${counts['지연'] ? ' · 지연 ' + counts['지연'] : ''}</div>
      </div>
      <div class="progress-bar"><div class="fill ${doneRate >= 80 ? 'fill-success' : 'fill-primary'}" style="width:${doneRate}%"></div></div>
      ${ha.description ? `<p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;line-height:1.55">${escapeHtml(ha.description)}</p>` : ''}
      ${ha.updatedAt ? `<p style="font-size:11px;color:var(--text-muted);margin:6px 0 0">갱신: ${escapeHtml(ha.updatedAt)}</p>` : ''}
    </div>`;

  const catHTML = ha.categories.map((cat) => {
    const items = (cat.items || []).map((it) => {
      const outputs = (it.outputs || []).map((o) => `<li style="margin:2px 0">${escapeHtml(o)}</li>`).join('');
      const blocks = (it.blocks || []).map((b) => `<span class="badge badge-wait" style="margin-right:4px">${escapeHtml(b)}</span>`).join('');
      const trackerLine = it.tracker
        ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">트래커: <code style="font-size:11px">${escapeHtml(it.tracker)}</code></div>`
        : '';
      const ownerLine = it.owner
        ? `<div style="font-size:11px;color:var(--text-muted)">담당: ${escapeHtml(it.owner)}${it.due ? ' · 기한 ' + escapeHtml(it.due) : ''}</div>`
        : '';
      const outBlock = outputs
        ? `<div style="margin-top:6px;font-size:12px"><strong>산출/결과 반영</strong><ul style="margin:4px 0;padding-left:18px;color:var(--text-muted)">${outputs}</ul></div>`
        : '';
      const blockLine = blocks
        ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">차단되는 게이트/단계: ${blocks}</div>`
        : '';
      return `
        <div class="card" style="padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <div style="font-size:11px;color:var(--text-muted)"><code style="font-size:11px">${escapeHtml(it.id)}</code></div>
              <div style="font-size:14px;font-weight:600;margin-top:2px">${escapeHtml(it.title)}</div>
              ${ownerLine}
              ${trackerLine}
            </div>
            <div>${statusBadge(it.status || '대기')}</div>
          </div>
          ${outBlock}
          ${blockLine}
        </div>`;
    }).join('');
    return `
      <div style="margin-top:14px">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">${escapeHtml(cat.title)}</div>
        ${cat.description ? `<p style="font-size:12px;color:var(--text-muted);margin:0 0 8px;line-height:1.5">${escapeHtml(cat.description)}</p>` : ''}
        <div class="grid grid-2">${items}</div>
      </div>`;
  }).join('');

  return `
    <div class="section" id="human-action-items-section">
      <div class="section-title">${escapeHtml(ha.title || '사람 처리 필요 항목')}</div>
      ${summaryHTML}
      ${catHTML}
    </div>`;
}

function tStatusLabel(status) {
  return {
    not_started: '미착수',
    in_progress: '진행중',
    review: '리뷰',
    done: '완료',
    blocked: '차단',
  }[status] || status || '미착수';
}

function scenarioProgress(sc) {
  const tasks = sc.tasks || {};
  const keys = Object.keys(tasks);
  if (!keys.length) return { done: 0, total: 0, pct: 0 };
  const done = keys.filter((k) => tasks[k]?.status === 'done').length;
  return { done, total: keys.length, pct: Math.round((done / keys.length) * 100) };
}

function aggregateProgress(scenarios) {
  let done = 0;
  let total = 0;
  scenarios.forEach((sc) => {
    const p = scenarioProgress(sc);
    done += p.done;
    total += p.total;
  });
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

function renderRuntimeCheck(rc) {
  if (!rc || typeof rc !== 'object') return '';
  const routes = Array.isArray(rc.backend_routes_registered)
    ? rc.backend_routes_registered.map((r) => `<li><code style="font-size:11px">${escapeHtml(r)}</code></li>`).join('')
    : '';
  const url = rc.browser_url
    ? `<li>브라우저 진입 URL: <a href="${escapeHtml(rc.browser_url)}" target="_blank" rel="noopener noreferrer"><code style="font-size:11px">${escapeHtml(rc.browser_url)}</code></a></li>`
    : '';
  return `
    <div style="margin-top:10px;font-size:12px">
      <div style="font-weight:600;margin-bottom:4px">런타임 검증 ${rc.performed_at ? `<span style="color:var(--text-muted);font-weight:400">(${escapeHtml(rc.performed_at)})</span>` : ''}</div>
      <ul style="margin:0;padding-left:18px;color:var(--text-muted)">
        ${url}
        ${routes ? `<li>등록 라우트: <ul style="margin:2px 0;padding-left:18px">${routes}</ul></li>` : ''}
        ${rc.result ? `<li>결과: ${escapeHtml(rc.result)}</li>` : ''}
      </ul>
    </div>`;
}

function renderHotfixes(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const items = list.map((h) => {
    const files = Array.isArray(h.files) && h.files.length
      ? `<ul style="margin:2px 0;padding-left:18px">${h.files.map((f) => `<li><code style="font-size:11px">${escapeHtml(f)}</code></li>`).join('')}</ul>`
      : '';
    return `
      <li style="margin-bottom:6px">
        <span style="font-family:ui-monospace,monospace;font-size:11px;color:var(--primary-light)">${escapeHtml(h.id || '')}</span>
        ${h.date ? ` <span style="color:var(--text-muted);font-size:11px">(${escapeHtml(h.date)})</span>` : ''}
        <div style="margin:2px 0;line-height:1.45">${escapeHtml(h.summary || '')}</div>
        ${files}
        ${h.verified_by ? `<div style="font-size:11px;color:var(--text-muted)">검증: ${escapeHtml(h.verified_by)}</div>` : ''}
      </li>`;
  }).join('');
  return `
    <div style="margin-top:10px;font-size:12px">
      <div style="font-weight:600;margin-bottom:4px">핫픽스 / 후속 보강</div>
      <ul style="margin:0;padding-left:18px;color:var(--text-muted)">${items}</ul>
    </div>`;
}

function renderDeferrals(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const items = list.map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  return `
    <div style="margin-top:10px;font-size:12px">
      <div style="font-weight:600;margin-bottom:4px">1차 보류 / 후속 이관</div>
      <ul style="margin:0;padding-left:18px;color:var(--text-muted)">${items}</ul>
    </div>`;
}

function renderPortingScreens(data) {
  const ps = data.portingScreens;
  if (!ps || !Array.isArray(ps.scenarios) || ps.scenarios.length === 0) return '';

  const stages = ps.stages || [];
  const stageById = {};
  stages.forEach((s) => { stageById[s.id] = s; });

  const approvalsById = {};
  (data.approvals || []).forEach((a) => { approvalsById[a.id] = a; });

  const scenarios = [...ps.scenarios].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const totals = aggregateProgress(scenarios);

  const stageOrder = (ps.dashboardOrder && ps.dashboardOrder.length)
    ? ps.dashboardOrder
    : stages.map((s) => s.id);

  const stageBars = stageOrder.map((sid) => {
    const stage = stageById[sid];
    if (!stage) return '';
    const inStage = scenarios.filter((sc) => sc.stage === sid);
    const agg = aggregateProgress(inStage);
    return `
      <div style="margin:6px 0">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:2px">
          <span>단계 ${sid} · ${escapeHtml(stage.name)}</span>
          <span>${agg.done}/${agg.total} (${agg.pct}%)</span>
        </div>
        <div class="progress-bar"><div class="fill ${agg.pct >= 80 ? 'fill-success' : 'fill-primary'}" style="width:${agg.pct}%"></div></div>
      </div>`;
  }).join('');

  const lines = ps.lines || {};
  const lineKeys = Object.keys(lines);
  const lineBars = lineKeys.map((lk) => {
    const line = lines[lk];
    const members = (line.members || []);
    const memberScenarios = scenarios.filter((sc) => members.includes(sc.id));
    const agg = aggregateProgress(memberScenarios);
    return `
      <div style="margin:6px 0">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:2px">
          <span>${escapeHtml(line.label || lk)} (${members.join(', ')})</span>
          <span>${agg.done}/${agg.total} (${agg.pct}%)</span>
        </div>
        <div class="progress-bar"><div class="fill ${agg.pct >= 80 ? 'fill-success' : 'fill-primary'}" style="width:${agg.pct}%"></div></div>
      </div>`;
  }).join('');

  const summaryHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-label">시나리오·T1~T8 진행 요약</div>
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:6px 0 10px">
        <div style="font-size:24px;font-weight:700">${totals.done} / ${totals.total}</div>
        <div style="font-size:12px;color:var(--text-muted)">T 단계 완료 (시나리오 ${scenarios.length}건 × T1~T8 = ${totals.total}건)</div>
      </div>
      <div class="progress-bar" style="margin-bottom:12px"><div class="fill ${totals.pct >= 80 ? 'fill-success' : 'fill-primary'}" style="width:${totals.pct}%"></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:8px">
        <div>
          <div style="font-size:12px;font-weight:600;margin-bottom:4px">단계별 진행률</div>
          ${stageBars}
        </div>
        <div>
          <div style="font-size:12px;font-weight:600;margin-bottom:4px">라인별 진행률</div>
          ${lineBars || '<div style="font-size:11px;color:var(--text-muted)">라인 정의 없음</div>'}
        </div>
      </div>
      ${ps.updatedAt ? `<p style="font-size:11px;color:var(--text-muted);margin:10px 0 0">갱신: ${escapeHtml(ps.updatedAt)} · 트래커: <code style="font-size:11px">dashboard/data/porting-screens.json</code> · 계획서: <code style="font-size:11px">${escapeHtml(ps.planDoc || 'docs/core-scenarios-porting-plan.md')}</code></p>` : ''}
    </div>`;

  const lineFilters = [
    { key: 'all', label: '전체', members: scenarios.map((s) => s.id) },
    ...lineKeys.map((lk) => ({ key: lk, label: lines[lk].label || lk, members: lines[lk].members || [] })),
  ];
  const filterTabsHTML = lineFilters.map((f, i) =>
    `<button class="tab ${i === 0 ? 'active' : ''}" data-porting-line="${escapeHtml(f.key)}" data-porting-members="${escapeHtml((f.members || []).join(','))}">${escapeHtml(f.label)}</button>`
  ).join('');

  const tList = ['T1','T2','T3','T4','T5','T6','T7','T8'];
  const taskTemplate = ps.taskTemplate || {};

  const stageGroupsHTML = stageOrder.map((sid) => {
    const stage = stageById[sid];
    if (!stage) return '';
    const inStage = scenarios.filter((sc) => sc.stage === sid);
    if (!inStage.length) return '';
    const stageGate = stage.gateId ? approvalsById[stage.gateId] : null;
    const stageGateLine = stageGate
      ? `<span class="flow-badge flow-badge-serial" style="margin-left:8px">게이트 #${stageGate.id} · ${escapeHtml(stageGate.name)}</span>`
      : '';

    const cards = inStage.map((sc) => {
      const prog = scenarioProgress(sc);
      const gate = sc.gateId ? approvalsById[sc.gateId] : null;
      const chips = tList.map((tk) => {
        const t = sc.tasks?.[tk] || { status: 'not_started' };
        const fullTitle = `${tk} · ${taskTemplate[tk] || ''}\n상태: ${tStatusLabel(t.status)}${t.note ? '\n메모: ' + t.note : ''}`;
        return `<span class="porting-tchip" data-status="${escapeHtml(t.status || 'not_started')}" title="${escapeHtml(fullTitle)}">${tk}</span>`;
      }).join('');

      const meta = [
        `단계 ${sc.stage}`,
        sc.delphi && sc.delphi.menu_path ? `메뉴 ${sc.delphi.menu_path}` : '',
        sc.permission_keys && sc.permission_keys.length ? `권한 ${sc.permission_keys.join('/')}` : '',
        gate ? `게이트 #${gate.id}` : '',
        sc.db_impact ? `DB ${sc.db_impact}` : '',
      ].filter(Boolean).join(' · ');

      const delphi = sc.delphi || {};
      const relatedForms = (delphi.related_forms || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('');
      const routes = (sc.web?.routes || []).map((r) => `<li><code style="font-size:11px">${escapeHtml(r)}</code></li>`).join('');
      const endpoints = (sc.web?.endpoints || []).map((r) => `<li><code style="font-size:11px">${escapeHtml(r)}</code></li>`).join('');
      const backend = (sc.web?.backend || []).map((r) => `<li><code style="font-size:11px">${escapeHtml(r)}</code></li>`).join('');
      const frontend = (sc.web?.frontend || []).map((r) => `<li><code style="font-size:11px">${escapeHtml(r)}</code></li>`).join('');
      const subs = (sc.subscenarios_absorbed || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');

      // 1차 포팅 화면 바로가기(web.app_url) — 정의된 경우에만 노출.
      // 일반화: 어느 시나리오든 web.app_url 만 채우면 동일하게 버튼이 추가됨.
      const appUrl = sc.web && sc.web.app_url ? String(sc.web.app_url) : '';
      const appUrlButton = appUrl
        ? `<a class="porting-app-link" href="${escapeHtml(appUrl)}" target="_blank" rel="noopener noreferrer" title="웹 화면 열기 (${escapeHtml(appUrl)})">화면 열기 ↗</a>`
        : '';

      return `
        <div class="card porting-screen-card" data-scenario-id="${escapeHtml(sc.id)}" style="padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
            <div style="min-width:0;flex:1">
              <div style="font-size:11px;color:var(--text-muted)"><code style="font-size:11px">${escapeHtml(sc.id)}</code></div>
              <div style="font-size:14px;font-weight:600;margin-top:2px">${escapeHtml(sc.name)}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtml(meta)}</div>
            </div>
            <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <div style="font-size:18px;font-weight:700">${prog.pct}%</div>
              <div style="font-size:11px;color:var(--text-muted)">${prog.done}/${prog.total}</div>
              ${appUrlButton}
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin:4px 0 8px;line-height:1.45">${escapeHtml(sc.summary || sc.purpose || '')}</div>
          <div class="porting-tchip-row">${chips}</div>
          <div class="progress-bar" style="margin-top:8px"><div class="fill ${prog.pct >= 80 ? 'fill-success' : 'fill-primary'}" style="width:${prog.pct}%"></div></div>
          <details style="margin-top:10px">
            <summary style="font-size:12px;cursor:pointer;color:var(--text-muted)">세부 정보 (델파이 폼 · 웹 라우트 · 산출물)</summary>
            <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px">
              <div>
                <div style="font-weight:600;margin-bottom:4px">델파이</div>
                <ul style="margin:0;padding-left:18px;color:var(--text-muted)">
                  <li>주 폼: <code style="font-size:11px">${escapeHtml(delphi.primary_form || '-')}</code></li>
                  <li>유닛: <code style="font-size:11px">${escapeHtml(delphi.primary_unit || '-')}</code></li>
                  <li>DFM: <code style="font-size:11px">${escapeHtml(delphi.dfm || '-')}</code></li>
                  ${relatedForms ? `<li>관련: <ul style="margin:2px 0;padding-left:18px">${relatedForms}</ul></li>` : ''}
                </ul>
              </div>
              <div>
                <div style="font-weight:600;margin-bottom:4px">웹 (제안)</div>
                <ul style="margin:0;padding-left:18px;color:var(--text-muted)">
                  ${routes ? `<li>라우트: <ul style="margin:2px 0;padding-left:18px">${routes}</ul></li>` : ''}
                  ${endpoints ? `<li>엔드포인트: <ul style="margin:2px 0;padding-left:18px">${endpoints}</ul></li>` : ''}
                  ${backend ? `<li>백엔드: <ul style="margin:2px 0;padding-left:18px">${backend}</ul></li>` : ''}
                  ${frontend ? `<li>프론트엔드: <ul style="margin:2px 0;padding-left:18px">${frontend}</ul></li>` : ''}
                </ul>
              </div>
            </div>
            <div style="margin-top:10px;font-size:12px">
              <div style="font-weight:600;margin-bottom:4px">산출물</div>
              <ul style="margin:0;padding-left:18px;color:var(--text-muted)">
                <li>Migration Contract: <code style="font-size:11px">${escapeHtml(sc.contract || '-')}</code></li>
                <li>Test Pack: <code style="font-size:11px">${escapeHtml(sc.testpack || '-')}</code></li>
                ${sc.evaluation_report ? `<li>5축 평가 보고서: <code style="font-size:11px">${escapeHtml(sc.evaluation_report)}</code></li>` : ''}
                ${sc.phase1_test_results ? `<li>1차 테스트: <code style="font-size:11px">${escapeHtml(sc.phase1_test_results)}</code></li>` : ''}
                ${subs ? `<li>흡수된 하위 시나리오: <ul style="margin:2px 0;padding-left:18px">${subs}</ul></li>` : ''}
                ${gate ? `<li>게이트 의존: <strong>#${gate.id} ${escapeHtml(gate.name)}</strong> (예정 ${escapeHtml(gate.plannedDate || '-')})</li>` : ''}
              </ul>
            </div>
            ${renderRuntimeCheck(sc.runtime_check)}
            ${renderHotfixes(sc.hotfixes)}
            ${renderDeferrals(sc.deferrals)}
          </details>
        </div>`;
    }).join('');

    return `
      <div class="porting-stage-group" data-stage="${sid}" style="margin-top:14px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <div style="font-size:14px;font-weight:600">단계 ${sid} — ${escapeHtml(stage.name)}</div>
          ${stageGateLine}
        </div>
        <div class="grid grid-2">${cards}</div>
      </div>`;
  }).join('');

  return `
    <div class="section" id="porting-screens-section">
      <div class="section-title">${escapeHtml(ps.title || '핵심 10 시나리오 — 화면 단위 포팅 진행')}</div>
      ${summaryHTML}
      <div class="card" style="padding:10px;margin-bottom:8px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">라인 필터</div>
        <div class="tabs" id="porting-line-tabs">${filterTabsHTML}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:8px">상태 색: <span class="porting-tchip" data-status="not_started">미착수</span> <span class="porting-tchip" data-status="in_progress">진행중</span> <span class="porting-tchip" data-status="review">리뷰</span> <span class="porting-tchip" data-status="done">완료</span> <span class="porting-tchip" data-status="blocked">차단</span></div>
      </div>
      ${stageGroupsHTML}
      <p style="font-size:11px;color:var(--text-muted);margin-top:14px;line-height:1.55">운영 규칙은 <code style="font-size:11px">${escapeHtml(ps.planDoc || 'docs/core-scenarios-porting-plan.md')}</code> §5 참조. 상태 갱신은 트래커 JSON 편집(DEC-002 정적 사이트 원칙).</p>
    </div>`;
}

function renderOverview(data) {
  const { project, sprints, dbStatus } = data;
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
        ${renderDbStatusCard(dbStatus)}
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
      <div class="section-title">표준 산출물 (${done}/${deliverables.length} 완료)</div>
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

  document.querySelectorAll('#porting-line-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#porting-line-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const lineKey = tab.dataset.portingLine;
      const members = (tab.dataset.portingMembers || '').split(',').filter(Boolean);
      const memberSet = new Set(members);
      document.querySelectorAll('#porting-screens-section .porting-screen-card').forEach((card) => {
        const sid = card.dataset.scenarioId;
        card.style.display = (lineKey === 'all' || memberSet.has(sid)) ? '' : 'none';
      });
      document.querySelectorAll('#porting-screens-section .porting-stage-group').forEach((group) => {
        const visible = Array.from(group.querySelectorAll('.porting-screen-card'))
          .some((c) => c.style.display !== 'none');
        group.style.display = visible ? '' : 'none';
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
      renderHumanActionItems(data),
      renderWebPortingProgressSection(data),
      renderPortingScreens(data),
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
