/**
 * Analytics Continuum Engine — extends dashboard data only (no data changes).
 * Requires: schoolYears, grades, strandNames, enrolleesData, dropoutsData, repeatersData,
 * teacherJHS, shsAcademic, shsTVL, strandEnrollment, jhsSubjects, getYearTotals, getStrandTotals
 */
(function () {
    const CLASS_TARGET = 40;
    const SEAT_CAPACITY = 45;

    /** Ordinary least-squares linear regression on indexed series. */
    function linearRegression(values) {
        const n = values.length;
        if (!n) return { slope: 0, intercept: 0, r2: 0, predict: () => 0, residuals: [], stdErr: 0 };
        const points = values.map((y, x) => ({ x, y }));
        if (n === 1) {
            return { slope: 0, intercept: values[0], r2: 0, predict: () => values[0], residuals: [0], stdErr: 0 };
        }
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
        points.forEach(p => {
            sumX += p.x; sumY += p.y; sumXY += p.x * p.y;
            sumX2 += p.x * p.x; sumY2 += p.y * p.y;
        });
        const denom = n * sumX2 - sumX * sumX;
        const slope = denom ? (n * sumXY - sumX * sumY) / denom : 0;
        const intercept = (sumY - slope * sumX) / n;
        const yMean = sumY / n;
        let ssTot = 0, ssRes = 0;
        const residuals = points.map(p => {
            const fit = slope * p.x + intercept;
            ssRes += (p.y - fit) ** 2;
            ssTot += (p.y - yMean) ** 2;
            return p.y - fit;
        });
        const r2 = ssTot ? Math.max(0, 1 - ssRes / ssTot) : 0;
        const stdErr = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
        return {
            slope, intercept, r2,
            predict: x => Math.max(0, Math.round(slope * x + intercept)),
            residuals, stdErr
        };
    }

    /** Grade-to-grade cohort survival across consecutive school years. */
    function buildCohortSurvival() {
        const cohorts = [];
        for (let g = 0; g < grades.length - 1; g++) {
            const transitions = [];
            for (let yi = 0; yi < schoolYears.length - 1; yi++) {
                const yr = schoolYears[yi];
                const nextYr = schoolYears[yi + 1];
                const base = enrolleesData[yr]?.[g] || 0;
                const carried = enrolleesData[nextYr]?.[g + 1] || 0;
                if (base > 0) {
                    transitions.push({
                        fromYear: yr,
                        toYear: nextYr,
                        base,
                        carried,
                        survivalPct: Math.min(100, (carried / base) * 100),
                        attritionPct: Math.max(0, 100 - Math.min(100, (carried / base) * 100))
                    });
                }
            }
            if (transitions.length) {
                const avgSurvival = transitions.reduce((a, t) => a + t.survivalPct, 0) / transitions.length;
                cohorts.push({
                    entryGrade: grades[g],
                    nextGrade: grades[g + 1],
                    transitions,
                    avgSurvival
                });
            }
        }
        return cohorts;
    }

    function buildYearMetrics(year) {
        const idx = schoolYears.indexOf(year);
        const prevYear = idx > 0 ? schoolYears[idx - 1] : null;
        const enrol = [...(enrolleesData[year] || Array(6).fill(0))];
        const drop = [...(dropoutsData[year] || Array(6).fill(0))];
        const rep = [...(repeatersData[year] || Array(6).fill(0))];
        const tJHS = [...(teacherJHS[year] || Array(8).fill(0))];
        const shsA = shsAcademic[idx] || 0;
        const shsT = shsTVL[idx] || 0;
        const totalEnrol = enrol.reduce((a, b) => a + b, 0);
        const totalDrop = drop.reduce((a, b) => a + b, 0);
        const totalRep = rep.reduce((a, b) => a + b, 0);
        const totalTeachers = tJHS.reduce((a, b) => a + b, 0) + shsA + shsT;
        const strandData = strandEnrollment[year] || {};
        const strandTotals = strandNames.map(s => {
            const v = strandData[s] || { g11: 0, g12: 0 };
            return { name: s, g11: v.g11, g12: v.g12, total: v.g11 + v.g12 };
        });
        const shsEnrol = (enrol[4] || 0) + (enrol[5] || 0);
        const classroomsNeeded = enrol.map(e => (e > 0 ? Math.ceil(e / CLASS_TARGET) : 0));
        const seatCapacity = classroomsNeeded.map(c => c * SEAT_CAPACITY);
        const seatUtil = enrol.map((e, i) => (seatCapacity[i] ? (e / seatCapacity[i]) * 100 : 0));
        const classUtil = enrol.map((e, i) => (classroomsNeeded[i] ? (e / (classroomsNeeded[i] * CLASS_TARGET)) * 100 : 0));
        const dropoutRates = enrol.map((e, i) => (e ? (drop[i] / e) * 100 : 0));
        const repeaterRates = enrol.map((e, i) => (e ? (rep[i] / e) * 100 : 0));
        const ratio = totalTeachers ? totalEnrol / totalTeachers : 0;
        const retention = totalEnrol ? ((1 - totalDrop / totalEnrol) * 100) : 0;
        const prevEnrol = prevYear ? (enrolleesData[prevYear]?.reduce((a, b) => a + b, 0) || 0) : null;
        const enrolDelta = prevEnrol != null ? totalEnrol - prevEnrol : null;
        const enrolDeltaPct = prevEnrol ? ((enrolDelta / prevEnrol) * 100) : null;
        const subjectRatios = jhsSubjects.map((sub, i) => ({
            subject: sub,
            teachers: tJHS[i] || 0,
            ratio: tJHS[i] ? (enrol.slice(0, 4).reduce((a, b) => a + b, 0) / tJHS[i]).toFixed(1) : '—'
        }));
        const highRiskGrades = grades.map((g, i) => ({
            grade: g,
            dropoutRate: dropoutRates[i],
            repeaterRate: repeaterRates[i],
            enrol: enrol[i],
            riskScore: dropoutRates[i] * 0.6 + repeaterRates[i] * 0.4
        })).sort((a, b) => b.riskScore - a.riskScore);
        const overcrowded = grades.map((g, i) => ({
            grade: g,
            enrol: enrol[i],
            classrooms: classroomsNeeded[i],
            seatUtil: seatUtil[i],
            overcapacity: seatUtil[i] > 100
        })).filter(x => x.overcapacity || x.seatUtil > 95);
        const lowSubjects = subjectRatios.filter(s => parseFloat(s.ratio) > 45);
        const minEnrolIdx = enrol.indexOf(Math.min(...enrol.filter(e => e > 0).length ? enrol : [0]));
        const lowestGrades = [...grades].sort((a, b) => enrol[grades.indexOf(a)] - enrol[grades.indexOf(b)]).slice(0, 2);
        return {
            year, prevYear, enrol, drop, rep, tJHS, shsA, shsT, totalEnrol, totalDrop, totalRep, totalTeachers,
            strandTotals, shsEnrol, classroomsNeeded, seatCapacity, seatUtil, classUtil, dropoutRates,
            repeaterRates, ratio, retention, prevEnrol, enrolDelta, enrolDeltaPct, subjectRatios,
            highRiskGrades, overcrowded, lowSubjects, lowestGrades, minEnrolGrade: grades[minEnrolIdx] || '—'
        };
    }

    function trendArrow(val) {
        if (val == null || val === 0) return '<span class="ac-trend neutral">→</span>';
        return val > 0 ? '<span class="ac-trend up">▲</span>' : '<span class="ac-trend down">▼</span>';
    }

    function riskBadge(level) {
        const cls = level === 'high' ? 'risk-high' : level === 'medium' ? 'risk-medium' : 'risk-low';
        return `<span class="ac-risk ${cls}">${level.toUpperCase()}</span>`;
    }

    function descriptiveNarrative(m) {
        const low = m.lowestGrades.map(g => g).join(' and ');
        const topStrand = [...m.strandTotals].sort((a, b) => b.total - a.total)[0];
        const trend = m.enrolDeltaPct != null
            ? ` Enrollment ${m.enrolDeltaPct >= 0 ? 'increased' : 'declined'} by ${Math.abs(m.enrolDeltaPct).toFixed(1)}% compared to the previous school year.`
            : '';
        return `SY ${m.year} recorded a total BOSY enrollment of <strong>${m.totalEnrol.toLocaleString()}</strong> students with ${low} showing comparatively lower grade-level distribution.${trend} SHS strand leadership is led by <strong>${topStrand?.name || 'N/A'}</strong> (${topStrand?.total || 0} students). Total dropouts: <strong>${m.totalDrop}</strong>; repeaters: <strong>${m.totalRep}</strong>. Student–teacher ratio: <strong>${m.ratio.toFixed(1)}:1</strong>. Average seat utilization: <strong>${(m.seatUtil.reduce((a, b) => a + b, 0) / 6).toFixed(1)}%</strong>.`;
    }

    function diagnosticNarrative(m) {
        const hr = m.highRiskGrades[0];
        const parts = [];
        if (m.enrolDelta != null) {
            parts.push(m.enrolDelta < 0
                ? `Enrollment declined by ${Math.abs(m.enrolDelta)} students versus ${m.prevYear}, which may reflect demographic shifts or increased attrition in transitional grades.`
                : `Enrollment grew by ${m.enrolDelta} students versus ${m.prevYear}, indicating strengthened intake or improved retention at entry grades.`);
        }
        if (hr) {
            parts.push(`<strong>${hr.grade}</strong> presents the highest composite risk (dropout ${hr.dropoutRate.toFixed(1)}%, repeater ${hr.repeaterRate.toFixed(1)}%).`);
        }
        if (m.overcrowded.length) {
            parts.push(`Overcapacity signals appear in ${m.overcrowded.map(o => o.grade).join(', ')} where seat utilization exceeds 95%.`);
        }
        if (m.lowSubjects.length) {
            parts.push(`Teacher allocation pressure may exist in ${m.lowSubjects.map(s => s.subject).join(', ')} where student–teacher ratios exceed recommended thresholds.`);
        }
        return parts.join(' ') || 'Insufficient comparative data for diagnostic conclusions; add prior-year records for deeper analysis.';
    }

    function predictiveInsights(m) {
        const hist = schoolYears.map(yr => ({
            yr,
            enrol: enrolleesData[yr]?.reduce((a, b) => a + b, 0) || 0,
            drop: dropoutsData[yr]?.reduce((a, b) => a + b, 0) || 0
        }));
        const enrolSeries = hist.map(h => h.enrol);
        const dropSeries = hist.map(h => h.drop);
        const regEnrol = linearRegression(enrolSeries);
        const regDrop = linearRegression(dropSeries);
        const idx = schoolYears.indexOf(m.year);
        const nextX = hist.length;
        const forecastEnrol = regEnrol.predict(nextX);
        const forecastEnrol2 = regEnrol.predict(nextX + 1);
        const forecastDrop = regDrop.predict(nextX);
        const growth = enrolSeries.length >= 2 && enrolSeries[enrolSeries.length - 2]
            ? (enrolSeries[enrolSeries.length - 1] - enrolSeries[enrolSeries.length - 2]) / enrolSeries[enrolSeries.length - 2]
            : regEnrol.slope / (m.totalEnrol || 1);
        const strandForecast = m.strandTotals.map(s => {
            const strandHist = schoolYears.map(yr => {
                const v = strandEnrollment[yr]?.[s.name] || { g11: 0, g12: 0 };
                return v.g11 + v.g12;
            });
            const regStrand = linearRegression(strandHist);
            return {
                name: s.name,
                current: s.total,
                projected: regStrand.predict(strandHist.length),
                r2: regStrand.r2
            };
        });
        const futureRatio = m.totalTeachers ? (forecastEnrol / m.totalTeachers).toFixed(1) : '—';
        const classroomShortage = m.classroomsNeeded.reduce((a, b) => a + b, 0);
        const projectedRooms = Math.ceil(forecastEnrol / CLASS_TARGET);
        const band = regEnrol.stdErr * 1.96;
        const comboLabels = [...hist.map(h => h.yr), 'Proj +1', 'Proj +2'];
        const comboActual = [...enrolSeries, null, null];
        const comboForecast = enrolSeries.map((_, i) => regEnrol.predict(i));
        comboForecast.push(forecastEnrol, forecastEnrol2);
        const comboUpper = comboForecast.map((v, i) => (i >= enrolSeries.length - 1 ? v + band : null));
        const comboLower = comboForecast.map((v, i) => (i >= enrolSeries.length - 1 ? Math.max(0, v - band) : null));
        const dropForecastLine = dropSeries.map((_, i) => regDrop.predict(i));
        dropForecastLine.push(regDrop.predict(dropSeries.length));
        return {
            forecastEnrol, forecastEnrol2, forecastDrop, strandForecast, futureRatio,
            classroomShortage, projectedRooms,
            growthPct: (growth * 100).toFixed(1),
            hist,
            regEnrol, regDrop,
            comboLabels, comboActual, comboForecast, comboUpper, comboLower,
            dropForecastLine, dropSeries
        };
    }

    /** Multi-condition prescription rules — all matching conditions fire. */
    function prescriptiveActions(m, pred, cohorts) {
        const hr = m.highRiskGrades[0];
        const weakestCohort = [...cohorts].sort((a, b) => a.avgSurvival - b.avgSurvival)[0];
        const avgCohortSurvival = cohorts.length
            ? cohorts.reduce((a, c) => a + c.avgSurvival, 0) / cohorts.length
            : 100;
        const regSlopeUp = pred.regEnrol.slope > 0;
        const regR2Strong = pred.regEnrol.r2 >= 0.65;

        const rules = [
            {
                priority: 'high',
                title: 'Retention intervention',
                conditions: ['high_risk_grade', 'low_retention'],
                match: hr && m.retention < 94,
                text: `Deploy targeted retention in ${hr.grade} (risk score ${hr.riskScore.toFixed(1)}); school retention is ${m.retention.toFixed(1)}%.`
            },
            {
                priority: 'high',
                title: 'Cohort survival recovery',
                conditions: ['weak_cohort', 'cohort_below_threshold'],
                match: weakestCohort && weakestCohort.avgSurvival < 88,
                text: `${weakestCohort.entryGrade}→${weakestCohort.nextGrade} cohort survival averages ${weakestCohort.avgSurvival.toFixed(1)}% — prioritize transition support and guidance counseling.`
            },
            {
                priority: 'high',
                title: 'Classroom balancing',
                conditions: ['overcapacity', 'growth_forecast'],
                match: m.overcrowded.length > 0 && parseFloat(pred.growthPct) > 0,
                text: `Rebalance ${m.overcrowded.map(o => o.grade).join(', ')} while enrollment trend is +${pred.growthPct}% (linear slope ${pred.regEnrol.slope.toFixed(0)}/yr).`
            },
            {
                priority: 'high',
                title: 'Classroom balancing (urgent)',
                conditions: ['overcapacity'],
                match: m.overcrowded.length > 0,
                text: `Rebalance sections in ${m.overcrowded.map(o => o.grade).join(', ')} or add teaching stations; seat utilization exceeds 95%.`
            },
            {
                priority: 'medium',
                title: 'Staffing plan',
                conditions: ['teacher_load', 'ratio_pressure'],
                match: m.lowSubjects.length > 0 && m.ratio > 35,
                text: `Redeploy or hire for ${m.lowSubjects.map(s => s.subject).join(', ')}; overall ratio ${m.ratio.toFixed(1)}:1 exceeds target.`
            },
            {
                priority: 'medium',
                title: 'Staffing plan (subject)',
                conditions: ['teacher_load'],
                match: m.lowSubjects.length > 0,
                text: `Review allocation for ${m.lowSubjects.map(s => s.subject).join(', ')} where ratios exceed thresholds.`
            },
            {
                priority: 'medium',
                title: 'Regression-based capacity plan',
                conditions: ['positive_trend', 'model_confidence'],
                match: regSlopeUp && regR2Strong,
                text: `OLS forecast: ${pred.forecastEnrol.toLocaleString()} next SY (R²=${(pred.regEnrol.r2 * 100).toFixed(0)}%). Plan ${pred.projectedRooms} classrooms.`
            },
            {
                priority: 'medium',
                title: 'Capacity planning',
                conditions: ['positive_trend'],
                match: parseFloat(pred.growthPct) > 0,
                text: `Prepare ${pred.projectedRooms} classrooms for projected enrollment (${pred.forecastEnrol.toLocaleString()} students).`
            },
            {
                priority: 'medium',
                title: 'Dropout containment',
                conditions: ['dropout_forecast_rise', 'high_dropout_rate'],
                match: pred.regDrop.slope > 0 && m.totalEnrol && (m.totalDrop / m.totalEnrol) > 0.02,
                text: `Dropout regression projects ${pred.forecastDrop} next SY — intensify early-warning for at-risk sections.`
            },
            {
                priority: 'low',
                title: 'SHS strand strategy',
                conditions: ['strand_demand_shift'],
                match: pred.strandForecast.length >= 2,
                text: (() => {
                    const top = [...m.strandTotals].sort((a, b) => b.total - a.total)[0];
                    const rising = [...pred.strandForecast].sort((a, b) => b.projected - a.projected)[0];
                    return `Maintain ${top?.name || 'lead strand'} capacity; monitor ${rising?.name} (proj. ${rising?.projected}).`;
                })()
            },
            {
                priority: 'medium',
                title: 'Data-driven monitoring',
                conditions: ['baseline'],
                match: true,
                text: `Quarterly review of dropout/repeater KPIs for SY ${m.year}; mean cohort survival ${avgCohortSurvival.toFixed(1)}%.`
            }
        ];

        const seen = new Set();
        return rules.filter(r => {
            if (!r.match || seen.has(r.title)) return false;
            seen.add(r.title);
            return true;
        }).map(r => ({
            priority: r.priority,
            title: r.title,
            text: r.text,
            conditions: r.conditions
        }));
    }

    window._acCharts = window._acCharts || [];

    function destroyACCharts() {
        (window._acCharts || []).forEach(c => { try { c.destroy(); } catch (e) {} });
        window._acCharts = [];
    }

    function acChart(ctx, config) {
        const ch = new Chart(ctx, config);
        window._acCharts.push(ch);
        return ch;
    }

    function chartOpts(tick) {
        return {
            responsive: true,
            animation: { duration: 800 },
            plugins: { legend: { labels: { color: tick } } },
            scales: {
                y: { ticks: { color: tick }, grid: { color: 'rgba(148,163,184,0.12)' } },
                x: { ticks: { color: tick }, grid: { color: 'rgba(148,163,184,0.08)' } }
            }
        };
    }

    window.setGlobalSchoolYear = function (year) {
        if (!schoolYears.includes(year)) return;
        activeDashboardYear = year;
        ['sySelector', 'acSYSelector', 'reportSYSelector'].forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value !== year) el.value = year;
        });
        const strandSel = document.getElementById('strandYearSelector');
        if (strandSel && currentView === 'shsstrands') strandSel.value = year;
        window.dispatchEvent(new CustomEvent('dmmhs:yearchange', { detail: { year } }));
    };

    window.buildYearMetrics = buildYearMetrics;
    window.linearRegression = linearRegression;
    window.buildCohortSurvival = buildCohortSurvival;
    window.destroyACCharts = destroyACCharts;

    window.renderAnalyticsContinuum = function (container) {
        destroyACCharts();
        container.className = 'view-enter ac-continuum';
        const year = activeDashboardYear || schoolYears[schoolYears.length - 1];
        const m = buildYearMetrics(year);
        const cohorts = buildCohortSurvival();
        const pred = predictiveInsights(m);
        const actions = prescriptiveActions(m, pred, cohorts);
        const tick = getComputedStyle(document.body).getPropertyValue('--chart-tick').trim() || '#CBD5E1';
        const avgCohortSurvival = cohorts.length
            ? (cohorts.reduce((a, c) => a + c.avgSurvival, 0) / cohorts.length).toFixed(1)
            : '—';
        const weakestCohort = cohorts.length
            ? [...cohorts].sort((a, b) => a.avgSurvival - b.avgSurvival)[0]
            : null;

        container.innerHTML = `
            <div class="ac-hero info-card">
                <div class="dashboard-flex">
                    <div>
                        <h3><i class="fas fa-project-diagram"></i> Analytics Continuum</h3>
                        <p class="ac-sub">Descriptive → Diagnostic → Predictive → Prescriptive · OLS Regression · Cohort Survival · Multi-Condition Rx</p>
                    </div>
                    <div><label class="ac-label">School Year</label><select id="acSYSelector" class="year-selector">${schoolYears.map(yr => `<option value="${yr}" ${yr === year ? 'selected' : ''}>${yr}</option>`).join('')}</select></div>
                </div>
            </div>

            <section class="ac-section" id="acDesc">
                <div class="ac-section-head"><span class="ac-badge badge-desc">1 · DESCRIPTIVE</span><h4>Descriptive Analytics</h4><p>What happened?</p></div>
                <p class="ac-narrative">${descriptiveNarrative(m)}</p>
                <div class="stat-grid ac-kpi-row">
                    <div class="info-card kpi-card kpi-blue"><h4>BOSY Enrollment</h4><div class="value">${m.totalEnrol.toLocaleString()}</div>${trendArrow(m.enrolDelta)}</div>
                    <div class="info-card kpi-card kpi-drop"><h4>Dropouts</h4><div class="value">${m.totalDrop}</div></div>
                    <div class="info-card kpi-card kpi-rep"><h4>Repeaters</h4><div class="value">${m.totalRep}</div></div>
                    <div class="info-card kpi-card kpi-teach"><h4>Student–Teacher</h4><div class="value">${m.ratio.toFixed(1)}:1</div></div>
                    <div class="info-card kpi-card"><h4>Retention</h4><div class="value">${m.retention.toFixed(1)}%</div></div>
                    <div class="info-card kpi-card"><h4>Avg Seat Util.</h4><div class="value">${(m.seatUtil.reduce((a,b)=>a+b,0)/6).toFixed(0)}%</div></div>
                </div>
                <div class="ac-grid-2">
                    <div class="info-card"><h4>Grade-Level Enrollment</h4><canvas id="acDescGrade"></canvas></div>
                    <div class="info-card"><h4>SHS Strand Distribution</h4><canvas id="acDescStrand"></canvas></div>
                </div>
                <div class="info-card"><h4>Utilization Summary</h4><div class="table-scroll"><table class="data-table"><thead><tr><th>Grade</th><th>Enrollment</th><th>Classrooms*</th><th>Seat Util.</th><th>Class Util.</th></tr></thead><tbody>
                    ${grades.map((g,i)=>`<tr><td><b>${g}</b></td><td>${m.enrol[i]}</td><td>${m.classroomsNeeded[i]}</td><td>${m.seatUtil[i].toFixed(1)}%</td><td>${m.classUtil[i].toFixed(1)}%</td></tr>`).join('')}
                </tbody></table></div><p class="ac-footnote">*Estimated at ${CLASS_TARGET} students/classroom, ${SEAT_CAPACITY} seats/room</p></div>
            </section>

            <section class="ac-section" id="acDiag">
                <div class="ac-section-head"><span class="ac-badge badge-diag">2 · DIAGNOSTIC</span><h4>Diagnostic Analytics</h4><p>Why did it happen?</p></div>
                <p class="ac-narrative">${diagnosticNarrative(m)}</p>
                <div class="ac-grid-2">
                    <div class="info-card"><h4>Dropout &amp; Repeater Rates by Grade</h4><canvas id="acDiagRates"></canvas></div>
                    <div class="info-card"><h4>High-Risk Grades</h4><div class="table-scroll"><table class="data-table"><thead><tr><th>Grade</th><th>Dropout %</th><th>Repeater %</th><th>Risk</th></tr></thead><tbody>
                        ${m.highRiskGrades.map(h=>`<tr><td>${h.grade}</td><td>${h.dropoutRate.toFixed(1)}%</td><td>${h.repeaterRate.toFixed(1)}%</td><td>${riskBadge(h.riskScore>8?'high':h.riskScore>4?'medium':'low')}</td></tr>`).join('')}
                    </tbody></table></div></div>
                </div>
                <div class="info-card"><h4>JHS Teacher Allocation vs Load</h4><div class="table-scroll"><table class="data-table"><thead><tr><th>Subject</th><th>Teachers</th><th>Est. Ratio (JHS)</th></tr></thead><tbody>
                    ${m.subjectRatios.map(s=>`<tr><td>${s.subject}</td><td>${s.teachers}</td><td>${s.ratio}:1</td></tr>`).join('')}
                </tbody></table></div></div>
            </section>

            <section class="ac-section" id="acCohort">
                <div class="ac-section-head"><span class="ac-badge badge-diag">COHORT</span><h4>Cohort Survival Analysis</h4><p>Grade-to-grade carry-forward across school years</p></div>
                <div class="stat-grid ac-kpi-row">
                    <div class="info-card kpi-card"><h4>Mean Cohort Survival</h4><div class="value">${avgCohortSurvival}%</div><span class="ac-hint">Across ${cohorts.length} grade transitions</span></div>
                    <div class="info-card kpi-card"><h4>Weakest Transition</h4><div class="value">${weakestCohort ? weakestCohort.entryGrade + '→' + weakestCohort.nextGrade + ' (' + weakestCohort.avgSurvival.toFixed(1) + '%)' : '—'}</div></div>
                </div>
                <div class="ac-grid-2">
                    <div class="info-card"><h4>Cohort Survival by Grade Transition (%)</h4><canvas id="acCohortSurvival"></canvas></div>
                    <div class="info-card"><h4>Transition Detail</h4><div class="table-scroll"><table class="data-table"><thead><tr><th>Transition</th><th>SY Pair</th><th>Base</th><th>Carried</th><th>Survival</th></tr></thead><tbody>
                        ${cohorts.flatMap(c => c.transitions.map(t =>
                            `<tr><td>${c.entryGrade}→${c.nextGrade}</td><td>${t.fromYear.slice(2)}→${t.toYear.slice(2)}</td><td>${t.base}</td><td>${t.carried}</td><td>${t.survivalPct.toFixed(1)}%</td></tr>`
                        )).join('')}
                    </tbody></table></div></div>
                </div>
            </section>

            <section class="ac-section" id="acPred">
                <div class="ac-section-head"><span class="ac-badge badge-pred">3 · PREDICTIVE</span><h4>Predictive Analytics</h4><p>Linear regression forecasts with confidence bands</p></div>
                <div class="stat-grid">
                    <div class="info-card kpi-card"><h4>Next SY (OLS)</h4><div class="value">${pred.forecastEnrol.toLocaleString()}</div><span class="ac-hint">Slope ${pred.regEnrol.slope.toFixed(0)}/yr</span></div>
                    <div class="info-card kpi-card"><h4>+2 SY (OLS)</h4><div class="value">${pred.forecastEnrol2.toLocaleString()}</div></div>
                    <div class="info-card kpi-card kpi-drop"><h4>Dropout Forecast</h4><div class="value">${pred.forecastDrop}</div><span class="ac-hint">R² ${(pred.regDrop.r2 * 100).toFixed(0)}%</span></div>
                    <div class="info-card kpi-card"><h4>Model Fit (Enrol)</h4><div class="value">R² ${(pred.regEnrol.r2 * 100).toFixed(0)}%</div><span class="ac-hint">OLS goodness of fit</span></div>
                    <div class="info-card kpi-card"><h4>Future Ratio</h4><div class="value">${pred.futureRatio}:1</div></div>
                </div>
                <div class="info-card ac-combo-card">
                    <h4>Combo Forecast — Enrollment (bars) + OLS trend + 95% band</h4>
                    <p class="ac-footnote">Historical bars · regression line · projected interval (±1.96×SE)</p>
                    <canvas id="acComboForecast"></canvas>
                </div>
                <div class="ac-grid-2">
                    <div class="info-card"><h4>Enrollment vs Dropout Forecast (dual axis)</h4><canvas id="acPredEnrol"></canvas></div>
                    <div class="info-card"><h4>SHS Strand Demand (OLS per strand)</h4><canvas id="acPredStrand"></canvas></div>
                </div>
            </section>

            <section class="ac-section" id="acPres">
                <div class="ac-section-head"><span class="ac-badge badge-pres">4 · PRESCRIPTIVE</span><h4>Prescriptive Analytics</h4><p>Dynamic multi-condition recommendations</p></div>
                <div class="ac-actions">
                    ${actions.map(a=>`<div class="info-card ac-action-card priority-${a.priority}">
                        <div class="ac-action-head">${riskBadge(a.priority)} <strong>${a.title}</strong></div>
                        <div class="ac-conditions">${(a.conditions||[]).map(c=>`<span class="ac-cond-tag">${c}</span>`).join('')}</div>
                        <p>${a.text}</p>
                    </div>`).join('')}
                </div>
            </section>
        `;

        document.getElementById('acSYSelector').onchange = e => {
            setGlobalSchoolYear(e.target.value);
            if (currentView === 'analytics') renderAnalyticsContinuum(container);
        };

        acChart(document.getElementById('acDescGrade').getContext('2d'), {
            type: 'bar',
            data: { labels: grades, datasets: [{ label: 'Enrollment', data: m.enrol, backgroundColor: 'rgba(56,189,248,0.75)', borderRadius: 6 }] },
            options: chartOpts(tick)
        });
        acChart(document.getElementById('acDescStrand').getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: m.strandTotals.map(s => s.name),
                datasets: [{ data: m.strandTotals.map(s => s.total), backgroundColor: ['#38BDF8','#FACC15','#A78BFA','#34D399','#FB923C','#F472B6','#94A3B8'] }]
            },
            options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: tick } } } }
        });
        acChart(document.getElementById('acDiagRates').getContext('2d'), {
            type: 'bar',
            data: {
                labels: grades,
                datasets: [
                    { label: 'Dropout %', data: m.dropoutRates, backgroundColor: 'rgba(248,113,113,0.8)' },
                    { label: 'Repeater %', data: m.repeaterRates, backgroundColor: 'rgba(250,204,21,0.8)' }
                ]
            },
            options: chartOpts(tick)
        });

        if (cohorts.length) {
            acChart(document.getElementById('acCohortSurvival').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: cohorts.map(c => `${c.entryGrade}→${c.nextGrade}`),
                    datasets: [{
                        label: 'Avg survival %',
                        data: cohorts.map(c => c.avgSurvival),
                        backgroundColor: cohorts.map(c =>
                            c.avgSurvival < 85 ? 'rgba(248,113,113,0.85)' :
                            c.avgSurvival < 92 ? 'rgba(250,204,21,0.8)' : 'rgba(52,211,153,0.8)'
                        ),
                        borderRadius: 6
                    }]
                },
                options: {
                    ...chartOpts(tick),
                    scales: {
                        ...chartOpts(tick).scales,
                        y: { ...chartOpts(tick).scales.y, max: 100, ticks: { ...chartOpts(tick).scales.y.ticks, callback: v => v + '%' } }
                    }
                }
            });
        }

        const histLen = pred.hist.length;
        acChart(document.getElementById('acComboForecast').getContext('2d'), {
            type: 'bar',
            data: {
                labels: pred.comboLabels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Actual enrollment',
                        data: pred.comboActual,
                        backgroundColor: 'rgba(56,189,248,0.55)',
                        borderRadius: 4,
                        order: 2
                    },
                    {
                        type: 'line',
                        label: 'OLS regression',
                        data: pred.comboForecast,
                        borderColor: '#FACC15',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.15,
                        pointRadius: 3,
                        order: 1
                    },
                    {
                        type: 'line',
                        label: 'Upper 95% band',
                        data: pred.comboUpper,
                        borderColor: 'rgba(52,211,153,0.5)',
                        borderDash: [4, 4],
                        fill: '+1',
                        backgroundColor: 'rgba(52,211,153,0.08)',
                        pointRadius: 0,
                        order: 0
                    },
                    {
                        type: 'line',
                        label: 'Lower 95% band',
                        data: pred.comboLower,
                        borderColor: 'rgba(52,211,153,0.35)',
                        borderDash: [4, 4],
                        pointRadius: 0,
                        order: 0
                    }
                ]
            },
            options: chartOpts(tick)
        });

        acChart(document.getElementById('acPredEnrol').getContext('2d'), {
            type: 'bar',
            data: {
                labels: pred.comboLabels.slice(0, histLen + 1),
                datasets: [
                    {
                        type: 'bar',
                        label: 'Enrollment (actual)',
                        data: [...pred.hist.map(h => h.enrol), pred.forecastEnrol],
                        backgroundColor: 'rgba(56,189,248,0.6)',
                        yAxisID: 'y',
                        order: 2
                    },
                    {
                        type: 'line',
                        label: 'Dropouts (actual/OLS)',
                        data: pred.dropForecastLine,
                        borderColor: '#F87171',
                        backgroundColor: 'rgba(248,113,113,0.12)',
                        fill: true,
                        tension: 0.25,
                        yAxisID: 'y1',
                        order: 1
                    }
                ]
            },
            options: {
                ...chartOpts(tick),
                scales: {
                    y: { type: 'linear', position: 'left', ticks: { color: tick }, grid: { color: 'rgba(148,163,184,0.12)' } },
                    y1: { type: 'linear', position: 'right', ticks: { color: tick }, grid: { drawOnChartArea: false } },
                    x: { ticks: { color: tick }, grid: { color: 'rgba(148,163,184,0.08)' } }
                }
            }
        });

        acChart(document.getElementById('acPredStrand').getContext('2d'), {
            type: 'bar',
            data: {
                labels: pred.strandForecast.map(s => s.name),
                datasets: [
                    { label: 'Current', data: pred.strandForecast.map(s => s.current), backgroundColor: 'rgba(56,189,248,0.6)' },
                    { label: 'OLS projected', data: pred.strandForecast.map(s => s.projected), backgroundColor: 'rgba(250,204,21,0.7)' }
                ]
            },
            options: chartOpts(tick)
        });
    };

    let reportChartRef = null;

    function buildReportHTML(year, tab) {
        const m = buildYearMetrics(year);
        const generated = new Date().toLocaleString('en-PH');
        const header = `
            <div class="report-header-print">
                <img src="assets/school-logo.jpg" alt="Logo" onerror="this.style.display='none'"/>
                <h2>Diosdado Macapagal Memorial Highschool</h2>
                <p>School Performance Report · SY ${year}</p>
                <p style="font-size:0.75rem;">Generated: ${generated}</p>
            </div>`;
        let body = '';
        if (tab === 'enrol' || tab === 'all') {
            body += `<div class="info-card" style="margin-bottom:1rem;"><h4>1. BOSY Enrollment Report</h4>
                <p>Total enrollment: <strong>${m.totalEnrol.toLocaleString()}</strong></p>
                <div class="table-scroll"><table class="data-table"><thead><tr><th>Grade</th><th>Enrollment</th><th>% of Total</th></tr></thead><tbody>
                ${grades.map((g,i)=>`<tr><td>${g}</td><td>${m.enrol[i]}</td><td>${m.totalEnrol?(m.enrol[i]/m.totalEnrol*100).toFixed(1):0}%</td></tr>`).join('')}
                </tbody></table></div><canvas id="reportEnrolChart" height="120"></canvas></div>`;
        }
        if (tab === 'drop' || tab === 'all') {
            body += `<div class="info-card" style="margin-bottom:1rem;"><h4>2. Dropout Report</h4>
                <p>Total dropouts: <strong>${m.totalDrop}</strong> · Rate: <strong>${m.totalEnrol?(m.totalDrop/m.totalEnrol*100).toFixed(2):0}%</strong></p>
                <div class="table-scroll"><table class="data-table"><thead><tr><th>Grade</th><th>Dropouts</th><th>Rate</th></tr></thead><tbody>
                ${grades.map((g,i)=>`<tr><td>${g}</td><td>${m.drop[i]}</td><td>${m.dropoutRates[i].toFixed(1)}%</td></tr>`).join('')}
                </tbody></table></div></div>`;
        }
        if (tab === 'rep' || tab === 'all') {
            body += `<div class="info-card" style="margin-bottom:1rem;"><h4>3. Repeater Report</h4>
                <p>Total repeaters: <strong>${m.totalRep}</strong> · Rate: <strong>${m.totalEnrol?(m.totalRep/m.totalEnrol*100).toFixed(2):0}%</strong></p>
                <div class="table-scroll"><table class="data-table"><thead><tr><th>Grade</th><th>Repeaters</th><th>Rate</th></tr></thead><tbody>
                ${grades.map((g,i)=>`<tr><td>${g}</td><td>${m.rep[i]}</td><td>${m.repeaterRates[i].toFixed(1)}%</td></tr>`).join('')}
                </tbody></table></div></div>`;
        }
        if (tab === 'ratio' || tab === 'all') {
            body += `<div class="info-card" style="margin-bottom:1rem;"><h4>4. Teacher–Student Ratio Report</h4>
                <p>Overall ratio: <strong>${m.ratio.toFixed(1)}:1</strong> (${m.totalTeachers} teachers, ${m.totalEnrol} students)</p>
                <div class="table-scroll"><table class="data-table"><thead><tr><th>Subject</th><th>Teachers</th><th>Est. Ratio</th></tr></thead><tbody>
                ${m.subjectRatios.map(s=>`<tr><td>${s.subject}</td><td>${s.teachers}</td><td>${s.ratio}:1</td></tr>`).join('')}
                <tr><td>SHS Academic</td><td>${m.shsA}</td><td>—</td></tr><tr><td>SHS TVL</td><td>${m.shsT}</td><td>—</td></tr>
                </tbody></table></div></div>`;
        }
        if (tab === 'seat' || tab === 'all') {
            body += `<div class="info-card" style="margin-bottom:1rem;"><h4>5. Seat &amp; Classroom Report</h4>
                <div class="table-scroll"><table class="data-table"><thead><tr><th>Grade</th><th>Enrollment</th><th>Classrooms</th><th>Seats</th><th>Seat Util.</th><th>Status</th></tr></thead><tbody>
                ${grades.map((g,i)=>`<tr><td>${g}</td><td>${m.enrol[i]}</td><td>${m.classroomsNeeded[i]}</td><td>${m.seatCapacity[i]}</td><td>${m.seatUtil[i].toFixed(1)}%</td><td>${m.seatUtil[i]>100?'Overcapacity':m.seatUtil[i]<70?'Underutilized':'Normal'}</td></tr>`).join('')}
                </tbody></table></div></div>`;
        }
        if (tab === 'all') {
            body += `<div class="insights-panel"><h4>Analytics Summary</h4>
                <p>${descriptiveNarrative(m)}</p><p style="margin-top:0.5rem;">${diagnosticNarrative(m)}</p></div>`;
        }
        return header + body;
    }

    window.renderReportsContinuum = function (container) {
        if (reportChartRef) try { reportChartRef.destroy(); } catch (e) {}
        container.className = 'view-enter';
        const year = activeDashboardYear || schoolYears[schoolYears.length - 1];
        let activeTab = 'all';
        container.innerHTML = `
            <div class="dashboard-flex" style="margin-bottom:0.75rem;">
                <h3><i class="fas fa-file-alt"></i> School Performance Reports</h3>
                <select id="reportSYSelector" class="year-selector">${schoolYears.map(yr => `<option value="${yr}" ${yr === year ? 'selected' : ''}>${yr}</option>`).join('')}</select>
            </div>
            <div class="report-toolbar">
                <button class="btn-primary btn-sm" id="btnReportPrint"><i class="fas fa-print"></i> Print</button>
                <button class="btn-secondary btn-sm" id="btnReportPdf"><i class="fas fa-file-pdf"></i> PDF</button>
                <button class="btn-secondary btn-sm" id="btnReportExcelFull"><i class="fas fa-file-excel"></i> Excel (All)</button>
            </div>
            <div class="report-tabs">
                <button class="report-tab active" data-tab="all">Complete Report</button>
                <button class="report-tab" data-tab="enrol">Enrollment</button>
                <button class="report-tab" data-tab="drop">Dropouts</button>
                <button class="report-tab" data-tab="rep">Repeaters</button>
                <button class="report-tab" data-tab="ratio">Teacher Ratio</button>
                <button class="report-tab" data-tab="seat">Seat &amp; Classroom</button>
            </div>
            <div class="report-print-area" id="reportPrintArea"></div>`;

        function paintReport() {
            const y = document.getElementById('reportSYSelector').value;
            document.getElementById('reportPrintArea').innerHTML = buildReportHTML(y, activeTab);
            const c = document.getElementById('reportEnrolChart');
            if (c && (activeTab === 'all' || activeTab === 'enrol')) {
                const m = buildYearMetrics(y);
                const tick = getComputedStyle(document.body).getPropertyValue('--chart-tick');
                if (reportChartRef) try { reportChartRef.destroy(); } catch (e) {}
                reportChartRef = new Chart(c.getContext('2d'), {
                    type: 'bar',
                    data: { labels: grades, datasets: [{ label: 'Enrollment', data: m.enrol, backgroundColor: '#38BDF8' }] },
                    options: { responsive: true, plugins: { legend: { labels: { color: tick } } } }
                });
            }
        }

        paintReport();
        document.getElementById('reportSYSelector').onchange = e => {
            setGlobalSchoolYear(e.target.value);
            paintReport();
        };
        container.querySelectorAll('.report-tab').forEach(btn => {
            btn.onclick = () => {
                container.querySelectorAll('.report-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeTab = btn.dataset.tab;
                paintReport();
            };
        });
        document.getElementById('btnReportPrint').onclick = () => {
            const area = document.getElementById('reportPrintArea');
            const w = window.open('', '_blank');
            w.document.write(`<html><head><title>Report SY ${document.getElementById('reportSYSelector').value}</title><link rel="stylesheet" href="css/dmmhs-enterprise-dark.css"/></head><body>${area.innerHTML}</body></html>`);
            w.document.close();
            w.print();
        };
        document.getElementById('btnReportPdf').onclick = () => {
            if (typeof html2pdf === 'undefined') { showToast('PDF library loading…'); return; }
            const el = document.getElementById('reportPrintArea');
            html2pdf().set({ margin: 10, filename: `DMMHS_Report_${document.getElementById('reportSYSelector').value}.pdf`, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } }).from(el).save();
            showToast('PDF export started', 'success');
        };
        document.getElementById('btnReportExcelFull').onclick = () => {
            if (typeof XLSX === 'undefined') return;
            const y = document.getElementById('reportSYSelector').value;
            const m = buildYearMetrics(y);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(grades.map((g, i) => ({
                Grade: g, Enrollment: m.enrol[i], Dropouts: m.drop[i], Repeaters: m.rep[i]
            }))), 'Enrollment');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(m.subjectRatios.map(s => ({
                Subject: s.subject, Teachers: s.teachers, Ratio: s.ratio
            }))), 'Teachers');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(grades.map((g, i) => ({
                Grade: g, Classrooms: m.classroomsNeeded[i], Seats: m.seatCapacity[i], SeatUtilPct: m.seatUtil[i].toFixed(1)
            }))), 'Classrooms');
            XLSX.writeFile(wb, `DMMHS_FullReport_${y.replace(/-/g, '_')}.xlsx`);
            showToast('Excel exported', 'success');
        };
    };

})();
