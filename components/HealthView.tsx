'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, ExternalLink, Image as ImageIcon, Loader2, Pause, Play, RotateCcw, SkipForward, X } from 'lucide-react';

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
  dailyRhythm?: {
    longTermWakeGoal: string;
    observedWakeWindow: string;
    currentWakeTarget: string;
    progressionRule: string;
    morningMovement: string;
    strengthPauseThrough: string;
  };
  consumptionMonitoring?: {
    status: string;
    replaces: string;
    trigger: string;
    purpose: string;
  };
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
  weightTrendEligible?: boolean;
  weightNote?: string;
  foodLog?: string;
  intakeKcal?: number;
  intakeComplete?: boolean;
  fitbitTotalEnergyKcal?: number;
  wakeTime?: string;
  walkMinutes?: number;
  coffeeServings?: number;
  lastCoffeeTime?: string;
  alcoholDrinks?: number;
  alcoholKcal?: number;
  alcoholContext?: string;
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
  sessionId?: string;
  scheduledFromDate?: string;
  scheduleUpdatedAt?: string;
  carriedFromDate?: string;
  completedDate?: string;
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

interface EmomExercise {
  code: string;
  name: string;
  dose: string;
  how: string;
  image?: string;
}

interface EmomRoutine {
  rounds: number;
  exercises: EmomExercise[];
}

interface EmomRunner {
  day: RehabDay;
  routine: EmomRoutine;
  roundIndex: number;
  exerciseIndex: number;
  secondsRemaining: number;
  isRunning: boolean;
  finished: boolean;
}

const EMOM_RUNNER_STORAGE_KEY = 'personal-assistant:health:emom-runner';

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
  status: 'border-slate-300 bg-slate-50',
  plan: 'border-slate-300 bg-slate-50',
};

export default function HealthView() {
  const [plan, setPlan] = useState<RehabPlan | null>(null);
  const [exerciseLibrary, setExerciseLibrary] = useState<Exercise[]>([]);
  const [selectedExerciseCode, setSelectedExerciseCode] = useState<string | null>(null);
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);
  const [moveDate, setMoveDate] = useState('');
  const [movingSession, setMovingSession] = useState(false);
  const [completingSession, setCompletingSession] = useState<string | null>(null);
  const [emomRunner, setEmomRunner] = useState<EmomRunner | null>(null);
  const [isEmomRunnerOpen, setIsEmomRunnerOpen] = useState(false);
  const [moveMessage, setMoveMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const dayRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const hasFocusedTimelineRef = useRef(false);
  const hideEmomRunner = () => {
    setEmomRunner((current) => current ? { ...current, isRunning: false } : current);
    setIsEmomRunnerOpen(false);
  };

  useEffect(() => {
    Promise.all([
      fetch(`/api/health/project?ts=${Date.now()}`, { cache: 'no-store' }).then((res) => res.json()),
      fetch('/api/health/exercises').then((res) => res.json()).catch(() => ({ exercises: [] })),
    ])
      .then(([planData, exerciseData]: [RehabPlan, ExerciseLibrary]) => {
        setPlan(planData);
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
        const restoredRunner = restoreEmomRunner(planData, exerciseData.exercises || []);
        if (restoredRunner) {
          setEmomRunner(restoredRunner);
          setIsEmomRunnerOpen(true);
        }
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

  useEffect(() => {
    if (!emomRunner?.isRunning || emomRunner.finished) return;
    const timer = window.setInterval(() => {
      setEmomRunner((current) => advanceEmomSecond(current));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [emomRunner?.isRunning, emomRunner?.finished]);

  useEffect(() => {
    if (!emomRunner || typeof window === 'undefined') return;
    window.localStorage.setItem(EMOM_RUNNER_STORAGE_KEY, JSON.stringify(emomRunner));
  }, [emomRunner]);

  useEffect(() => {
    if (!isEmomRunnerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideEmomRunner();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEmomRunnerOpen]);

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

  const completeSession = async (day: RehabDay) => {
    if (!plan || !day.planId || !day.sourceDay || day.completed || day.date > plan.todayDate) return false;
    const sessionKey = `${day.planId}:${day.sourceDay}`;
    setCompletingSession(sessionKey);
    setMoveMessage('');
    try {
      const response = await fetch('/api/health/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: day.planId, sourceDay: day.sourceDay }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to mark this session complete.');

      const refreshed = await fetch(`/api/health/project?ts=${Date.now()}`, { cache: 'no-store' }).then((res) => res.json()) as RehabPlan;
      setPlan(refreshed);
      if (emomRunner && isSameEmomSession(emomRunner.day, day)) {
        window.localStorage.removeItem(EMOM_RUNNER_STORAGE_KEY);
        setEmomRunner(null);
        setIsEmomRunnerOpen(false);
      }
      setMoveMessage('Marked complete. The next uncompleted session remains scheduled for its next available day.');
      return true;
    } catch (error) {
      setMoveMessage(error instanceof Error ? error.message : 'Unable to mark this session complete.');
      return false;
    } finally {
      setCompletingSession(null);
    }
  };

  const startEmomSession = (day: RehabDay) => {
    if (emomRunner && isSameEmomSession(emomRunner.day, day)) {
      setIsEmomRunnerOpen(true);
      return;
    }
    const routine = buildEmomRoutine(day.plan, exerciseLibrary);
    if (!routine) return;
    setEmomRunner({
      day,
      routine,
      roundIndex: 0,
      exerciseIndex: 0,
      secondsRemaining: 60,
      isRunning: true,
      finished: false,
    });
    setIsEmomRunnerOpen(true);
  };

  const markRunnerComplete = async () => {
    if (!emomRunner) return;
    const completed = await completeSession(emomRunner.day);
    if (completed) {
      window.localStorage.removeItem(EMOM_RUNNER_STORAGE_KEY);
      setEmomRunner(null);
      setIsEmomRunnerOpen(false);
    }
  };
  const discardEmomRunner = () => {
    window.localStorage.removeItem(EMOM_RUNNER_STORAGE_KEY);
    setEmomRunner(null);
    setIsEmomRunnerOpen(false);
  };
  const runnerExercise = emomRunner
    ? emomRunner.routine.exercises[emomRunner.exerciseIndex] || null
    : null;

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
          {plan.calorieCalibration.dailyRhythm ? (
            <div className="mt-4 grid border-y border-amber-200 py-3 md:grid-cols-3 md:divide-x md:divide-amber-200">
              <div className="px-3 first:pl-0">
                <p className="text-xs font-semibold uppercase text-amber-800">Wake progression</p>
                <p className="mt-1 text-sm font-medium text-on-surface">
                  {plan.calorieCalibration.dailyRhythm.currentWakeTarget} now, {plan.calorieCalibration.dailyRhythm.longTermWakeGoal} long term
                </p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Observed: {plan.calorieCalibration.dailyRhythm.observedWakeWindow}. {plan.calorieCalibration.dailyRhythm.progressionRule}
                </p>
              </div>
              <div className="mt-3 px-3 md:mt-0">
                <p className="text-xs font-semibold uppercase text-amber-800">Movement</p>
                <p className="mt-1 text-sm font-medium text-on-surface">{plan.calorieCalibration.dailyRhythm.morningMovement}</p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Kettlebell remains paused through {formatLongDate(plan.calorieCalibration.dailyRhythm.strengthPauseThrough)}.
                </p>
              </div>
              <div className="mt-3 px-3 pr-0 md:mt-0">
                <p className="text-xs font-semibold uppercase text-amber-800">Consumption monitor</p>
                <p className="mt-1 text-sm font-medium text-on-surface">Log what happened, not whether a reset was passed.</p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {plan.calorieCalibration.consumptionMonitoring?.trigger || 'Record amount, timing, calories, and context when coffee or alcohol is consumed.'}
                </p>
              </div>
            </div>
          ) : null}
          <p className="mt-3 text-sm text-on-surface">
            <strong>Daily:</strong> morning weight, total intake including alcohol, Fitbit total energy, wake time, light walk, and actual coffee/alcohol use. Health Connect export energy remains a separate labelled field.
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
              <p className="mt-0.5 text-xs text-on-surface-variant">Read-only view of Personal Vault captures and derived values. Add or correct records through Capture, voice, Codex, or MCP. Health Connect energy remains a separate source value and is never added to Fitbit.</p>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[1260px] text-left text-xs">
                <thead className="sticky top-0 bg-amber-100 text-on-surface">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Weight kg</th>
                    <th className="px-3 py-2 font-semibold">Food log</th>
                    <th className="px-3 py-2 font-semibold">Food log energy</th>
                    <th className="px-3 py-2 font-semibold">Fitbit Energy burned</th>
                    <th className="px-3 py-2 font-semibold">HC source kcal</th>
                    <th className="px-3 py-2 font-semibold">Estimated deficit (burned - eaten)</th>
                  </tr>
                </thead>
                <tbody>
                  {calibrationDates.map((date) => {
                    const record = plan.calorieCalibration?.dailyRecords?.[date] || {};
                    const deviceEnergy = (activityByDate.get(date) || [])
                      .filter((entry) => entry.source === 'health-connect')
                      .reduce((sum, entry) => sum + (entry.calories?.totalEstimatedCalories || 0), 0);
                    const fitbitMargin = record.intakeComplete && record.foodLog && record.fitbitTotalEnergyKcal !== undefined && record.intakeKcal !== undefined
                      ? record.fitbitTotalEnergyKcal - record.intakeKcal
                      : null;
                    return (
                      <tr key={date} className="border-t border-amber-100">
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-on-surface">{formatShortDate(date)}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-on-surface">{record.weightKg ?? '-'}</span>
                          {record.weightTrendEligible === false ? <p className="mt-1 max-w-36 text-[10px] leading-4 text-amber-800">Excluded from trend: {record.weightNote || 'transient water shift'}</p> : null}
                        </td>
                        <td className="max-w-96 px-3 py-2 leading-5 text-on-surface-variant">{record.foodLog || 'No food capture recorded.'}{record.foodLog && !record.intakeComplete ? <p className="mt-1 text-[10px] text-amber-800">Known captures only; later meals may be missing.</p> : null}</td>
                        <td className="px-3 py-2 font-medium text-on-surface">{record.intakeKcal === undefined ? '-' : `${Math.round(record.intakeKcal)} kcal`}</td>
                        <td className="px-3 py-2 font-medium text-on-surface">{record.fitbitTotalEnergyKcal === undefined ? '-' : `${Math.round(record.fitbitTotalEnergyKcal)} kcal`}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{deviceEnergy ? `${Math.round(deviceEnergy)} kcal` : '-'}</td>
                        <td className="px-3 py-2 font-medium text-on-surface">
                          {fitbitMargin === null
                            ? 'Incomplete food log'
                            : fitbitMargin >= 0
                              ? `Estimated deficit: +${Math.round(fitbitMargin)} kcal`
                              : `Estimated surplus: ${Math.abs(Math.round(fitbitMargin))} kcal`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded border border-amber-200 bg-white">
            <div className="border-b border-amber-200 px-3 py-2">
              <p className="text-sm font-semibold text-on-surface">Daily rhythm and consumption</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                The old 4PM pass/fail reset is off. Record actual use and context so the review can identify timing, hunger, fatigue, stress, social, or habit patterns.
              </p>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[1320px] text-left text-xs">
                <thead className="sticky top-0 bg-amber-100 text-on-surface">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Wake</th>
                    <th className="px-3 py-2 font-semibold">Walk min</th>
                    <th className="px-3 py-2 font-semibold">Coffee</th>
                    <th className="px-3 py-2 font-semibold">Last coffee</th>
                    <th className="px-3 py-2 font-semibold">Standard drinks</th>
                    <th className="px-3 py-2 font-semibold">Alcohol kcal</th>
                    <th className="px-3 py-2 font-semibold">Why / context</th>
                  </tr>
                </thead>
                <tbody>
                  {calibrationDates.map((date) => {
                    const record = plan.calorieCalibration?.dailyRecords?.[date] || {};
                    return (
                      <tr key={`rhythm-${date}`} className="border-t border-amber-100">
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-on-surface">{formatShortDate(date)}</td>
                        <td className="px-3 py-2">{record.wakeTime || '-'}</td>
                        <td className="px-3 py-2">{record.walkMinutes === undefined ? '-' : `${record.walkMinutes} min`}</td>
                        <td className="px-3 py-2">{record.coffeeServings ?? '-'}</td>
                        <td className="px-3 py-2">{record.lastCoffeeTime || '-'}</td>
                        <td className="px-3 py-2">{record.alcoholDrinks ?? '-'}</td>
                        <td className="px-3 py-2">{record.alcoholKcal === undefined ? '-' : `${record.alcoholKcal} kcal`}</td>
                        <td className="max-w-96 px-3 py-2 text-on-surface-variant">{record.alcoholContext || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
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
              const canComplete = Boolean(canMove && day.date <= plan.todayDate);
              const canStart = Boolean(canComplete && buildEmomRoutine(day.plan, exerciseLibrary));
              const hasStoredEmomRunner = Boolean(emomRunner && isSameEmomSession(emomRunner.day, day));
              const sessionKey = `${day.planId}:${day.sourceDay}`;
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
                      {day.title ? <p className="font-medium text-on-surface">{day.title}</p> : null}
                      <p className={`${day.title ? 'mt-1 ' : ''}text-on-surface-variant`}>
                        <ExercisePlanText
                          planText={day.plan}
                          exerciseCodes={extractExerciseCodes(day.plan, exerciseLibrary)}
                          onSelect={(code) => setSelectedExerciseCode(code)}
                        />
                      </p>
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
                      {isSelected && canMove ? (
                        <div
                          className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <CalendarClock className="h-4 w-4 text-primary" />
                          <span className="text-xs font-medium text-on-surface">Move session</span>
                          {canStart ? (
                            <button
                              type="button"
                              onClick={() => startEmomSession(day)}
                              className="inline-flex h-8 items-center gap-1.5 rounded border border-emerald-700 bg-emerald-700 px-3 text-xs font-medium text-white hover:bg-emerald-800"
                            >
                              <Play className="h-3.5 w-3.5" />
                              {hasStoredEmomRunner ? 'Resume' : 'Start'}
                            </button>
                          ) : null}
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
                    {day.kind !== 'status' ? (
                      <label
                        className={`mt-1 inline-flex h-7 w-7 items-center justify-center rounded border ${
                          day.completed
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : day.completionStatus === 'partial'
                              ? 'border-amber-300 bg-amber-50 text-amber-700'
                              : 'border-border text-on-surface-variant'
                        }`}
                        title={day.completed ? 'Completed' : day.completionStatus === 'partial' ? 'Partially logged' : canComplete ? 'Mark this session complete' : 'Future session'}
                      >
                        <input
                          type="checkbox"
                          checked={day.completed}
                          disabled={!canComplete || completingSession === sessionKey}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => completeSession(day)}
                          aria-label={`Mark ${day.planTitle || 'health session'} on ${day.label} complete`}
                          className="h-4 w-4 accent-emerald-600 disabled:cursor-not-allowed"
                        />
                      </label>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {emomRunner && runnerExercise && isEmomRunnerOpen && typeof document !== 'undefined' ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="emom-runner-title"
          style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', padding: '1rem' }}
        >
          <section
            className="rounded-lg border border-border bg-surface shadow-2xl"
            style={{ width: 'min(40rem, calc(100vw - 2rem))', maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto' }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Every Minute on the Minute (EMOM)</p>
                <h2 id="emom-runner-title" className="mt-1 text-xl font-semibold text-on-surface">Kettlebell interval session</h2>
                <p className="mt-1 text-sm text-on-surface-variant">Start each exercise at the beginning of its minute, then rest for the remaining time.</p>
              </div>
              <button
                type="button"
                onClick={hideEmomRunner}
                className="inline-flex h-9 w-9 items-center justify-center rounded border border-border text-on-surface-variant hover:bg-hover"
                title="Hide session timer"
                aria-label="Hide session timer"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex items-center gap-4 text-sm text-on-surface-variant">
                  <span>Round <strong className="text-on-surface">{emomRunner.roundIndex + 1} of {emomRunner.routine.rounds}</strong></span>
                  <span>Exercise <strong className="text-on-surface">{emomRunner.exerciseIndex + 1} of {emomRunner.routine.exercises.length}</strong></span>
                </div>
                <p className="text-5xl font-semibold tabular-nums text-on-surface">{formatEmomTime(emomRunner.secondsRemaining)}</p>
              </div>
              <div className="mt-5 grid gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 sm:grid-cols-[144px_1fr]">
                {runnerExercise.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={runnerExercise.image.startsWith('http')
                      ? runnerExercise.image
                      : `/api/vault-asset/${encodeURIComponent(runnerExercise.image)}`}
                    alt={runnerExercise.name}
                    className="h-32 w-full rounded border border-emerald-200 bg-white object-contain"
                  />
                ) : (
                  <div className="flex h-32 items-center justify-center rounded border border-dashed border-emerald-300 bg-white px-3 text-center text-xs text-emerald-900">
                    No reference image is saved for this exercise.
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-emerald-900">{runnerExercise.code} · {runnerExercise.name}</p>
                  <p className="mt-1 text-lg font-medium text-on-surface">Target: {runnerExercise.dose || 'Complete the prescribed work for this minute.'}</p>
                  <p className="mt-3 text-sm leading-5 text-on-surface-variant">{runnerExercise.how}</p>
                </div>
              </div>

              <ol className="mt-5 grid grid-cols-5 gap-2" aria-label="Session exercise order">
                {emomRunner.routine.exercises.map((exercise, index) => {
                  const isCurrent = index === emomRunner.exerciseIndex;
                  const isPast = index < emomRunner.exerciseIndex || emomRunner.finished;
                  return (
                    <li
                      key={exercise.code}
                      className={`min-h-16 rounded border px-2 py-2 text-xs ${
                        isCurrent
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-950'
                          : isPast
                            ? 'border-border bg-surface-variant text-on-surface-variant'
                            : 'border-border bg-surface text-on-surface-variant'
                      }`}
                    >
                      <p className="font-semibold">{exercise.code}</p>
                      <p className="mt-1 leading-tight">{exercise.dose || exercise.name}</p>
                    </li>
                  );
                })}
              </ol>

              {emomRunner.finished ? (
                <p className="mt-5 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Timer complete. Mark the session complete only if you performed the work.
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setEmomRunner((current) => current ? { ...current, isRunning: !current.isRunning } : current)}
                  disabled={emomRunner.finished}
                  className="inline-flex h-9 items-center gap-1.5 rounded border border-primary bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {emomRunner.isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {emomRunner.isRunning ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  onClick={() => setEmomRunner((current) => current ? {
                    ...current,
                    roundIndex: 0,
                    exerciseIndex: 0,
                    secondsRemaining: 60,
                    isRunning: false,
                    finished: false,
                  } : current)}
                  className="inline-flex h-9 items-center gap-1.5 rounded border border-border bg-surface px-3 text-sm text-on-surface hover:bg-hover"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setEmomRunner((current) => current ? advanceEmomStep(current) : current)}
                  disabled={emomRunner.finished}
                  className="inline-flex h-9 items-center gap-1.5 rounded border border-border bg-surface px-3 text-sm text-on-surface hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <SkipForward className="h-4 w-4" />
                  Next
                </button>
                <button
                  type="button"
                  onClick={discardEmomRunner}
                  className="inline-flex h-9 items-center rounded border border-border bg-surface px-3 text-sm text-on-surface-variant hover:bg-hover"
                >
                  Discard
                </button>
                {emomRunner.finished ? (
                  <button
                    type="button"
                    onClick={() => void markRunnerComplete()}
                    disabled={completingSession === `${emomRunner.day.planId}:${emomRunner.day.sourceDay}`}
                    className="ml-auto inline-flex h-9 items-center gap-1.5 rounded border border-emerald-700 bg-emerald-700 px-3 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {completingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Mark complete
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        </div>,
        document.body
      ) : null}

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
        <details open>
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

function ExercisePlanText({
  planText,
  exerciseCodes,
  onSelect,
}: {
  planText: string;
  exerciseCodes: string[];
  onSelect: (code: string) => void;
}) {
  if (!exerciseCodes.length) return planText;

  const pattern = new RegExp(`(\\b(?:${exerciseCodes.map(escapeRegex).join('|')})\\b)`, 'g');
  const codes = new Set(exerciseCodes);
  const parts: ReactNode[] = [];

  planText.split(pattern).forEach((part, index) => {
    if (!codes.has(part)) {
      parts.push(part);
      return;
    }

    parts.push(
      <button
        key={`${part}-${index}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onSelect(part);
        }}
        className="inline font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:text-primary/70 focus:outline-none focus:ring-2 focus:ring-primary/40"
        title={`Open ${part} exercise detail`}
      >
        {part}
      </button>
    );
  });

  return <>{parts}</>;
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
      kind: 'status',
      title: '',
      plan: offset === 1
        ? 'No session is scheduled. Health Connect or a capture may add activity tomorrow.'
        : 'No session is scheduled. Waiting for Health Connect or a capture.',
      completed: false,
      planId: 'health-status',
      projectId: 'health',
      planTitle: 'Health',
    });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function restoreEmomRunner(plan: RehabPlan, exercises: Exercise[]): EmomRunner | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = JSON.parse(window.localStorage.getItem(EMOM_RUNNER_STORAGE_KEY) || 'null') as Partial<EmomRunner> | null;
    if (!stored?.day?.planId || !stored.day.sourceDay) return null;

    const day = buildDisplayedDays(plan).find((candidate) => isSameEmomSession(candidate, stored.day as RehabDay));
    const routine = day ? buildEmomRoutine(day.plan, exercises) : null;
    if (!day || day.completed || !routine) {
      window.localStorage.removeItem(EMOM_RUNNER_STORAGE_KEY);
      return null;
    }

    const finished = Boolean(stored.finished);
    const roundIndex = clampInteger(stored.roundIndex, 0, routine.rounds - 1);
    const exerciseIndex = clampInteger(stored.exerciseIndex, 0, routine.exercises.length - 1);
    return {
      day,
      routine,
      roundIndex: finished ? routine.rounds - 1 : roundIndex,
      exerciseIndex: finished ? routine.exercises.length - 1 : exerciseIndex,
      secondsRemaining: finished ? 0 : clampInteger(stored.secondsRemaining, 1, 60),
      isRunning: false,
      finished,
    };
  } catch {
    window.localStorage.removeItem(EMOM_RUNNER_STORAGE_KEY);
    return null;
  }
}

function isSameEmomSession(left: RehabDay, right: RehabDay) {
  return Boolean(
    left.planId
    && right.planId
    && left.sourceDay
    && right.sourceDay
    && left.planId === right.planId
    && left.sourceDay === right.sourceDay
  );
}

function clampInteger(value: unknown, minimum: number, maximum: number) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : minimum;
  return Math.min(Math.max(numeric, minimum), maximum);
}

function buildEmomRoutine(planText: string, exercises: Exercise[]): EmomRoutine | null {
  if (!/\bEMOM\b/i.test(planText)) return null;

  const roundsMatch = planText.match(/(\d+)\s+rounds?/i);
  const rounds = Number(roundsMatch?.[1] || 0);
  const codes = extractExerciseCodes(planText, exercises)
    .sort((left, right) => planText.indexOf(left) - planText.indexOf(right));
  if (!rounds || !codes.length) return null;

  return {
    rounds,
    exercises: codes.map((code) => {
      const exercise = exercises.find((candidate) => candidate.code === code);
      const doseMatch = planText.match(new RegExp('\\b' + escapeRegex(code) + '\\b\\s*([^·]+?)(?=\\s*·\\s*|$)'));
      return {
        code,
        name: exercise?.name || code,
        dose: doseMatch?.[1]?.trim() || '',
        how: exercise?.how || 'No saved exercise instruction is available.',
        image: exercise?.image || exercise?.images?.[0],
      };
    }),
  };
}

function advanceEmomSecond(runner: EmomRunner | null) {
  if (!runner || !runner.isRunning || runner.finished) return runner;
  if (runner.secondsRemaining > 1) {
    return { ...runner, secondsRemaining: runner.secondsRemaining - 1 };
  }
  return advanceEmomStep(runner);
}

function advanceEmomStep(runner: EmomRunner): EmomRunner {
  if (runner.finished) return runner;
  if (runner.exerciseIndex < runner.routine.exercises.length - 1) {
    return { ...runner, exerciseIndex: runner.exerciseIndex + 1, secondsRemaining: 60 };
  }
  if (runner.roundIndex < runner.routine.rounds - 1) {
    return { ...runner, roundIndex: runner.roundIndex + 1, exerciseIndex: 0, secondsRemaining: 60 };
  }
  return { ...runner, secondsRemaining: 0, isRunning: false, finished: true };
}

function formatEmomTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return String(minutes) + ':' + remainder;
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
