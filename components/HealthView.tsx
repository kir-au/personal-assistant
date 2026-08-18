'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CheckCircle2, ExternalLink, Image as ImageIcon, Loader2 } from 'lucide-react';

interface ExerciseKey {
  code: string;
  label: string;
}

interface CalorieCalibrationPlan {
  title: string;
  status: string;
  startDate: string;
  endDate: string;
  goal: {
    date: string;
    targetWeightKg: number;
    startingWeightKg: number;
    guardrailWeeklyLossPercent: { min: number; max: number };
    note: string;
  };
  baseline: {
    restingEnergyKcalPerDay: number;
    workingMaintenanceHypothesisKcalPerDay: number;
    wearableEnergyRule: string;
  };
  dailyTarget: {
    averageIntakeKcal: number;
    estimatedDeficitKcal: number;
    intakeRangeKcal: { min: number; max: number };
    note: string;
  };
  dailyCheckIn: string[];
  weeklyCheckpoints: Array<{
    label: string;
    startDate: string;
    endDate: string;
    action: string;
  }>;
  dailyRecords?: Record<string, DailyCalibrationRecord>;
}

interface DailyCalibrationRecord {
  weightKg?: number;
  intakeKcal?: number;
  fitbitTotalEnergyKcal?: number;
}

interface RehabDay {
  day: number;
  date: string;
  label: string;
  kind: string;
  title: string;
  plan: string;
  completed: boolean;
  completionStatus?: 'partial' | 'completed';
  planId?: string;
  projectId?: string;
  planTitle?: string;
  planStatus?: string;
  sourcePath?: string;
  sourceDay?: number;
  scheduledFromDate?: string;
  scheduleUpdatedAt?: string;
  actual?: {
    summary?: string;
    completed?: ActualExercise[];
    remaining?: string[];
    rawPath?: string;
    painResponse?: {
      during: string | null;
      night: string | null;
      nextDay: string | null;
    };
  };
}

interface ActualExercise {
  code: string;
  name: string;
  load: string | null;
  sets: number | null;
  reps: number | null;
}

interface RehabPlan {
  title: string;
  startDate: string;
  goal: string;
  rule: string;
  exerciseKey: ExerciseKey[];
  notes: string[];
  days: RehabDay[];
  todayDate: string;
  today: RehabDay | null;
  upcoming?: RehabDay | null;
  plans?: Array<{
    id: string;
    projectId: string;
    title: string;
    status: string;
    startDate: string | null;
    goal: string;
    rule: string;
    sourcePath: string;
    today: RehabDay | null;
    upcoming: RehabDay | null;
    days: RehabDay[];
    notes: string[];
  }>;
  activityLog?: HealthActivityEntry[];
  calorieCalibration?: CalorieCalibrationPlan | null;
}

interface HealthActivityEntry {
  date: string;
  loggedAt?: string;
  updatedAt?: string;
  source?: string;
  rawPath?: string;
  status: string;
  summary: string;
  activities?: LoggedActivity[];
  calories?: {
    method?: string;
    bodyWeightKg?: number;
    totalEstimatedCalories?: number;
    quality?: string;
    assumptions?: string[];
  };
  notes?: string[];
}

interface LoggedActivity {
  code: string;
  name: string;
  durationMin?: number | null;
  distanceKm?: number | null;
  pace?: string;
  load?: string | null;
  reps?: number | null;
  met?: number;
  estimatedCalories?: number | null;
}

interface Exercise {
  code: string;
  name: string;
  image?: string;
  images?: string[];
  dose: string;
  why: string;
  how: string;
  avoid: string;
  source?: string;
  reviewStatus?: 'reviewed' | 'needs-visual-confirmation';
  sourceLabel?: string;
  imageSource?: string;
  imageSourceLabel?: string;
}

interface ExerciseLibrary {
  exercises: Exercise[];
}

const kindStyle: Record<string, string> = {
  home: 'border-blue-300 bg-blue-50',
  gym: 'border-emerald-300 bg-emerald-50',
  recovery: 'border-amber-300 bg-amber-50',
  off: 'border-slate-300 bg-slate-50',
  review: 'border-violet-300 bg-violet-50',
  'run-quality': 'border-red-300 bg-red-50',
  'run-long': 'border-sky-300 bg-sky-50',
  kettlebell: 'border-cyan-300 bg-cyan-50',
  activity: 'border-emerald-300 bg-emerald-50',
  plan: 'border-slate-300 bg-slate-50',
};

export default function HealthView() {
  const [plan, setPlan] = useState<RehabPlan | null>(null);
  const [exerciseLibrary, setExerciseLibrary] = useState<Exercise[]>([]);
  const [selectedExerciseCode, setSelectedExerciseCode] = useState<string | null>(null);
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);
  const [moveDate, setMoveDate] = useState('');
  const [movingSession, setMovingSession] = useState(false);
  const [moveMessage, setMoveMessage] = useState('');
  const [calibrationDrafts, setCalibrationDrafts] = useState<Record<string, DailyCalibrationRecord>>({});
  const [savingCalibrationDate, setSavingCalibrationDate] = useState<string | null>(null);
  const [calibrationMessage, setCalibrationMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const dayRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const hasFocusedTimelineRef = useRef(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/health/project?ts=${Date.now()}`, { cache: 'no-store' }).then((res) => res.json()),
      fetch('/api/health/exercises').then((res) => res.json()).catch(() => ({ exercises: [] })),
    ])
      .then(([planData, exerciseData]: [RehabPlan, ExerciseLibrary]) => {
        setPlan(planData);
        setCalibrationDrafts(planData.calorieCalibration?.dailyRecords || {});
        setExerciseLibrary(exerciseData.exercises || []);
        const requestedDay = typeof window !== 'undefined'
          ? Number(new URLSearchParams(window.location.search).get('day'))
          : NaN;
        const planDays = buildDisplayedDays(planData);
        const initialDay = planDays.find((day) => day.day === requestedDay)
          || planData.today
          || planData.upcoming
          || planDays.find((day) => day.date >= planData.todayDate)
          || planDays.at(-1)
          || null;
        setSelectedDayNumber(initialDay?.day || null);
        setMoveDate(initialDay?.date || '');
        const firstTodayCode = extractExerciseCodes(initialDay?.plan || '', exerciseData.exercises || [])[0];
        setSelectedExerciseCode(firstTodayCode || null);
      })
      .finally(() => setLoading(false));
  }, []);

  const exerciseByCode = useMemo(() => {
    return Object.fromEntries(exerciseLibrary.map((exercise) => [exercise.code, exercise]));
  }, [exerciseLibrary]);

  const selectedExercise = selectedExerciseCode ? exerciseByCode[selectedExerciseCode] : null;
  const selectedExerciseImages = selectedExercise
    ? selectedExercise.images?.length
      ? selectedExercise.images
      : selectedExercise.image
        ? [selectedExercise.image]
        : []
    : [];
  const activityByDate = useMemo(() => {
    const map = new Map<string, HealthActivityEntry[]>();
    for (const entry of plan?.activityLog || []) {
      const entries = map.get(entry.date) || [];
      entries.push(entry);
      map.set(entry.date, entries);
    }
    return map;
  }, [plan?.activityLog]);
  const displayedDays = useMemo(() => {
    return plan ? buildDisplayedDays(plan) : [];
  }, [plan]);
  const selectedDay = useMemo(() => {
    if (!plan) return null;
    return displayedDays.find((day) => day.day === selectedDayNumber) || plan.today || plan.upcoming || displayedDays[0] || null;
  }, [displayedDays, plan, selectedDayNumber]);
  const calibrationDates = useMemo(() => {
    if (!plan?.calorieCalibration) return [];
    return buildDateRange(plan.calorieCalibration.startDate, plan.calorieCalibration.endDate);
  }, [plan?.calorieCalibration]);

  const updateCalibrationDraft = (date: string, field: keyof DailyCalibrationRecord, value: string) => {
    setCalibrationDrafts((current) => ({
      ...current,
      [date]: {
        ...current[date],
        [field]: value === '' ? undefined : Number(value),
      },
    }));
  };

  const saveCalibrationRecord = async (date: string) => {
    setSavingCalibrationDate(date);
    setCalibrationMessage('');
    try {
      const response = await fetch('/api/health/calorie-calibration', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, record: calibrationDrafts[date] || {} }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save calibration record.');
      setPlan((current) => current ? { ...current, calorieCalibration: result.calorieCalibration } : current);
      setCalibrationDrafts(result.calorieCalibration.dailyRecords || {});
      setCalibrationMessage(`Saved ${formatShortDate(date)}.`);
    } catch (error) {
      setCalibrationMessage(error instanceof Error ? error.message : 'Unable to save calibration record.');
    } finally {
      setSavingCalibrationDate(null);
    }
  };

  useLayoutEffect(() => {
    if (!selectedDayNumber || hasFocusedTimelineRef.current) return;
    const timeline = timelineRef.current;
    const yesterday = displayedDays.find((day) => day.date === addCalendarDays(plan?.todayDate || '', -1));
    const memoryRow = yesterday ? dayRefs.current[yesterday.day] : null;
    if (!timeline || !memoryRow) return;
    hasFocusedTimelineRef.current = true;

    const focusYesterday = () => {
      focusTimelineRow(timeline, memoryRow);
    };
    let nestedFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      nestedFrame = window.requestAnimationFrame(() => {
        focusYesterday();
      });
    });
    const restorationFrame = window.setTimeout(focusYesterday, 250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nestedFrame);
      window.clearTimeout(restorationFrame);
    };
  }, [displayedDays, plan?.todayDate, selectedDayNumber]);

  const selectDay = (day: RehabDay) => {
    setSelectedDayNumber(day.day);
    setMoveDate(day.date);
    setMoveMessage('');
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'health');
      url.searchParams.set('day', String(day.day));
      window.history.replaceState(null, '', url.toString());
    }
    const firstCode = extractExerciseCodes(day.plan, exerciseLibrary)[0];
    setSelectedExerciseCode(firstCode || null);
  };

  const moveSession = async (day: RehabDay, toDate: string) => {
    if (!day.planId || !day.sourceDay || !toDate || day.date === toDate) return;
    setMovingSession(true);
    setMoveMessage('');
    try {
      const response = await fetch('/api/health/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: day.planId,
          sourceDay: day.sourceDay,
          toDate,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to move this session.');

      const refreshed = await fetch(`/api/health/project?ts=${Date.now()}`, { cache: 'no-store' }).then((res) => res.json()) as RehabPlan;
      setPlan(refreshed);
      const movedDay = buildDisplayedDays(refreshed).find(
        (candidate) => candidate.planId === day.planId && candidate.sourceDay === day.sourceDay
      );
      setSelectedDayNumber(movedDay?.day || null);
      setMoveDate(movedDay?.date || toDate);
      setMoveMessage(`Moved to ${formatLongDate(toDate)}.`);
    } catch (error) {
      setMoveMessage(error instanceof Error ? error.message : 'Unable to move this session.');
    } finally {
      setMovingSession(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-on-surface-variant">Loading health plan...</div>;
  }

  if (!plan) {
    return <div className="rounded-lg border border-border bg-surface p-4">Health plan is not available.</div>;
  }

  return (
    <div className="flex w-full max-w-[1440px] flex-col gap-4 pb-8">
      {plan.calorieCalibration ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Active calibration</p>
              <h3 className="mt-1 text-lg font-semibold text-on-surface">{plan.calorieCalibration.title}</h3>
              <p className="mt-1 text-sm text-on-surface-variant">
                {formatLongDate(plan.calorieCalibration.startDate)} to {formatLongDate(plan.calorieCalibration.endDate)}. Use weight and intake to calibrate Fitbit; do not discard its activity data.
              </p>
            </div>
            <span className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900">
              {plan.calorieCalibration.status}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <CalibrationMetric label="Starting weight" value={`${plan.calorieCalibration.goal.startingWeightKg} kg`} />
            <CalibrationMetric label="Initial intake average" value={`${plan.calorieCalibration.dailyTarget.averageIntakeKcal} kcal/day`} />
            <CalibrationMetric label="Maintenance hypothesis" value={`${plan.calorieCalibration.baseline.workingMaintenanceHypothesisKcalPerDay} kcal/day`} />
            <CalibrationMetric label="Year-end operating target" value={`${plan.calorieCalibration.goal.targetWeightKg} kg`} />
          </div>
          <p className="mt-3 text-sm text-on-surface">
            <strong>Daily:</strong> morning weight, estimated food and alcohol, Fitbit total energy, steps, heart rate, sleep, exercise, and morning alertness. Health Connect export energy remains a separate labelled field.
          </p>
          <div className="mt-3 overflow-x-auto rounded border border-amber-200 bg-white">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="bg-amber-100 text-on-surface">
                <tr>
                  <th className="px-3 py-2 font-semibold">Period</th>
                  <th className="px-3 py-2 font-semibold">Dates</th>
                  <th className="px-3 py-2 font-semibold">Decision</th>
                </tr>
              </thead>
              <tbody>
                {plan.calorieCalibration.weeklyCheckpoints.map((checkpoint) => (
                  <tr key={checkpoint.label} className="border-t border-amber-100">
                    <td className="px-3 py-2 font-medium text-on-surface">{checkpoint.label}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{formatShortDate(checkpoint.startDate)} - {formatShortDate(checkpoint.endDate)}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{checkpoint.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 overflow-hidden rounded border border-amber-200 bg-white">
            <div className="border-b border-amber-200 px-3 py-2">
              <p className="text-sm font-semibold text-on-surface">Daily calibration ledger</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">Fitbit Total Energy is entered from the Fitbit app. Health Connect export energy is read-only and remains a separate field.</p>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="sticky top-0 bg-amber-100 text-on-surface">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Weight kg</th>
                    <th className="px-3 py-2 font-semibold">Food kcal</th>
                    <th className="px-3 py-2 font-semibold">Fitbit total kcal</th>
                    <th className="px-3 py-2 font-semibold">HC export kcal</th>
                    <th className="px-3 py-2 font-semibold">Fitbit - food</th>
                    <th className="px-3 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {calibrationDates.map((date) => {
                    const record = calibrationDrafts[date] || plan.calorieCalibration?.dailyRecords?.[date] || {};
                    const deviceEnergy = (activityByDate.get(date) || [])
                      .filter((entry) => entry.source === 'health-connect')
                      .reduce((sum, entry) => sum + (entry.calories?.totalEstimatedCalories || 0), 0);
                    const fitbitMargin = record.fitbitTotalEnergyKcal !== undefined && record.intakeKcal !== undefined
                      ? record.fitbitTotalEnergyKcal - record.intakeKcal
                      : null;
                    return (
                      <tr key={date} className="border-t border-amber-100">
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-on-surface">{formatShortDate(date)}</td>
                        <td className="px-3 py-2"><CalibrationInput value={record.weightKg} onChange={(value) => updateCalibrationDraft(date, 'weightKg', value)} step="0.1" label={`Weight for ${date}`} /></td>
                        <td className="px-3 py-2"><CalibrationInput value={record.intakeKcal} onChange={(value) => updateCalibrationDraft(date, 'intakeKcal', value)} label={`Food calories for ${date}`} /></td>
                        <td className="px-3 py-2"><CalibrationInput value={record.fitbitTotalEnergyKcal} onChange={(value) => updateCalibrationDraft(date, 'fitbitTotalEnergyKcal', value)} label={`Fitbit total energy for ${date}`} /></td>
                        <td className="px-3 py-2 text-on-surface-variant">{deviceEnergy ? `${Math.round(deviceEnergy)} kcal` : '-'}</td>
                        <td className="px-3 py-2 font-medium text-on-surface">{fitbitMargin === null ? '-' : `${Math.round(fitbitMargin)} kcal`}</td>
                        <td className="px-3 py-2"><button type="button" onClick={() => saveCalibrationRecord(date)} disabled={savingCalibrationDate === date} className="h-8 rounded border border-amber-400 bg-white px-2.5 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50">{savingCalibrationDate === date ? 'Saving...' : 'Save'}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {calibrationMessage ? <p className="mt-2 text-xs text-on-surface-variant">{calibrationMessage}</p> : null}
          <p className="mt-3 text-xs text-on-surface-variant">{plan.calorieCalibration.dailyTarget.note}</p>
        </section>
      ) : null}
      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-on-surface">Plan timeline</h3>
            <p className="text-xs text-on-surface-variant">Yesterday&apos;s recorded activity stays above today; scroll back for the past 7 days.</p>
          </div>
          <span className="text-xs text-on-surface-variant">
            {displayedDays[0]?.label} - {displayedDays[displayedDays.length - 1]?.label}
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[140px_112px_120px_1fr] bg-surface-variant px-3 py-2 text-xs font-semibold text-on-surface">
            <div>Plan</div>
            <div>Date</div>
            <div>Type</div>
            <div>Plan</div>
          </div>
          <div ref={timelineRef} className="max-h-[460px] overflow-y-auto">
            {displayedDays.map((day) => {
              const isToday = day.date === plan.todayDate;
              const isSelected = day.day === selectedDay?.day;
              const isPast = plan.today && day.date < plan.todayDate;
              const dayActivities = activityByDate.get(day.date) || [];
              const estimatedActivityEnergy = dayActivities
                .filter((entry) => entry.calories?.quality !== 'unverified')
                .reduce((sum, entry) => sum + (entry.calories?.totalEstimatedCalories || 0), 0);
              const unverifiedDeviceEnergy = dayActivities
                .filter((entry) => entry.calories?.quality === 'unverified')
                .reduce((sum, entry) => sum + (entry.calories?.totalEstimatedCalories || 0), 0);
              const canMove = Boolean(
                day.planId
                && day.sourceDay
                && !day.completed
                && day.planId !== 'activity-log'
                && day.planId !== 'health-baseline'
              );
              return (
                <div
                  key={`${day.date}-${day.day}`}
                  ref={(node) => {
                    dayRefs.current[day.day] = node;
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectDay(day)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectDay(day);
                    }
                  }}
                  className={`grid w-full grid-cols-[140px_112px_120px_1fr] border-t border-border px-3 py-3 text-left text-sm transition-colors hover:bg-hover ${
                    isSelected ? 'bg-active' : isToday ? 'bg-blue-50' : isPast ? 'bg-surface text-on-surface-variant opacity-70' : 'bg-surface'
                  }`}
                >
                  <div>
                    <p className="font-semibold text-on-surface">{day.planTitle || 'Health'}</p>
                    {day.sourceDay ? (
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {day.projectId === '5k-running' ? `Week ${day.sourceDay}` : `Day ${day.sourceDay}`}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-on-surface-variant">{day.label}</div>
                  <div>
                    <span className={`inline-flex rounded border px-2 py-0.5 text-xs ${kindStyle[day.kind] || kindStyle.plan}`}>
                      {day.kind}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-on-surface">{day.title}</p>
                      <p className="mt-1 text-on-surface-variant">{day.plan}</p>
                      {dayActivities.length > 0 && (
                        <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                          Logged: {dayActivities.map((entry) => `${entry.source === 'health-connect' ? 'Watch sync' : 'Captured'}: ${entry.summary}`).join(' / ')}
                          {estimatedActivityEnergy ? ` · estimated activity energy ~${estimatedActivityEnergy} kcal` : ''}
                          {unverifiedDeviceEnergy ? ` · Fitbit energy ~${unverifiedDeviceEnergy} kcal (unverified)` : ''}
                        </p>
                      )}
                      {day.actual?.summary && (
                        <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                          Plan done: {day.actual.summary}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {extractExerciseCodes(day.plan, exerciseLibrary).map((code) => (
                          <button
                            key={`${day.day}-${code}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedExerciseCode(code);
                            }}
                            className="rounded border border-primary/30 bg-surface px-2 py-0.5 text-xs text-primary hover:bg-active"
                          >
                            {code}
                          </button>
                        ))}
                      </div>
                      {isSelected && canMove ? (
                        <div
                          className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <CalendarClock className="h-4 w-4 text-primary" />
                          <span className="text-xs font-medium text-on-surface">Move session</span>
                          <button
                            type="button"
                            onClick={() => moveSession(day, plan.todayDate)}
                            disabled={movingSession || day.date === plan.todayDate}
                            className="h-8 rounded border border-border bg-surface px-2.5 text-xs text-on-surface hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Today
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSession(day, addCalendarDays(plan.todayDate, 1))}
                            disabled={movingSession || day.date === addCalendarDays(plan.todayDate, 1)}
                            className="h-8 rounded border border-border bg-surface px-2.5 text-xs text-on-surface hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Tomorrow
                          </button>
                          <input
                            type="date"
                            value={moveDate}
                            onChange={(event) => setMoveDate(event.target.value)}
                            className="h-8 rounded border border-border bg-surface px-2 text-xs text-on-surface"
                            aria-label="New session date"
                          />
                          <button
                            type="button"
                            onClick={() => moveSession(day, moveDate)}
                            disabled={movingSession || !moveDate || day.date === moveDate}
                            className="inline-flex h-8 items-center gap-1.5 rounded border border-primary bg-primary px-3 text-xs font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {movingSession ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
                            Move
                          </button>
                          {day.scheduledFromDate ? (
                            <span className="text-xs text-on-surface-variant">
                              Previously {formatShortDate(day.scheduledFromDate)}
                            </span>
                          ) : null}
                          {moveMessage ? (
                            <span className="w-full text-xs text-on-surface-variant">{moveMessage}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <span
                      className={`mt-1 rounded-full border p-1.5 ${
                        day.completed
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : dayActivities.length
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : day.completionStatus === 'partial'
                            ? 'border-amber-300 bg-amber-50 text-amber-700'
                            : 'border-border text-on-surface-variant'
                      }`}
                      title={day.completed || dayActivities.length ? 'Completed/logged activity' : day.completionStatus === 'partial' ? 'Partially logged' : 'Not completed'}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {selectedExercise ? (
        <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className={`grid gap-4 ${selectedExerciseImages.length ? 'lg:grid-cols-[360px_1fr]' : ''}`}>
            {selectedExerciseImages.length ? (
              <div>
                <div className={`grid overflow-hidden rounded-lg border border-border bg-white ${
                  selectedExerciseImages.length > 1 ? 'grid-cols-2' : ''
                }`}>
                  {selectedExerciseImages.map((image, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={image}
                      src={image.startsWith('http')
                        ? image
                        : `/api/vault-asset/${encodeURIComponent(image)}`}
                      alt={`${selectedExercise.name}${selectedExerciseImages.length > 1 ? `, phase ${index + 1}` : ''}`}
                      className="h-80 w-full object-contain"
                    />
                  ))}
                </div>
                {selectedExercise.imageSource ? (
                  <a
                    href={selectedExercise.imageSource}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    {selectedExercise.imageSourceLabel || 'Image source'}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            ) : null}
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-primary">
                <ImageIcon className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Exercise detail</span>
                {selectedExercise.reviewStatus === 'needs-visual-confirmation' ? (
                  <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Needs visual confirmation
                  </span>
                ) : null}
              </div>
              <h3 className="text-xl font-semibold text-on-surface">
                {selectedExercise.code}. {selectedExercise.name}
              </h3>
              <p className="mt-1 text-sm text-on-surface-variant"><strong>Dose:</strong> {selectedExercise.dose}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-surface-variant p-3">
                  <p className="text-xs font-semibold uppercase text-on-surface-variant">Why</p>
                  <p className="mt-1 text-sm text-on-surface">{selectedExercise.why}</p>
                </div>
                <div className="rounded-lg border border-border bg-surface-variant p-3">
                  <p className="text-xs font-semibold uppercase text-on-surface-variant">How</p>
                  <p className="mt-1 text-sm text-on-surface">{selectedExercise.how}</p>
                </div>
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <p className="text-xs font-semibold uppercase text-orange-700">Avoid</p>
                  <p className="mt-1 text-sm text-on-surface">{selectedExercise.avoid}</p>
                </div>
              </div>
              {selectedExercise.source ? (
                <a
                  href={selectedExercise.source.startsWith('http')
                    ? selectedExercise.source
                    : `/?view=vault&path=${encodeURIComponent(selectedExercise.source)}`}
                  target={selectedExercise.source.startsWith('http') ? '_blank' : undefined}
                  rel={selectedExercise.source.startsWith('http') ? 'noreferrer' : undefined}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  {selectedExercise.sourceLabel || 'Source'}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          </div>
        </section>
      ) : selectedDay ? (
        <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-primary">
            <ImageIcon className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Selected plan detail</span>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold text-on-surface">{selectedDay.title}</h3>
              <p className="mt-1 text-sm text-on-surface-variant">{selectedDay.plan}</p>
            </div>
            <span className={`inline-flex w-fit rounded border px-2 py-0.5 text-xs ${kindStyle[selectedDay.kind] || kindStyle.plan}`}>
              {selectedDay.kind}
            </span>
          </div>

          {selectedDay.kind === 'run-quality' ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-surface-variant p-3">
                <p className="text-xs font-semibold uppercase text-on-surface-variant">Session</p>
                <p className="mt-1 text-sm text-on-surface">
                  Controlled intervals: run 500m, recover for 60 seconds, repeat for the planned count.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface-variant p-3">
                <p className="text-xs font-semibold uppercase text-on-surface-variant">Execution</p>
                <p className="mt-1 text-sm text-on-surface">
                  Keep the effort repeatable, not all-out. Warm up first and stop if post-laser recovery is not green.
                </p>
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs font-semibold uppercase text-orange-700">Needs reference</p>
                <p className="mt-1 text-sm text-on-surface">
                  No exercise media is attached yet. If this remains unclear, add a running reference to the Health plan.
                </p>
              </div>
            </div>
          ) : selectedDay.kind === 'run-long' ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-surface-variant p-3">
                <p className="text-xs font-semibold uppercase text-on-surface-variant">Session</p>
                <p className="mt-1 text-sm text-on-surface">
                  Conversational long run. The goal is aerobic volume, not pace.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface-variant p-3">
                <p className="text-xs font-semibold uppercase text-on-surface-variant">Execution</p>
                <p className="mt-1 text-sm text-on-surface">
                  Stay easy enough to speak in full sentences and keep recovery constraints visible.
                </p>
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs font-semibold uppercase text-orange-700">Avoid</p>
                <p className="mt-1 text-sm text-on-surface">
                  Do not turn this into a race effort or add intensity if recovery is not green.
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-border bg-surface-variant p-3">
              <p className="text-sm text-on-surface-variant">
                No exercise media is linked for this selected item. Log completion or add a reference if this plan needs more detail.
              </p>
            </div>
          )}
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-on-surface">Exercise key reference</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {exerciseLibrary.map((item) => (
              <button
                key={item.code}
                onClick={() => setSelectedExerciseCode(item.code)}
                className={`rounded border px-2 py-1 text-left text-xs ${
                  selectedExerciseCode === item.code
                    ? 'border-primary bg-primary text-white'
                    : 'border-teal-300 bg-teal-50 text-teal-950 hover:border-primary'
                }`}
              >
                <strong>{item.code}</strong> = {item.name}
              </button>
            ))}
          </div>
        </details>
      </section>

    </div>
  );
}

function CalibrationMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-amber-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className="mt-1 text-base font-semibold text-on-surface">{value}</p>
    </div>
  );
}

function CalibrationInput({ value, onChange, step = '1', label }: { value: number | undefined; onChange: (value: string) => void; step?: string; label: string }) {
  return <input type="number" min="0" step={step} value={value ?? ''} onChange={(event) => onChange(event.target.value)} aria-label={label} className="h-8 w-24 rounded border border-border bg-surface px-2 text-xs text-on-surface" />;
}

function buildDateRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addCalendarDays(date, 1)) dates.push(date);
  return dates;
}

function buildDisplayedDays(plan: RehabPlan): RehabDay[] {
  const earliestVisibleDate = addCalendarDays(plan.todayDate, -6);
  const days = [...(plan.days || [])].filter((day) => day.date >= earliestVisibleDate);
  const plannedDates = new Set(days.map((day) => day.date));
  for (const entry of plan.activityLog || []) {
    if (plannedDates.has(entry.date)) continue;
    days.push({
      day: 900000 + days.length,
      date: entry.date,
      label: formatShortDate(entry.date),
      kind: 'activity',
      title: 'Logged activity',
      plan: entry.summary,
      completed: true,
      completionStatus: 'completed',
      planId: 'activity-log',
      projectId: 'health',
      planTitle: 'Health activity',
    });
    plannedDates.add(entry.date);
  }
  for (const offset of [-1, 0, 1]) {
    const date = addCalendarDays(plan.todayDate, offset);
    if (plannedDates.has(date)) continue;
    days.push({
      day: 800000 + offset + 1,
      date,
      label: formatShortDate(date),
      kind: 'plan',
      title: offset === 1 ? 'Health baseline for tomorrow' : 'Health check-in',
      plan: offset === 1
        ? 'No fixed session is scheduled. Choose movement based on recovery, then log it through capture or Health Connect.'
        : 'No manual or device activity is recorded for this day yet.',
      completed: false,
      planId: 'health-baseline',
      projectId: 'health',
      planTitle: 'Daily health',
    });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function addCalendarDays(dateValue: string, offset: number) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function extractExerciseCodes(planText: string, exercises: Exercise[]) {
  const codes = exercises.map((exercise) => exercise.code).sort((a, b) => b.length - a.length);
  return codes.filter((code) => {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Z])${escaped}([^A-Z]|$)`).test(planText);
  });
}

function formatShortDate(dateValue: string) {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${dateValue}T00:00:00`));
}

function formatLongDate(dateValue: string) {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${dateValue}T00:00:00`));
}

function focusTimelineRow(timeline: HTMLElement, row: HTMLElement) {
  timeline.style.paddingBottom = '0px';
  const timelineTop = timeline.getBoundingClientRect().top;
  const rowTop = row.getBoundingClientRect().top - timelineTop + timeline.scrollTop;
  const requiredBottomSpace = Math.max(0, rowTop + timeline.clientHeight - timeline.scrollHeight);
  timeline.style.paddingBottom = `${Math.ceil(requiredBottomSpace)}px`;
  timeline.scrollTop = row.getBoundingClientRect().top
    - timeline.getBoundingClientRect().top
    + timeline.scrollTop;
}
